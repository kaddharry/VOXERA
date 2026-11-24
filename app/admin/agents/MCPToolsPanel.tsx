"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, ChevronDown, ChevronUp, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

interface MCPToolOption { id: string; name: string; description: string; inputSchema: Record<string, unknown> }
interface Connection { id: string; name: string; endpoint: string; hasToken: boolean; status: string; toolsCheckedAt: string | null; lastError: string | null; tools: MCPToolOption[] }

export function MCPToolsPanel({ enabledTools, onChange, initialName = "", selectable = true }: { enabledTools: string[]; onChange: (ids: string[]) => void; initialName?: string; selectable?: boolean }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [tokenHeader, setTokenHeader] = useState("authorization");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testOutput, setTestOutput] = useState<Record<string,string>>({});
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/mcp-connections");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load MCP connections.");
    setConnections(data.connections ?? []);
  }, []);

  useEffect(() => { void load().catch((err) => setError(err instanceof Error ? err.message : String(err))); }, [load]);
  useEffect(() => { if (initialName) setName(initialName); }, [initialName]);

  const add = async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/admin/mcp-connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, endpoint, token: token || undefined, tokenHeader }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not connect MCP server.");
      setName(""); setEndpoint(""); setToken(""); setTokenHeader("authorization");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  const refresh = async (id: string) => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/admin/mcp-connections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not refresh tools.");
      const updated: Connection = data.connection;
      const previous = connections.find((item) => item.id === id);
      const nextIds = new Set(updated.tools.map((tool) => tool.id));
      if (previous) onChange(enabledTools.filter((toolId) => !previous.tools.some((tool) => tool.id === toolId) || nextIds.has(toolId)));
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  const remove = async (connection: Connection) => {
    if (!confirm(`Remove MCP server “${connection.name}”? Agents using its tools will lose access.`)) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/admin/mcp-connections?id=${encodeURIComponent(connection.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not remove connection.");
      const removedIds = connection.tools.map((tool) => tool.id);
      onChange(enabledTools.filter((id) => !removedIds.includes(id)));
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  const testTool = async (connection: Connection, tool: MCPToolOption) => {
    if (!confirm(`Run MCP tool “${tool.name}” with sample arguments? This may make real changes in the connected service.`)) return;
    const raw = window.prompt("Sample arguments as JSON", "{}");
    if (raw === null) return;
    const key = `${connection.id}:${tool.id}`;
    setBusy(true); setError(null); setTestOutput((current) => ({ ...current, [key]: "Running…" }));
    try {
      const args = JSON.parse(raw);
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Arguments must be a JSON object.");
      const response = await fetch("/api/admin/mcp-connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test", id: connection.id, toolName: tool.name, arguments: args }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "MCP tool test failed.");
      setTestOutput((current) => ({ ...current, [key]: `Success: ${data.output ?? "Tool completed."}` }));
    } catch (err) { setTestOutput((current) => ({ ...current, [key]: `Failed: ${err instanceof Error ? err.message : String(err)}` })); }
    finally { setBusy(false); }
  };

  return <section className="flex flex-col gap-3 rounded-xl border border-[var(--color-border-subtle)] p-4">
    <div>
      <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">Model Context Protocol (MCP)</h3>
      <p className="text-[11.5px] text-[var(--color-text-muted)] mt-1">Connect an HTTPS MCP server, discover its tool schemas, then allow only the actions this agent should use. Credentials stay server-side and are encrypted at rest.</p>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Connection name" maxLength={80} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-[12.5px] text-[var(--color-text-primary)]" />
      <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://example.com/mcp" maxLength={500} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-[12.5px] text-[var(--color-text-primary)]" />
      <div className="flex gap-2">
        <select value={tokenHeader} onChange={(e) => setTokenHeader(e.target.value)} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2 text-[11px] text-[var(--color-text-primary)]"><option value="authorization">Bearer</option><option value="x-api-key">x-api-key</option><option value="x-auth-token">x-auth-token</option></select>
        <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="Token (optional)" maxLength={2000} className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-[12.5px] text-[var(--color-text-primary)]" />
      </div>
      <button type="button" disabled={busy || !name.trim() || !endpoint.trim()} onClick={add} className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent-violet)] px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Connect and discover</button>
    </div>
    {connections.map((connection) => <div key={connection.id} className="rounded-lg border border-[var(--color-border-subtle)] p-3">
      <div className="flex items-center gap-2">
        <ConnectionLogo name={connection.name} />
        <div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-semibold text-[var(--color-text-primary)]">{connection.name}</div><div className="truncate text-[10.5px] text-[var(--color-text-muted)]">{connection.endpoint} · {connection.tools.length} tools {connection.hasToken ? "· credential saved" : ""}</div></div>
        <button type="button" title="Refresh tool list" disabled={busy} onClick={() => void refresh(connection.id)} className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"><RefreshCw className="h-3.5 w-3.5" /></button>
        <button type="button" title="Remove MCP server" disabled={busy} onClick={() => void remove(connection)} className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      {connection.tools.map((tool) => {
        const selected = enabledTools.includes(tool.id);
        const key = `${connection.id}:${tool.id}`;
        const isOpen = expandedTool === key;
        return <div key={tool.id} className="mt-2 rounded-md bg-[var(--color-bg-surface)] p-2.5">
          <div className="flex items-start gap-2">
            {selectable && <input aria-label={`Enable ${tool.name}`} type="checkbox" checked={selected} disabled={connection.status !== "active"} onChange={() => onChange(selected ? enabledTools.filter((id) => id !== tool.id) : [...enabledTools, tool.id])} className="mt-1 accent-violet-500" />}
            <button type="button" onClick={() => setExpandedTool(isOpen ? null : key)} aria-expanded={isOpen} className="min-w-0 flex-1 text-left"><span className="block text-[11.5px] font-semibold text-[var(--color-text-primary)]">{tool.name}</span><span className="block text-[10.5px] text-[var(--color-text-muted)]">{tool.description || "No description provided."}</span></button>
            <button type="button" onClick={() => setExpandedTool(isOpen ? null : key)} aria-label={`${isOpen ? "Hide" : "Show"} details for ${tool.name}`} aria-expanded={isOpen} className="rounded p-1 text-[var(--color-text-muted)]">{isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button>
          </div>
          {isOpen && <div className="mt-2 border-t border-[var(--color-border-subtle)] pt-2"><p className="text-[10.5px] text-[var(--color-text-secondary)]">{tool.description || "This action is provided by the connected MCP server."}</p><div className="mt-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Input schema</div><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-bg-base)] p-2 text-[9.5px] text-[var(--color-text-secondary)]">{JSON.stringify(tool.inputSchema ?? {}, null, 2)}</pre></div>}
          <button type="button" disabled={busy || connection.status !== "active"} onClick={() => void testTool(connection, tool)} className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-violet-300 disabled:opacity-40"><Activity className="size-3"/> Test action</button>
          {testOutput[key] && <span className="mt-1 block break-words text-[10px] text-[var(--color-text-muted)]">{testOutput[key]}</span>}
        </div>;
      })}
      {connection.toolsCheckedAt && <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">Last discovered {new Date(connection.toolsCheckedAt).toLocaleString()}</p>}
      {connection.status !== "active" && <p className="mt-1 text-[10.5px] text-amber-400">Connection needs refresh. {connection.lastError}</p>}
    </div>)}
    {!connections.length && <p className="text-[11px] text-[var(--color-text-muted)]">No MCP servers connected yet.</p>}
    {error && <p role="alert" className="text-[11.5px] text-red-400">{error}</p>}
  </section>;
}

function ConnectionLogo({ name }: { name: string }) {
  const domain = ({ slack: "slack.com", google: "google.com", gmail: "gmail.com", outlook: "outlook.com", microsoft: "microsoft.com", salesforce: "salesforce.com", hubspot: "hubspot.com", zendesk: "zendesk.com", notion: "notion.so", zoom: "zoom.us", shopify: "shopify.com", stripe: "stripe.com", github: "github.com", linear: "linear.app", zapier: "zapier.com", airtable: "airtable.com", calendly: "calendly.com", highlevel: "gohighlevel.com", gohighlevel: "gohighlevel.com" } as Record<string, string>)[name.toLowerCase()];
  const [failed, setFailed] = useState(false);
  return <span className="flex size-8 flex-none items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[10px] font-bold text-violet-200">{domain && !failed ? <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`} alt={`${name} logo`} className="size-5 object-contain" onError={() => setFailed(true)} /> : name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>;
}
