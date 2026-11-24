import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { decrypt } from "../util/crypto";
import type { ToolDef, ToolCallContext } from "../agent/tools";

export interface CustomToolRow {
  id: string; tenant_id: string; name: string; description: string; endpoint: string; method: string;
  input_schema: Record<string, unknown>; headers: Record<string, string>; encrypted_secret: string | null;
  secret_header: string | null; status: string;
}

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a,b] = address.split(".").map(Number);
    return !(a===0 || a===10 || a===127 || (a===100&&b>=64&&b<=127) || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&(b===0||b===168||b===88)) || (a===198&&(b===18||b===19||b===51)) || (a===203&&b===0) || a>=224);
  }
  const value = address.toLowerCase();
  if (value.startsWith("::ffff:")) return publicAddress(value.slice(7));
  return /^[23]/.test(value) && !value.startsWith("2001:db8:");
}

function validateArgs(schema: Record<string, unknown>, args: Record<string, unknown>) {
  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") throw new Error("This tool has an invalid input schema.");
  const properties = schema.properties as Record<string, { type?: string }>;
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) if (typeof key === "string" && (args[key] === undefined || args[key] === null || args[key] === "")) throw new Error(`Missing required input: ${key}`);
  for (const [key,value] of Object.entries(args)) {
    const expected = properties[key]?.type;
    if (!expected) throw new Error(`Unexpected input: ${key}`);
    const valid = expected === "string" ? typeof value === "string" : expected === "number" ? typeof value === "number" && Number.isFinite(value) : expected === "integer" ? Number.isInteger(value) : expected === "boolean" ? typeof value === "boolean" : expected === "array" ? Array.isArray(value) : expected === "object" ? typeof value === "object" && value !== null && !Array.isArray(value) : true;
    if (!valid) throw new Error(`Invalid value for ${key}; expected ${expected}.`);
    if (typeof value === "string" && value.length > 10000) throw new Error(`Input ${key} is too long.`);
  }
}

export function customToolFunctionName(id: string) { return `custom_${id.replaceAll("-", "").slice(0, 24)}`; }

export function customToolDefinitions(rows: CustomToolRow[]): ToolDef[] {
  return rows.filter((row) => row.status === "active").map((row) => ({ type: "function", function: {
    name: customToolFunctionName(row.id), description: `[Custom tool: ${row.name}] ${row.description}`.slice(0, 800), parameters: row.input_schema,
  } }));
}

export async function executeCustomTool(row: CustomToolRow, args: Record<string, unknown>): Promise<string> {
  validateArgs(row.input_schema, args);
  const url = new URL(row.endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Custom tool endpoints must use HTTPS without embedded credentials or fragments.");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname, family: isIP(url.hostname) }] : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({address}) => !publicAddress(address))) throw new Error("Custom tool endpoint must resolve only to public IP addresses.");
  const pinned = addresses[0];
  const headers: Record<string,string> = { accept: "application/json", ...row.headers };
  if (row.encrypted_secret && row.secret_header) headers[row.secret_header] = row.secret_header.toLowerCase() === "authorization" ? `Bearer ${decrypt(row.encrypted_secret)}` : decrypt(row.encrypted_secret);
  const body = row.method === "GET" ? "" : JSON.stringify(args);
  const target = new URL(url);
  if (row.method === "GET") for (const [key,value] of Object.entries(args)) target.searchParams.set(key, String(value));
  return new Promise((resolve, reject) => {
    const req = httpsRequest({ protocol: "https:", hostname: target.hostname, port: target.port || 443, path: `${target.pathname}${target.search}`, method: row.method, headers: { ...headers, ...(body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } : {}) }, servername: isIP(target.hostname) ? undefined : target.hostname, lookup: ((_host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
      if (options?.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
      else cb(null, pinned.address, pinned.family);
    }) as never }, (res) => {
      const chunks: Buffer[] = []; let bytes = 0;
      res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 256_000) req.destroy(new Error("Tool response exceeds 256 KB.")); else chunks.push(chunk); });
      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) return reject(new Error(`Tool endpoint returned HTTP ${res.statusCode}: ${text.slice(0,500)}`)); resolve(text.slice(0, 12000) || "Tool completed successfully with an empty response."); });
      res.on("error", reject);
    });
    req.setTimeout(10000, () => req.destroy(new Error("Tool endpoint timed out.")));
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}

export async function getCustomToolsForAgent(enabled: string[], clientId: string): Promise<ToolDef[]> {
  const ids = enabled.filter((name) => name.startsWith("custom_"));
  if (!ids.length) return [];
  const { supabase } = await import("../db/supabase");
  const { data: tenant } = await supabase.from("tenants").select("id").eq("auth_user_id", clientId).single();
  if (!tenant) return [];
  const { data } = await supabase.from("custom_tools").select("*").eq("tenant_id", tenant.id).eq("status", "active");
  return customToolDefinitions(((data ?? []) as CustomToolRow[]).filter((row) => ids.includes(customToolFunctionName(row.id))));
}

export async function dispatchCustomTool(name: string, args: Record<string, unknown>, clientId: string) {
  const { supabase } = await import("../db/supabase");
  const { data: tenant } = await supabase.from("tenants").select("id").eq("auth_user_id", clientId).single();
  if (!tenant) throw new Error("Tenant not found.");
  const { data: rows } = await supabase.from("custom_tools").select("*").eq("tenant_id", tenant.id).eq("status", "active");
  const row = ((rows ?? []) as CustomToolRow[]).find((item) => customToolFunctionName(item.id) === name);
  if (!row) throw new Error("Custom tool is no longer available.");
  return executeCustomTool(row, args);
}
