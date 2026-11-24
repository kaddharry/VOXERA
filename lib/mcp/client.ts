import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { decrypt } from "../util/crypto";
import { supabase } from "../db/supabase";
import type { ToolDef } from "../agent/tools";

export interface MCPConnection {
  id: string;
  tenant_id: string;
  name: string;
  endpoint: string;
  token_header?: string | null;
  encrypted_token: string | null;
  tools: MCPRemoteTool[];
  tools_checked_at: string | null;
  protocol_version?: string | null;
  status: "active" | "error";
}

export interface MCPRemoteTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

function normalizeSchema(schema: Record<string, unknown> | undefined, depth = 0): Record<string, unknown> {
  if (!schema || depth > 6) return { type: "object", properties: {} };
  const out: Record<string, unknown> = {};
  const type = schema.type;
  if (typeof type === "string" && ["object", "array", "string", "number", "integer", "boolean"].includes(type)) out.type = type;
  if (typeof schema.description === "string") out.description = schema.description.slice(0, 300);
  if (Array.isArray(schema.required)) out.required = schema.required.filter((v) => typeof v === "string").slice(0, 40);
  if (Array.isArray(schema.enum)) out.enum = schema.enum.slice(0, 40);
  if (typeof schema.additionalProperties === "boolean") out.additionalProperties = schema.additionalProperties;
  for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"] as const) {
    if (typeof schema[key] === "number") out[key] = schema[key];
  }
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    out.properties = Object.fromEntries(Object.entries(schema.properties as Record<string, unknown>).slice(0, 40).map(([key, value]) => [key.slice(0, 80), normalizeSchema(value as Record<string, unknown>, depth + 1)]));
  }
  if (schema.items && typeof schema.items === "object") out.items = normalizeSchema(schema.items as Record<string, unknown>, depth + 1);
  return out.type ? out : { type: "object", properties: {} };
}

function validateArguments(schema: Record<string, unknown>, value: unknown, path = "arguments", depth = 0): void {
  if (depth > 6) throw new Error("MCP tool arguments exceed the maximum nesting depth.");
  const type = schema.type;
  const valid = type === "object" ? !!value && typeof value === "object" && !Array.isArray(value)
    : type === "array" ? Array.isArray(value)
    : type === "integer" ? Number.isInteger(value)
    : type === "number" ? typeof value === "number" && Number.isFinite(value)
    : type === "boolean" ? typeof value === "boolean"
    : type === "string" ? typeof value === "string"
    : true;
  if (!valid) throw new Error(`MCP argument '${path}' must be ${String(type)}.`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) throw new Error(`MCP argument '${path}' is not an allowed value.`);
  if (typeof value === "string") {
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) throw new Error(`MCP argument '${path}' is too long.`);
    if (typeof schema.minLength === "number" && value.length < schema.minLength) throw new Error(`MCP argument '${path}' is too short.`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) throw new Error(`MCP argument '${path}' is below its minimum.`);
    if (typeof schema.maximum === "number" && value > schema.maximum) throw new Error(`MCP argument '${path}' exceeds its maximum.`);
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === "object") value.slice(0, 100).forEach((item, index) => validateArguments(schema.items as Record<string, unknown>, item, `${path}[${index}]`, depth + 1));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const props = (schema.properties && typeof schema.properties === "object" ? schema.properties : {}) as Record<string, Record<string, unknown>>;
    for (const required of (Array.isArray(schema.required) ? schema.required : []) as string[]) {
      if (!(required in value)) throw new Error(`MCP argument '${path}.${required}' is required.`);
    }
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !(key in props))) throw new Error(`MCP tool received an unsupported argument at '${path}'.`);
    for (const [key, item] of Object.entries(value)) if (props[key]) validateArguments(props[key], item, `${path}.${key}`, depth + 1);
  }
}

const PROTOCOL_VERSION = "2025-03-26";
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const TOOL_NAME_TO_REMOTE = new Map<string, { connectionId: string; remoteName: string }>();
const AGENT_TOOLS_CACHE = new Map<string, { expiresAt: number; tools: ToolDef[] }>();

class MCPRpcError extends Error {
  constructor(message: string, readonly code?: number, readonly status?: number, readonly data?: unknown) { super(message); }
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || b === 88)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0) || a >= 224);
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPublicAddress(normalized.slice(7));
  // Only global-unicast 2000::/3 is eligible. This rejects unspecified,
  // loopback, unique-local, link-local, multicast, and other special ranges.
  return /^[23]/.test(normalized) && !normalized.startsWith("2001:db8:");
}

export async function validateMCPEndpoint(endpoint: string): Promise<URL> {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("Enter a valid MCP server URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new Error("MCP servers must use an HTTPS URL without embedded credentials, query strings, or fragments.");
  }
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname) || /\.(local|internal|localhost)$/.test(url.hostname)) {
    throw new Error("Local and private network MCP servers are not allowed.");
  }
  if (isIP(url.hostname)) {
    if (!isPublicAddress(url.hostname)) throw new Error("Private network MCP servers are not allowed.");
  } else {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
      throw new Error("MCP server host must resolve only to public IP addresses.");
    }
  }
  return url;
}

async function rpc(connection: Pick<MCPConnection, "endpoint" | "encrypted_token" | "token_header">, method: string, params?: unknown, sessionId?: string, protocolVersion?: string) {
  const url = await validateMCPEndpoint(connection.endpoint);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (connection.encrypted_token) {
    const token = decrypt(connection.encrypted_token);
    headers[connection.token_header ?? "authorization"] = (connection.token_header ?? "authorization") === "authorization" ? `Bearer ${token}` : token;
  }
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (protocolVersion?.startsWith("2026-")) {
    headers["mcp-protocol-version"] = protocolVersion;
    headers["mcp-method"] = method;
    if (method === "tools/call" && params && typeof params === "object" && "name" in params) headers["mcp-name"] = String((params as { name: string }).name);
  }
  const addresses = isIP(url.hostname) ? [{ address: url.hostname, family: isIP(url.hostname) }] : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new Error("MCP server host must resolve only to public IP addresses.");
  const pinnedAddress = isIP(url.hostname)
    ? { address: url.hostname, family: isIP(url.hostname) }
    : addresses[0];
  if (!pinnedAddress) throw new Error("MCP server host did not resolve to a public IP address.");
  const withMeta = protocolVersion?.startsWith("2026-") && params && typeof params === "object"
    ? { ...(params as Record<string, unknown>), _meta: { "io.modelcontextprotocol/protocolVersion": protocolVersion, "io.modelcontextprotocol/clientInfo": { name: "voxera-agent-builder", version: "1.0.0" }, "io.modelcontextprotocol/clientCapabilities": {} } }
    : protocolVersion?.startsWith("2026-") ? { _meta: { "io.modelcontextprotocol/protocolVersion": protocolVersion, "io.modelcontextprotocol/clientInfo": { name: "voxera-agent-builder", version: "1.0.0" }, "io.modelcontextprotocol/clientCapabilities": {} } } : params;
  const body = JSON.stringify({ jsonrpc: "2.0", ...(method.startsWith("notifications/") ? {} : { id: Date.now() }), method, ...(withMeta === undefined ? {} : { params: withMeta }) });
  const response = await new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const req = httpsRequest({
      protocol: "https:", hostname: url.hostname, port: url.port || 443, path: `${url.pathname}${url.search}`,
      method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body) }, servername: isIP(url.hostname) ? undefined : url.hostname,
      lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
        if (options?.all) callback(null, [{ address: pinnedAddress.address, family: pinnedAddress.family }]);
        else callback(null, pinnedAddress.address, pinnedAddress.family);
      }) as any,
    }, (res) => {
      const chunks: Buffer[] = []; let bytes = 0;
      res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1_000_000) req.destroy(new Error("MCP response exceeds 1 MB.")); else chunks.push(chunk); });
      res.on("end", () => resolve({ status: res.statusCode ?? 500, headers: res.headers as Record<string, string | string[] | undefined>, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.setTimeout(7000, () => req.destroy(new Error("MCP server timed out.")));
    req.on("error", reject);
    req.end(body);
  });
  const nextSessionId = (response.headers["mcp-session-id"] as string | undefined) ?? sessionId;
  const contentType = (response.headers["content-type"] as string | undefined) ?? "";
  const raw = response.body;
  if (!raw) {
    if (response.status < 200 || response.status >= 300) throw new MCPRpcError(`MCP server returned HTTP ${response.status}.`, undefined, response.status);
    return { result: null, sessionId: nextSessionId };
  }
  let payload: any;
  if (contentType.includes("text/event-stream")) {
    const data = raw.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean).at(-1);
    payload = data ? JSON.parse(data) : null;
  } else {
    payload = JSON.parse(raw);
  }
  if (payload?.error) throw new MCPRpcError(payload.error.message || "MCP request failed.", payload.error.code, response.status, payload.error.data);
  if (response.status < 200 || response.status >= 300) throw new MCPRpcError(`MCP server returned HTTP ${response.status}.`, undefined, response.status);
  return { result: payload?.result ?? null, sessionId: nextSessionId };
}

export async function discoverMCPTools(connection: Pick<MCPConnection, "endpoint" | "encrypted_token" | "token_header">): Promise<{ tools: MCPRemoteTool[]; protocolVersion: string }> {
  try {
    const discovery = await rpc(connection, "server/discover", {}, undefined, MODERN_PROTOCOL_VERSION);
    const supported = discovery.result?.supportedVersions as string[] | undefined;
    const selectedVersion = supported?.includes(MODERN_PROTOCOL_VERSION) ? MODERN_PROTOCOL_VERSION : undefined;
    if (selectedVersion) {
      const list = await rpc(connection, "tools/list", {}, undefined, selectedVersion);
      const tools = list.result?.tools as MCPRemoteTool[];
      if (!Array.isArray(tools) || tools.length > 60) throw new Error("MCP server returned an invalid or oversized tool list.");
      return { tools: tools.filter((tool) => typeof tool.name === "string" && /^[\w.-]{1,128}$/.test(tool.name)), protocolVersion: selectedVersion };
    }
  } catch (error) {
    // An empty/non-MCP response means a legacy server; recognized modern
    // protocol errors remain visible because they indicate a real mismatch.
    if (error instanceof MCPRpcError && error.code === -32022) {
      const supported = (error.data as { supported?: string[] } | undefined)?.supported;
      if (supported?.includes(MODERN_PROTOCOL_VERSION)) throw error;
    }
  }
  const init = await rpc(connection, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "voxera-agent-builder", version: "1.0.0" },
  });
  const negotiatedVersion = typeof init.result?.protocolVersion === "string" ? init.result.protocolVersion : PROTOCOL_VERSION;
  await rpc(connection, "notifications/initialized", undefined, init.sessionId ?? undefined).catch(() => undefined);
  const list = await rpc(connection, "tools/list", {}, init.sessionId ?? undefined);
  const tools = (list.result?.tools ?? []) as MCPRemoteTool[];
  if (!Array.isArray(tools) || tools.length > 60) throw new Error("MCP server returned an invalid or oversized tool list. Limit a connection to 60 tools.");
  return { tools: tools.filter((tool) => typeof tool.name === "string" && /^[\w.-]{1,128}$/.test(tool.name)), protocolVersion: negotiatedVersion };
}

export function makeFunctionName(connectionId: string, remoteName: string): string {
  const compactId = connectionId.replaceAll("-", "").slice(0, 8);
  const safeName = remoteName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 42);
  const digest = Buffer.from(remoteName).toString("base64url").slice(0, 7);
  const functionName = `mcp_${compactId}_${safeName}_${digest}`.slice(0, 64);
  TOOL_NAME_TO_REMOTE.set(functionName, { connectionId, remoteName });
  return functionName;
}

export async function getMCPToolsForAgent(clientId: string, enabledTools: string[]): Promise<ToolDef[]> {
  const ids = enabledTools.filter((id) => id.startsWith("mcp_"));
  if (!ids.length) return [];
  const cacheKey = `${clientId}:${ids.slice().sort().join(",")}`;
  const cached = AGENT_TOOLS_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.tools;
  const { data: tenant } = await supabase.from("tenants").select("id").eq("auth_user_id", clientId).single();
  if (!tenant) return [];
  const { data: rows, error } = await supabase.from("mcp_connections").select("*").eq("tenant_id", tenant.id).eq("status", "active");
  if (error || !rows) return [];
  const definitions: ToolDef[] = [];
  for (const row of rows as MCPConnection[]) {
    for (const remote of row.tools ?? []) {
      const name = makeFunctionName(row.id, remote.name);
      if (!ids.includes(name)) continue;
      definitions.push({ type: "function", function: {
        name,
        description: `[MCP: ${row.name}] ${(remote.description || remote.name).slice(0, 800)}`,
        parameters: normalizeSchema(remote.inputSchema),
      } });
    }
  }
  AGENT_TOOLS_CACHE.set(cacheKey, { tools: definitions, expiresAt: Date.now() + 30_000 });
  return definitions;
}

export async function dispatchMCPTool(functionName: string, args: Record<string, unknown>, clientId: string): Promise<string> {
  const mapping = TOOL_NAME_TO_REMOTE.get(functionName);
  if (!mapping) throw new Error("MCP tool is no longer available; refresh the agent's tools.");
  const { data: tenant } = await supabase.from("tenants").select("id").eq("auth_user_id", clientId).single();
  if (!tenant) throw new Error("Tenant not found.");
  const { data: row } = await supabase.from("mcp_connections").select("*").eq("id", mapping.connectionId).eq("tenant_id", tenant.id).eq("status", "active").single();
  if (!row) throw new Error("MCP connection is unavailable.");
  const connection = row as MCPConnection;
  const remoteTool = (connection.tools ?? []).find((tool) => tool.name === mapping.remoteName);
  if (!remoteTool) throw new Error("MCP tool is not enabled on this connection.");
  validateArguments(normalizeSchema(remoteTool.inputSchema), args);
  let sessionId: string | undefined;
  const protocolVersion = connection.protocol_version ?? PROTOCOL_VERSION;
  if (!protocolVersion.startsWith("2026-")) {
    const init = await rpc(connection, "initialize", { protocolVersion, capabilities: {}, clientInfo: { name: "voxera-agent-builder", version: "1.0.0" } });
    sessionId = init.sessionId ?? undefined;
    await rpc(connection, "notifications/initialized", undefined, sessionId).catch(() => undefined);
  }
  const call = await rpc(connection, "tools/call", { name: mapping.remoteName, arguments: args }, sessionId, protocolVersion.startsWith("2026-") ? protocolVersion : undefined);
  const content = call.result?.content;
  if (Array.isArray(content)) return content.map((item: any) => item.text ?? JSON.stringify(item)).join("\n").slice(0, 8000);
  return JSON.stringify(call.result ?? { ok: true }).slice(0, 8000);
}
