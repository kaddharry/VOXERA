"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, CalendarDays, Check, ChevronDown, ChevronUp, ClipboardList, Code2, ExternalLink, Loader2, Plus, Search, ShieldCheck, Trash2, Wrench, X } from "lucide-react";
import { MCPToolsPanel } from "../agents/MCPToolsPanel";

type Tool = { id: string; functionName: string; name: string; description: string; endpoint: string; method: string; inputSchema: Record<string, unknown>; hasSecret: boolean; status: string; lastTestedAt: string | null; lastError: string | null };
type BuiltIn = { id: string; name: string; category: string; description: string; inputSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } };
type Connection = { id: string; name: string; endpoint: string; status: string; tools: Array<{ name: string; description?: string }>; tools_checked_at?: string | null; last_error?: string | null };
type Catalog = { tools: Tool[]; builtIns: BuiltIn[]; mcpConnections: Connection[] };
type Integration = { name: string; category: string; slug: string; color: string; logoDomain?: string; via: string; url: string };

const INTEGRATIONS: Integration[] = [
  { name: "Google Calendar", category: "Calendar", slug: "googlecalendar", color: "4285F4", via: "Zapier MCP or Google API", url: "https://docs.vapi.ai/tools/google-calendar" },
  { name: "Google Sheets", category: "Productivity", slug: "googlesheets", color: "34A853", via: "Zapier MCP", url: "https://docs.vapi.ai/tools/integrations" },
  { name: "Gmail", category: "Email", slug: "gmail", color: "EA4335", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Google Drive", category: "Files", slug: "googledrive", color: "4285F4", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Slack", category: "Communication", slug: "slack", color: "4A154B", logoDomain: "slack.com", via: "Zapier MCP or Slack API", url: "https://docs.vapi.ai/tools/integrations" },
  { name: "Microsoft Outlook", category: "Email & calendar", slug: "microsoftoutlook", color: "0078D4", logoDomain: "outlook.com", via: "Zapier MCP or Microsoft Graph", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Salesforce", category: "CRM", slug: "salesforce", color: "00A1E0", logoDomain: "salesforce.com", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "HubSpot", category: "CRM", slug: "hubspot", color: "FF7A59", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "GoHighLevel", category: "CRM", slug: "gohighlevel", color: "188BF6", logoDomain: "gohighlevel.com", via: "GoHighLevel MCP or API", url: "https://docs.vapi.ai/tools/integrations" },
  { name: "Zendesk", category: "Support", slug: "zendesk", color: "03363D", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Shopify", category: "Commerce", slug: "shopify", color: "7AB55C", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Stripe", category: "Payments", slug: "stripe", color: "635BFF", via: "Zapier MCP or Stripe API", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Notion", category: "Productivity", slug: "notion", color: "FFFFFF", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Airtable", category: "Productivity", slug: "airtable", color: "FCB400", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Calendly", category: "Calendar", slug: "calendly", color: "006BFF", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Zoom", category: "Communication", slug: "zoom", color: "0B5CFF", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Trello", category: "Productivity", slug: "trello", color: "0052CC", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Asana", category: "Productivity", slug: "asana", color: "F06A6A", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Jira", category: "Productivity", slug: "jira", color: "2684FF", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
  { name: "Linear", category: "Productivity", slug: "linear", color: "8B5CF6", via: "Linear MCP or API", url: "https://linear.app/docs/mcp" },
  { name: "Make", category: "Automation", slug: "make", color: "6D00CC", via: "Make MCP or webhook", url: "https://www.make.com/en/integrations" },
  { name: "n8n", category: "Automation", slug: "n8n", color: "EA4B71", via: "n8n MCP or webhook", url: "https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server/" },
  { name: "Zapier MCP", category: "Integration hub", slug: "zapier", color: "FF4A00", via: "Native MCP", url: "https://help.zapier.com/hc/en-us/articles/48308034391821-What-is-Zapier-MCP" },
];

const EMPTY_SCHEMA = JSON.stringify({ type: "object", properties: {}, required: [] }, null, 2);
const inputClass = "w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-violet-400/60";

export function ToolsRegistry() {
  const [catalog, setCatalog] = useState<Catalog>({ tools: [], builtIns: [], mcpConnections: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All apps");
  const [selectedIntegration, setSelectedIntegration] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Tool | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", endpoint: "", method: "POST", headers: "{}", secret: "", secretHeader: "authorization", inputSchema: EMPTY_SCHEMA, sampleInput: "{}" });
  const [testResult, setTestResult] = useState("");
  const [expandedBuiltIn, setExpandedBuiltIn] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/tools");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load tools.");
      setCatalog(data);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("connect");
    if (!requested) return;
    const integration = INTEGRATIONS.find((item) => item.name.toLowerCase() === requested.toLowerCase());
    if (integration) {
      setSelectedIntegration(integration.name);
      setShowConnect(true);
    }
  }, []);

  const categories = useMemo(() => ["All apps", ...new Set(INTEGRATIONS.map((item) => item.category))], []);
  const visibleIntegrations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return INTEGRATIONS.filter((item) => (category === "All apps" || item.category === category) && (!query || `${item.name} ${item.category} ${item.via}`.toLowerCase().includes(query)));
  }, [category, search]);

  const connectionFor = (integration: Integration) => catalog.mcpConnections.find((connection) => connection.name.toLowerCase().includes(integration.name.toLowerCase()));
  const openConnector = (integration: Integration) => {
    setSelectedIntegration(integration.name);
    setShowConnect(true);
  };

  const createCustomTool = () => {
    setEditing(null);
    setForm({ name: "", description: "", endpoint: "", method: "POST", headers: "{}", secret: "", secretHeader: "authorization", inputSchema: EMPTY_SCHEMA, sampleInput: "{}" });
    setTestResult("");
    setError("");
    setShowForm(true);
  };

  const editCustomTool = (tool: Tool) => {
    setEditing(tool);
    setForm({ name: tool.name, description: tool.description, endpoint: tool.endpoint, method: tool.method, headers: "{}", secret: "", secretHeader: "authorization", inputSchema: JSON.stringify(tool.inputSchema, null, 2), sampleInput: "{}" });
    setTestResult("");
    setError("");
    setShowForm(true);
  };

  const saveOrTest = async (action: "save" | "test") => {
    setBusy(true);
    setError("");
    setTestResult("");
    try {
      const payload = { ...form, inputSchema: JSON.parse(form.inputSchema), headers: JSON.parse(form.headers), sampleInput: JSON.parse(form.sampleInput), id: editing?.id };
      const response = await fetch(`/api/admin/tools${action === "test" ? "?action=test" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Tool operation failed.");
      if (action === "test") setTestResult(data.output || "Connection succeeded.");
      else { setShowForm(false); await load(); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the JSON fields and try again.");
    } finally {
      setBusy(false);
    }
  };

  const removeCustomTool = async (tool: Tool) => {
    if (!confirm(`Remove “${tool.name}”? Agents using it will lose access.`)) return;
    const response = await fetch(`/api/admin/tools?id=${encodeURIComponent(tool.id)}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not remove tool."); return; }
    await load();
  };

  const toggleCustomTool = async (tool: Tool) => {
    const status = tool.status === "disabled" ? "active" : "disabled";
    const response = await fetch("/api/admin/tools", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: tool.id, status }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not update tool."); return; }
    await load();
  };

  return (
    <div className="flex h-full flex-col font-body">
      <header className="flex flex-none items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
        <div className="flex min-w-0 items-center gap-2">
          <Wrench className="h-4 w-4 flex-none text-[var(--color-accent-cyan)]" />
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Tools</span>
          <span className="hidden truncate text-[12px] text-[var(--color-text-muted)] sm:inline">· integrations for your voice agents</span>
        </div>
        <button onClick={createCustomTool} className="inline-flex flex-none items-center gap-1.5 rounded-lg btn-gradient px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-all hover:scale-[1.02]">
          <Plus className="h-3.5 w-3.5" /> Create tool
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-10 md:py-6">
        <section aria-labelledby="prebuilt-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 id="prebuilt-title" className="text-[17px] font-semibold tracking-tight text-[var(--color-text-primary)]">Prebuilt integrations</h1>
              <span className="text-[11px] text-[var(--color-text-muted)]">{INTEGRATIONS.length} apps</span>
            </div>
            <label className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search apps" className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] py-2 pl-8 pr-3 text-[11.5px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-active)]" />
            </label>
          </div>

          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
            {categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={`flex-none rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors ${category === item ? "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"}`}>{item}</button>)}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visibleIntegrations.map((integration) => {
              const connected = connectionFor(integration);
              return (
                <button key={integration.name} type="button" onClick={() => openConnector(integration)} className="group flex min-w-0 items-center gap-2.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2.5 py-2 text-left transition-colors hover:border-[var(--color-border-active)] hover:bg-[var(--color-bg-elevated)]">
                  <IntegrationLogo integration={integration} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-semibold text-[var(--color-text-primary)]">{integration.name}</span>
                    <span className="block truncate text-[9.5px] text-[var(--color-text-muted)]">{connected ? `${connected.tools.length} tools connected` : integration.category}</span>
                  </span>
                  {connected ? <Check className="h-3.5 w-3.5 flex-none text-emerald-400" /> : <Plus className="h-3.5 w-3.5 flex-none text-[var(--color-text-muted)] transition-colors group-hover:text-[var(--color-text-primary)]" />}
                </button>
              );
            })}
            {visibleIntegrations.length === 0 && <p className="col-span-full py-6 text-center text-xs text-[var(--color-text-muted)]">No apps match this search.</p>}
          </div>
          <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">Connect an app through its MCP provider to discover its available actions. Each agent gets only the tools you enable.</p>
        </section>

        {error && <p role="alert" className="mt-4 rounded-lg border border-red-400/25 bg-red-400/5 px-3 py-2 text-xs text-red-300">{error}</p>}

        <section className="mt-7 border-t border-[var(--color-border-subtle)] pt-5" aria-labelledby="connected-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2"><h2 id="connected-title" className="text-[14px] font-semibold text-[var(--color-text-primary)]">Connected integrations</h2><span className="text-[10px] text-[var(--color-text-muted)]">{catalog.mcpConnections.length}</span></div>
            <button onClick={() => { setSelectedIntegration(""); setShowConnect(true); }} className="text-[10.5px] font-semibold text-violet-300 hover:text-violet-200">Add MCP server</button>
          </div>
          {loading ? <p className="flex items-center gap-2 py-3 text-[11px] text-[var(--color-text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading tools…</p> : catalog.mcpConnections.length ? <div className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            {catalog.mcpConnections.map((connection) => <div key={connection.id} className="flex items-center gap-2.5 px-3 py-2.5">
              <IntegrationLogo integration={INTEGRATIONS.find((item) => connection.name.toLowerCase().includes(item.name.toLowerCase())) ?? { name: connection.name, category: "MCP", slug: "", color: "8B5CF6", via: "MCP", url: "" }} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] font-semibold text-[var(--color-text-primary)]">{connection.name}</span><span className="block text-[9.5px] text-[var(--color-text-muted)]">{connection.tools.length} tools · {connection.status}</span></span>
              <span className={`h-1.5 w-1.5 rounded-full ${connection.status === "active" ? "bg-emerald-400" : "bg-amber-400"}`} />
              <button title="Manage MCP connection" onClick={() => { setSelectedIntegration(connection.name.replace(/ MCP$/i, "")); setShowConnect(true); }} className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"><ArrowRight className="h-3.5 w-3.5" /></button>
            </div>)}
          </div> : <p className="rounded-xl border border-dashed border-[var(--color-border-subtle)] px-3 py-3 text-[11px] text-[var(--color-text-muted)]">No integrations connected yet. Choose an app above to connect it.</p>}
        </section>

        <section className="mt-7 border-t border-[var(--color-border-subtle)] pt-5" aria-labelledby="custom-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2"><h2 id="custom-title" className="text-[14px] font-semibold text-[var(--color-text-primary)]">Custom tools</h2><span className="text-[10px] text-[var(--color-text-muted)]">{catalog.tools.length}</span></div>
            <button onClick={createCustomTool} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-[10.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]"><Plus className="h-3 w-3" /> Create tool</button>
          </div>
          {catalog.tools.length ? <div className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            {catalog.tools.map((tool) => <div key={tool.id} className="flex items-center gap-2.5 px-3 py-2.5">
              <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg ${tool.status === "active" ? "bg-violet-400/10 text-violet-200" : "bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]"}`}><Code2 className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] font-semibold text-[var(--color-text-primary)]">{tool.name}</span><span className="block truncate text-[9.5px] text-[var(--color-text-muted)]">{tool.method} · {tool.description}</span></span>
              <span title={tool.hasSecret ? "Credential saved" : "No credential"}>{tool.hasSecret && <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}</span>
              <button onClick={() => editCustomTool(tool)} className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[9.5px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">Configure</button>
              <button onClick={() => void toggleCustomTool(tool)} className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[9.5px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">{tool.status === "disabled" ? "Enable" : "Disable"}</button>
              <button title="Remove custom tool" onClick={() => void removeCustomTool(tool)} className="rounded p-1 text-[var(--color-text-muted)] hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>)}
          </div> : <button onClick={createCustomTool} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-[var(--color-border-subtle)] px-3 py-3 text-left text-[11px] text-[var(--color-text-muted)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]"><Plus className="h-3.5 w-3.5" /> Add your first custom HTTP tool</button>}
        </section>

        <details className="group mt-7 border-t border-[var(--color-border-subtle)] pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[12px] font-semibold text-[var(--color-text-secondary)]"><Wrench className="h-3.5 w-3.5 text-[var(--color-accent-cyan)]" /> Voxera built-in actions <span className="text-[10px] font-normal text-[var(--color-text-muted)]">{catalog.builtIns.length}</span><ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-180" /></summary>
          <div className="mt-2 divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            {catalog.builtIns.map((tool) => {
              const Icon = tool.category === "Appointments" ? CalendarDays : ClipboardList;
              const open = expandedBuiltIn === tool.id;
              const fields = Object.entries(tool.inputSchema?.properties ?? {});
              return <div key={tool.id} className="bg-[var(--color-bg-surface)]">
                <button type="button" onClick={() => setExpandedBuiltIn(open ? null : tool.id)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--color-bg-elevated)]">
                  <span className={`flex size-8 flex-none items-center justify-center rounded-lg ${tool.category === "Appointments" ? "bg-cyan-400/10 text-cyan-300" : "bg-amber-400/10 text-amber-200"}`}><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-[10.5px] font-medium text-[var(--color-text-primary)]">{tool.name}</span><span className="block text-[9px] text-[var(--color-text-muted)]">{tool.description}</span></span>
                  <span className="text-[9px] text-[var(--color-text-muted)]">{tool.category}</span>{open ? <ChevronUp className="size-3.5 text-[var(--color-text-muted)]" /> : <ChevronDown className="size-3.5 text-[var(--color-text-muted)]" />}
                </button>
                {open && <div className="border-t border-[var(--color-border-subtle)] px-3 py-3 pl-[3.4rem]"><p className="text-[10px] leading-relaxed text-[var(--color-text-secondary)]">{tool.description}</p>{fields.length > 0 && <><div className="mt-2 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Inputs</div><div className="mt-1.5 flex flex-wrap gap-1.5">{fields.map(([key, value]) => <span key={key} title={value.description} className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-2 py-1 text-[9px] text-[var(--color-text-secondary)]"><code>{key}</code><span className="ml-1 text-[var(--color-text-muted)]">{value.type}</span>{tool.inputSchema?.required?.includes(key) && <span className="ml-1 text-amber-300">required</span>}</span>)}</div></>}{tool.category === "Appointments" && <p className="mt-2 flex items-center gap-1.5 text-[9px] text-emerald-200/80"><ShieldCheck className="size-3" />Requires caller identity to be established before patient updates.</p>}</div>}
              </div>;
            })}
          </div>
          <p className="mt-2 text-[9.5px] text-[var(--color-text-muted)]">Built-ins are enabled per agent from Agent Builder → Tools. Appointment actions verify patient identity before making changes.</p>
        </details>
      </main>

      {showConnect && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowConnect(false); }}>
        <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 shadow-2xl sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3"><div className="flex items-center gap-2.5"><IntegrationLogo integration={INTEGRATIONS.find((item) => item.name === selectedIntegration) ?? { name: "MCP server", category: "MCP", slug: "", color: "8B5CF6", via: "MCP", url: "" }} /><div><h2 className="text-[14px] font-semibold text-[var(--color-text-primary)]">{selectedIntegration ? `Connect ${selectedIntegration}` : "Connect MCP server"}</h2><p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">Discover provider actions once, then enable them for each agent.</p></div></div><button onClick={() => { setShowConnect(false); void load(); }} aria-label="Close connect dialog" className="rounded p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"><X className="h-4 w-4" /></button></div>
          {selectedIntegration && <div className="mb-3 flex items-center justify-between rounded-lg bg-[var(--color-bg-base)] px-3 py-2 text-[10px] text-[var(--color-text-muted)]"><span>Connection method: {INTEGRATIONS.find((item) => item.name === selectedIntegration)?.via ?? "MCP"}</span><a href={INTEGRATIONS.find((item) => item.name === selectedIntegration)?.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200">Setup guide <ExternalLink className="h-3 w-3" /></a></div>}
          <MCPToolsPanel enabledTools={[]} onChange={() => {}} initialName={selectedIntegration ? `${selectedIntegration} MCP` : ""} selectable={false} />
          <p className="mt-3 text-[9.5px] leading-4 text-[var(--color-text-muted)]">Voxera supports HTTPS MCP servers using no auth or a static bearer/API key. OAuth-only providers need a compatible gateway. Tool execution follows the server’s configured permissions.</p>
        </div>
      </div>}

      {showForm && <CustomToolDialog
        form={form}
        setForm={setForm}
        editing={editing}
        busy={busy}
        error={error}
        testResult={testResult}
        close={() => setShowForm(false)}
        save={() => void saveOrTest("save")}
        test={() => void saveOrTest("test")}
      />}
    </div>
  );
}

function IntegrationLogo({ integration }: { integration: Pick<Integration, "name" | "slug" | "color" | "logoDomain"> }) {
  const [failed, setFailed] = useState(false);
  return <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-1.5">
    {!failed && integration.logoDomain ? <img src={`https://www.google.com/s2/favicons?domain=${integration.logoDomain}&sz=64`} alt={`${integration.name} logo`} loading="lazy" className="h-full w-full object-contain" onError={() => setFailed(true)} /> : !failed && integration.slug ? <img src={`https://cdn.simpleicons.org/${integration.slug}/${integration.color}`} alt={`${integration.name} logo`} loading="lazy" className="h-full w-full object-contain" onError={() => setFailed(true)} /> : <span aria-hidden="true" className="text-[9px] font-bold" style={{ color: `#${integration.color}` }}>{integration.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span>}
  </span>;
}

type ToolForm = { name: string; description: string; endpoint: string; method: string; headers: string; secret: string; secretHeader: string; inputSchema: string; sampleInput: string };
function CustomToolDialog({ form, setForm, editing, busy, error, testResult, close, save, test }: { form: ToolForm; setForm: (value: ToolForm) => void; editing: Tool | null; busy: boolean; error: string; testResult: string; close: () => void; save: () => void; test: () => void }) {
  const update = (key: keyof ToolForm, value: string) => setForm({ ...form, [key]: value });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-2xl">
      <div className="flex items-center justify-between"><div><h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">{editing ? "Configure custom tool" : "Create custom tool"}</h2><p className="mt-1 text-[10.5px] text-[var(--color-text-muted)]">Define an HTTPS action, its input schema, and optional credential.</p></div><button onClick={close} aria-label="Close tool dialog" className="rounded p-2 text-[var(--color-text-muted)]"><X className="h-4 w-4" /></button></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Tool name"><input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="e.g. Find order" className={inputClass} /></Field>
        <Field label="HTTP method"><select value={form.method} onChange={(event) => update("method", event.target.value)} className={inputClass}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => <option key={method}>{method}</option>)}</select></Field>
        <Field label="HTTPS endpoint" wide><input value={form.endpoint} onChange={(event) => update("endpoint", event.target.value)} placeholder="https://api.example.com/orders/lookup" className={inputClass} /></Field>
        <Field label="Description for the agent" wide><textarea value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="When and how should the agent use this action?" rows={2} className={inputClass} /></Field>
        <Field label="Input JSON schema"><textarea value={form.inputSchema} onChange={(event) => update("inputSchema", event.target.value)} rows={7} className={`${inputClass} font-mono text-[10.5px]`} /></Field>
        <Field label="Sample input for test"><textarea value={form.sampleInput} onChange={(event) => update("sampleInput", event.target.value)} rows={7} className={`${inputClass} font-mono text-[10.5px]`} /></Field>
        <Field label="Additional headers (JSON)"><textarea value={form.headers} onChange={(event) => update("headers", event.target.value)} rows={3} className={`${inputClass} font-mono text-[10.5px]`} /></Field>
        <Field label="Authentication"><div className="flex gap-2"><select value={form.secretHeader} onChange={(event) => update("secretHeader", event.target.value)} className={`${inputClass} w-36`}>{[["authorization", "Bearer"], ["x-api-key", "x-api-key"], ["x-auth-token", "x-auth-token"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input type="password" value={form.secret} onChange={(event) => update("secret", event.target.value)} placeholder={editing?.hasSecret ? "Saved · enter to rotate" : "Optional credential"} className={inputClass} /></div></Field>
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
      {testResult && <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3"><div className="text-[10.5px] font-semibold text-emerald-200">Test succeeded</div><pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--color-text-secondary)]">{testResult}</pre></div>}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2"><button disabled={busy || !editing} onClick={test} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-[10.5px] font-semibold text-[var(--color-text-secondary)] disabled:opacity-50"><Activity className="h-3.5 w-3.5" /> Test tool</button><button disabled={busy || !form.name || !form.endpoint || !form.description} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg btn-gradient px-3.5 py-2 text-[10.5px] font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save tool</button></div>
      <p className="mt-2 text-[9px] leading-4 text-[var(--color-text-muted)]">Tests send sample input to the endpoint and may trigger real side effects. Use safe data.</p>
    </div>
  </div>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`block ${wide ? "md:col-span-2" : ""}`}><span className="mb-1 block text-[9.5px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{label}</span>{children}</label>;
}
