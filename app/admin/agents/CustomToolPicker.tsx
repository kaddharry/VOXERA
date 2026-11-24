"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Code2, ExternalLink, Loader2 } from "lucide-react";

type Tool = { id: string; functionName: string; name: string; description: string; endpoint: string; method: string; inputSchema: Record<string, unknown>; status: string; lastTestedAt: string | null };

export function CustomToolPicker({ enabledTools, onChange }: { enabledTools: string[]; onChange: (tools: string[]) => void }) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    fetch("/api/admin/tools").then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not load saved tools."); if (current) setTools(data.tools ?? []); }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  return <section className="rounded-xl border border-[var(--color-border-subtle)] p-4">
    <div className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-lg bg-violet-400/10 text-violet-300"><Code2 className="size-3.5" /></span><h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">Saved custom tools</h3><span className="rounded-full bg-[var(--color-bg-surface)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">{tools.length}</span></div>
    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Reusable HTTP actions from Tools. Select an action to give this agent access; open it to inspect its endpoint and input fields.</p>
    {loading ? <p className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><Loader2 className="size-3 animate-spin" />Loading saved tools…</p> : tools.length ? <div className="mt-3 divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-lg border border-[var(--color-border-subtle)]">
      {tools.map((tool) => {
        const selected = enabledTools.includes(tool.functionName);
        const isOpen = expanded === tool.functionName;
        let host = "";
        try { host = new URL(tool.endpoint).hostname; } catch { /* An invalid saved URL is still shown as text. */ }
        return <div key={tool.functionName} className="bg-[var(--color-bg-surface)]">
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <span className="flex size-8 flex-none items-center justify-center rounded-lg border border-violet-300/20 bg-violet-400/10 text-violet-200"><Code2 className="size-4" /></span>
            <button type="button" onClick={() => setExpanded(isOpen ? null : tool.functionName)} aria-expanded={isOpen} className="min-w-0 flex-1 text-left"><span className="block truncate text-[11.5px] font-semibold text-[var(--color-text-primary)]">{tool.name}</span><span className="block truncate text-[10px] text-[var(--color-text-muted)]">{tool.description}</span></button>
            <input aria-label={`Enable ${tool.name}`} type="checkbox" checked={selected} disabled={tool.status !== "active"} onChange={() => onChange(selected ? enabledTools.filter((id) => id !== tool.functionName) : [...enabledTools, tool.functionName])} className="accent-violet-500" />
            {tool.status !== "active" && <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-200">Disabled</span>}
            <button type="button" onClick={() => setExpanded(isOpen ? null : tool.functionName)} aria-label={`${isOpen ? "Hide" : "Show"} details for ${tool.name}`} aria-expanded={isOpen} className="rounded p-1 text-[var(--color-text-muted)]">{isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button>
          </div>
          {isOpen && <div className="border-t border-[var(--color-border-subtle)] px-3 py-3 pl-[3.35rem]"><p className="text-[10.5px] text-[var(--color-text-secondary)]">{tool.description}</p><div className="mt-2 flex flex-wrap items-center gap-2 text-[9.5px] text-[var(--color-text-muted)]"><span className="rounded bg-[var(--color-bg-base)] px-1.5 py-1 font-mono">{tool.method}</span><span className="inline-flex max-w-full items-center gap-1 truncate"><ExternalLink className="size-3 flex-none" />{host || "Endpoint not available"}</span>{tool.lastTestedAt && <span>Tested {new Date(tool.lastTestedAt).toLocaleDateString()}</span>}</div><div className="mt-2 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Input schema</div><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-bg-base)] p-2 text-[9.5px] text-[var(--color-text-secondary)]">{JSON.stringify(tool.inputSchema, null, 2)}</pre></div>}
        </div>;
      })}
    </div> : <div className="mt-3 rounded-lg border border-dashed border-[var(--color-border-subtle)] px-3 py-3 text-[11px] text-[var(--color-text-muted)]">No saved custom tools yet. Add an HTTP action in Tools to make it available here.</div>}
    {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
  </section>;
}
