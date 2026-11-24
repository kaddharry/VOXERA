"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, ChevronUp, Loader2, Search, Wrench } from "lucide-react";

type RemoteTool = { id: string; name: string; description?: string; inputSchema?: Record<string, unknown> };
type Connection = { id: string; name: string; status: string; tools: RemoteTool[] };
type Integration = { name: string; category: string; domain: string; color: string };

const APPS: Integration[] = [
  { name: "Google Calendar", category: "Calendar", domain: "calendar.google.com", color: "4285F4" },
  { name: "Google Sheets", category: "Productivity", domain: "sheets.google.com", color: "34A853" },
  { name: "Gmail", category: "Email", domain: "gmail.com", color: "EA4335" },
  { name: "Google Drive", category: "Files", domain: "drive.google.com", color: "4285F4" },
  { name: "Slack", category: "Communication", domain: "slack.com", color: "4A154B" },
  { name: "Microsoft Outlook", category: "Email & calendar", domain: "outlook.com", color: "0078D4" },
  { name: "Salesforce", category: "CRM", domain: "salesforce.com", color: "00A1E0" },
  { name: "HubSpot", category: "CRM", domain: "hubspot.com", color: "FF7A59" },
  { name: "GoHighLevel", category: "CRM", domain: "gohighlevel.com", color: "188BF6" },
  { name: "Zendesk", category: "Support", domain: "zendesk.com", color: "03363D" },
  { name: "Shopify", category: "Commerce", domain: "shopify.com", color: "7AB55C" },
  { name: "Stripe", category: "Payments", domain: "stripe.com", color: "635BFF" },
  { name: "Notion", category: "Productivity", domain: "notion.so", color: "FFFFFF" },
  { name: "Airtable", category: "Productivity", domain: "airtable.com", color: "FCB400" },
  { name: "Calendly", category: "Calendar", domain: "calendly.com", color: "006BFF" },
  { name: "Zoom", category: "Communication", domain: "zoom.us", color: "0B5CFF" },
  { name: "Trello", category: "Productivity", domain: "trello.com", color: "0052CC" },
  { name: "Asana", category: "Productivity", domain: "asana.com", color: "F06A6A" },
  { name: "Jira", category: "Productivity", domain: "atlassian.com", color: "2684FF" },
  { name: "Linear", category: "Productivity", domain: "linear.app", color: "8B5CF6" },
  { name: "Make", category: "Automation", domain: "make.com", color: "6D00CC" },
  { name: "n8n", category: "Automation", domain: "n8n.io", color: "EA4B71" },
  { name: "Zapier MCP", category: "Integration hub", domain: "zapier.com", color: "FF4A00" },
];

export function PrebuiltIntegrationsPicker({ enabledTools, onChange }: { enabledTools: string[]; onChange: (tools: string[]) => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    fetch("/api/admin/tools").then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not load connected integrations."); if (current) setConnections(data.mcpConnections ?? []); }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  const visibleApps = useMemo(() => APPS.filter((app) => `${app.name} ${app.category}`.toLowerCase().includes(query.trim().toLowerCase())), [query]);
  const connectionFor = (app: Integration) => connections.find((connection) => connection.name.toLowerCase().includes(app.name.toLowerCase()) || (app.name === "Zapier MCP" && connection.name.toLowerCase().includes("zapier")));

  return <section className="rounded-xl border border-[var(--color-border-subtle)] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-lg bg-blue-400/10 text-blue-200"><Wrench className="size-3.5" /></span><h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">Prebuilt app integrations</h3><span className="rounded-full bg-[var(--color-bg-surface)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">{APPS.length}</span></div><p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Connect an app once in Tools, then select its discovered actions for this agent.</p></div>
      <a href="/admin/tools" className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-violet-300 hover:text-violet-200">Manage integrations <ArrowUpRight className="size-3" /></a>
    </div>
    <label className="relative mt-3 block"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find Google Calendar, Slack, CRM…" className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] py-2 pl-8 pr-3 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-active)]" /></label>
    {loading ? <p className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><Loader2 className="size-3 animate-spin" />Loading integrations…</p> : error ? <p role="alert" className="mt-3 text-xs text-red-400">{error}</p> : <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {visibleApps.map((app) => {
        const connection = connectionFor(app);
        const ready = connection?.status === "active";
        const isOpen = expanded === app.name;
        const tools = connection?.tools ?? [];
        return <div key={app.name} className="min-w-0 overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span className="flex size-8 flex-none items-center justify-center rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-1.5"><img src={`https://www.google.com/s2/favicons?domain=${app.domain}&sz=64`} alt={`${app.name} logo`} className="size-full object-contain" loading="lazy" /></span>
            <button type="button" onClick={() => setExpanded(isOpen ? null : app.name)} aria-expanded={isOpen} className="min-w-0 flex-1 text-left"><span className="block truncate text-[10.5px] font-semibold text-[var(--color-text-primary)]">{app.name}</span><span className="block truncate text-[9px] text-[var(--color-text-muted)]">{ready ? `${tools.length} actions · connected` : connection ? "Reconnect in Tools" : `${app.category} · connect in Tools`}</span></button>
            {ready && tools.some((tool) => enabledTools.includes(tool.id)) && <Check aria-label="Actions enabled" className="size-3.5 flex-none text-emerald-300" />}
            <button type="button" onClick={() => setExpanded(isOpen ? null : app.name)} aria-label={`${isOpen ? "Hide" : "Show"} ${app.name} actions`} aria-expanded={isOpen} className="rounded p-1 text-[var(--color-text-muted)]">{isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button>
          </div>
          {isOpen && <div className="border-t border-[var(--color-border-subtle)] p-2.5">{ready && tools.length ? <div className="space-y-1.5">{tools.map((tool) => { const selected = enabledTools.includes(tool.id); return <label key={tool.id} className="flex cursor-pointer items-start gap-2 rounded-md bg-[var(--color-bg-base)] p-2"><input type="checkbox" checked={selected} onChange={() => onChange(selected ? enabledTools.filter((id) => id !== tool.id) : [...enabledTools, tool.id])} className="mt-0.5 accent-violet-500" /><span className="min-w-0"><span className="block text-[10px] font-semibold text-[var(--color-text-primary)]">{tool.name}</span><span className="block text-[9px] text-[var(--color-text-muted)]">{tool.description || "No action description provided."}</span></span></label>; })}</div> : <div><p className="text-[9.5px] leading-relaxed text-[var(--color-text-muted)]">{connection ? "This connection is not active. Refresh it to discover actions." : "Connect this app through its MCP provider to discover actions you can assign to this agent."}</p><a href={`/admin/tools?connect=${encodeURIComponent(app.name)}`} className="mt-2 inline-flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1.5 text-[9.5px] font-semibold text-violet-200 hover:bg-[var(--color-bg-elevated)]">Connect {app.name} in Tools <ArrowUpRight className="size-3" /></a></div>}</div>}
        </div>;
      })}
      {visibleApps.length === 0 && <p className="col-span-full py-5 text-center text-[10.5px] text-[var(--color-text-muted)]">No integrations match that search.</p>}
    </div>}
  </section>;
}
