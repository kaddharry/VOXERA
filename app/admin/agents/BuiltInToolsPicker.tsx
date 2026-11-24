"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronUp, ClipboardList, Loader2, ShieldCheck, Wrench } from "lucide-react";

type BuiltInTool = { id: string; name: string; category: string; description: string; inputSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } };

export function BuiltInToolsPicker({ enabledTools, onChange }: { enabledTools: string[]; onChange: (tools: string[]) => void }) {
  const [tools, setTools] = useState<BuiltInTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    fetch("/api/admin/tools").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load built-in tools.");
      if (current) setTools(data.builtIns ?? []);
    }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  const toggle = (id: string) => onChange(enabledTools.includes(id) ? enabledTools.filter((item) => item !== id) : [...enabledTools, id]);

  return <section className="rounded-xl border border-[var(--color-border-subtle)] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300"><Wrench className="size-3.5" /></span><h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">Voxera built-in tools</h3><span className="rounded-full bg-[var(--color-bg-surface)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">{tools.length}</span></div>
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Enable only actions this agent needs. Select a tool to add it; open details to inspect its inputs and behavior.</p>
      </div>
      <a href="/admin/tools" className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-violet-300 hover:text-violet-200">Browse integrations <ArrowUpRight className="size-3" /></a>
    </div>
    {loading ? <div className="mt-4 flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><Loader2 className="size-3 animate-spin" />Loading available actions…</div> : error ? <p role="alert" className="mt-3 text-xs text-red-400">{error}</p> : <div className="mt-3 divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-lg border border-[var(--color-border-subtle)]">
      {tools.map((tool) => {
        const selected = enabledTools.includes(tool.id);
        const isOpen = expanded === tool.id;
        const Icon = tool.category === "Appointments" ? CalendarDays : ClipboardList;
        const properties = Object.entries(tool.inputSchema?.properties ?? {});
        return <div key={tool.id} className="bg-[var(--color-bg-surface)]">
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <button type="button" onClick={() => toggle(tool.id)} aria-pressed={selected} aria-label={`${selected ? "Disable" : "Enable"} ${tool.name}`} className={`flex size-8 flex-none items-center justify-center rounded-lg border transition-colors ${tool.category === "Appointments" ? "border-cyan-300/20 bg-cyan-400/10 text-cyan-200" : "border-amber-300/20 bg-amber-400/10 text-amber-200"} ${selected ? "ring-1 ring-violet-400/70" : "hover:border-[var(--color-border-active)]"}`}><Icon className="size-4" /></button>
            <button type="button" onClick={() => toggle(tool.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-[11.5px] font-semibold text-[var(--color-text-primary)]">{tool.name}</span><span className="block truncate text-[10px] text-[var(--color-text-muted)]">{tool.description}</span></button>
            {selected && <Check aria-label="Enabled" className="size-3.5 text-violet-300" />}
            <button type="button" onClick={() => setExpanded(isOpen ? null : tool.id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} details for ${tool.name}`} className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">{isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button>
          </div>
          {isOpen && <div className="border-t border-[var(--color-border-subtle)] px-3 py-3 pl-[3.35rem]">
            <p className="text-[10.5px] leading-relaxed text-[var(--color-text-secondary)]">{tool.description}</p>
            {properties.length > 0 && <><div className="mt-2 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Inputs {tool.inputSchema?.required?.length ? `· ${tool.inputSchema.required.length} required` : ""}</div><div className="mt-1.5 flex flex-wrap gap-1.5">{properties.map(([key, value]) => <span key={key} title={value.description} className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-2 py-1 text-[9.5px] text-[var(--color-text-secondary)]"><code>{key}</code><span className="ml-1 text-[var(--color-text-muted)]">{value.type}</span>{tool.inputSchema?.required?.includes(key) && <span className="ml-1 text-amber-300">required</span>}</span>)}</div></>}
            {tool.category === "Appointments" && <div className="mt-2 flex items-start gap-1.5 text-[9.5px] leading-relaxed text-emerald-200/80"><ShieldCheck className="mt-0.5 size-3 flex-none" />Appointment updates require an identified patient and validated appointment details.</div>}
          </div>}
        </div>;
      })}
      {!tools.length && !error && <p className="p-3 text-[11px] text-[var(--color-text-muted)]">No built-in call actions are available.</p>}
    </div>}
  </section>;
}
