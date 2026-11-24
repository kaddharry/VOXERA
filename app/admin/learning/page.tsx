"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Lightbulb, RefreshCw, Users, Bot, Globe2, X, Loader2, Search, ChevronDown, Clock3 } from "lucide-react";
import { GlassCard } from "../../_components/GlassCard";

/**
 * Agent Learning — what the agents have learned from calls. After each call the agents save what they
 * learned, and every later call starts with it, in three scopes:
 *  - about each patient (shared by every agent that calls them),
 *  - per agent (lessons for how that agent should handle calls),
 *  - shared by all agents (a lesson two different agents learned independently).
 * Data: GET /api/admin/learnings. Anything can be forgotten.
 */

interface LearnedItem {
  id: string;
  text: string;
  category: string;
  status: "active" | "pending" | "retired";
  supportCount: number;
  updatedAt: number;
}
interface Overview {
  patients: Array<{ id: string; name: string; facts: LearnedItem[] }>;
  agents: Array<{ id: string; name: string; lessons: LearnedItem[] }>;
  shared: LearnedItem[];
  totals: { patientFacts: number; agentLessons: number; shared: number; pending: number };
  setupNeeded?: boolean;
}

function ago(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

export default function AgentLearningPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/learnings");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Couldn't load what the agents learned.");
      else {
        setError(null);
        setData(body);
      }
    } catch {
      setError("Couldn't load what the agents learned.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function forget(id: string) {
    const res = await fetch(`/api/admin/learnings?learningId=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  const q = query.trim().toLowerCase();
  const patients = useMemo(
    () => (data?.patients ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.facts.some((f) => f.text.toLowerCase().includes(q))),
    [data, q],
  );
  const t = data?.totals;

  return (
    <div className="flex h-full flex-col font-body">
      <header className="flex flex-none items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
        <div className="flex min-w-0 items-center gap-2">
          <Lightbulb className="h-4 w-4 flex-none text-[var(--color-accent-cyan)]" />
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Agent Learning</span>
          <span className="hidden truncate text-[12px] text-[var(--color-text-muted)] sm:inline">· what calls are teaching your agents</span>
        </div>
        <button
          onClick={() => void load()}
          disabled={refreshing}
          className="flex flex-none items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-60"
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-4 pb-28 pt-5 sm:p-6 sm:pb-28 md:px-10">
        {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[13px] text-red-300">{error}</p>}
        {!data && !error && <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-[var(--color-text-muted)]" />}

        {data?.setupNeeded && (
          <GlassCard className="p-5 text-[13.5px] text-[var(--color-text-secondary)]">
            Call learning isn&apos;t switched on yet — run <code>sql/migration_v36.sql</code> in Supabase.
          </GlassCard>
        )}

        {data && !data.setupNeeded && t && (
          <>
            <p className="max-w-3xl text-[13.5px] leading-relaxed text-[var(--color-text-muted)]">
              After every call the agents save what they learned, and every later call starts with it. Facts about a patient are shared by every agent
              that calls them. A lesson for how to handle calls becomes active once two calls show it, and is shared with all agents once two different
              agents learn the same thing.
            </p>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile icon={Users} label="Patient facts" value={t.patientFacts} sub={`${data.patients.length} ${data.patients.length === 1 ? "patient" : "patients"}`} accent="text-emerald-400" />
              <Tile icon={Bot} label="Agent lessons" value={t.agentLessons} sub="active" accent="text-indigo-300" />
              <Tile icon={Globe2} label="Shared lessons" value={t.shared} sub="used by every agent" accent="text-amber-300" />
              <Tile icon={Clock3} label="Waiting" value={t.pending} sub="need a second call" accent="text-[var(--color-text-secondary)]" />
            </div>

            {/* Shared by all agents */}
            <section className="space-y-3">
              <SectionTitle icon={Globe2} color="text-amber-300" title="Shared by all agents" sub="Learned independently by two or more agents — applied to every agent's calls." />
              {data.shared.length === 0 ? (
                <Empty>Nothing shared yet. A lesson appears here once two different agents learn the same thing from their calls.</Empty>
              ) : (
                <GlassCard className="divide-y divide-[var(--color-border-subtle)] p-0">
                  {data.shared.map((it) => (
                    <Row key={it.id} item={it} onForget={forget} extra={`Learned from ${it.supportCount} ${it.supportCount === 1 ? "call" : "calls"}`} />
                  ))}
                </GlassCard>
              )}
            </section>

            {/* Per agent */}
            <section className="space-y-3">
              <SectionTitle icon={Bot} color="text-indigo-300" title="Per agent" sub="How each agent has learned to handle calls." />
              {data.agents.length === 0 ? (
                <Empty>No agent lessons yet.</Empty>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {data.agents.map((a) => {
                    const active = a.lessons.filter((l) => l.status === "active").length;
                    return (
                      <Collapsible key={a.id} title={a.name} meta={`${active} active${a.lessons.length - active ? ` · ${a.lessons.length - active} waiting` : ""}`} defaultOpen={a.lessons.length <= 4}>
                        {a.lessons.map((l) => (
                          <Row key={l.id} item={l} onForget={forget} extra={l.status === "pending" ? "Waiting for one more call" : undefined} dim={l.status === "pending"} />
                        ))}
                      </Collapsible>
                    );
                  })}
                </div>
              )}
            </section>

            {/* About patients */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <SectionTitle icon={Users} color="text-emerald-400" title="About patients" sub="What each patient has told the agents. Forget anything that is wrong." />
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search patients or facts…"
                    className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] py-2 pl-9 pr-3 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent-violet)]/50 focus:outline-none"
                  />
                </div>
              </div>
              {patients.length === 0 ? (
                <Empty>{q ? "No patient or fact matches your search." : "Nothing learned about patients yet — it appears after a call where the patient speaks."}</Empty>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {patients.map((p) => (
                    <Collapsible
                      key={p.id}
                      title={p.name}
                      href={`/admin/patients/${p.id}`}
                      meta={`${p.facts.length} ${p.facts.length === 1 ? "fact" : "facts"} · updated ${ago(Math.max(...p.facts.map((f) => f.updatedAt)))}`}
                      defaultOpen={patients.length <= 2 || !!q}
                    >
                      {p.facts.map((f) => (
                        <Row key={f.id} item={f} onForget={forget} extra={f.category.charAt(0).toUpperCase() + f.category.slice(1).replace(/_/g, " ")} />
                      ))}
                    </Collapsible>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; sub: string; accent: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 py-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[11.5px] font-medium text-[var(--color-text-muted)]">{label}</p>
        <Icon className={`h-3.5 w-3.5 ${accent}`} />
      </div>
      <p className="mt-1.5 text-[26px] font-semibold leading-none tabular-nums text-[var(--color-text-primary)]">{value}</p>
      <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">{sub}</p>
    </div>
  );
}

function SectionTitle({ icon: Icon, color, title, sub }: { icon: React.ComponentType<{ className?: string }>; color: string; title: string; sub: string }) {
  return (
    <div>
      <h2 className={`flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide ${color}`}>
        <Icon className="h-3.5 w-3.5" /> {title}
      </h2>
      <p className="mt-0.5 text-[12.5px] text-[var(--color-text-muted)]">{sub}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <GlassCard className="p-4 text-[13px] text-[var(--color-text-muted)]">{children}</GlassCard>;
}

function Row({ item, onForget, extra, dim }: { item: LearnedItem; onForget: (id: string) => Promise<void>; extra?: string; dim?: boolean }) {
  return (
    <div className="group flex items-start justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className={`text-[13.5px] leading-snug ${dim ? "text-[var(--color-text-muted)]" : "text-[var(--color-text-secondary)]"}`}>{item.text}</p>
        {extra && <p className="mt-0.5 text-[11.5px] text-[var(--color-text-muted)]">{extra}</p>}
      </div>
      <button
        onClick={() => void onForget(item.id)}
        title="Forget this"
        className="mt-0.5 flex-none rounded p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Collapsible({ title, meta, href, defaultOpen, children }: { title: string; meta: string; href?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <GlassCard className="overflow-hidden p-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          {href ? (
            <Link href={href} onClick={(e) => e.stopPropagation()} className="truncate text-[14px] font-semibold text-[var(--color-text-primary)] hover:underline">
              {title}
            </Link>
          ) : (
            <p className="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">{title}</p>
          )}
          <p className="text-[11.5px] text-[var(--color-text-muted)]">{meta}</p>
        </div>
        <ChevronDown className={`h-4 w-4 flex-none text-[var(--color-text-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="divide-y divide-[var(--color-border-subtle)] border-t border-[var(--color-border-subtle)]">{children}</div>}
    </GlassCard>
  );
}
