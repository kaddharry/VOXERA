"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Lightbulb, RefreshCw, Users, Bot, Globe2, X, Loader2, Search, Clock3 } from "lucide-react";

/**
 * Agent Learning — what the agents have learned from calls, on ONE screen: lessons shared by all agents and
 * per-agent lessons on the left, what each patient told the agents on the right. After each call the agents
 * save what they learned and every later call starts with it. Anything can be forgotten.
 * Data: GET /api/admin/learnings.
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
      <header className="flex flex-none items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-6 py-2.5 md:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <Lightbulb className="h-4 w-4 flex-none text-[var(--color-accent-cyan)]" />
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Agent Learning</span>
          <span className="hidden truncate text-[12px] text-[var(--color-text-muted)] md:inline">· after every call the agents save what they learned; every later call starts with it</span>
        </div>
        <div className="flex flex-none items-center gap-2">
          {t && !data?.setupNeeded && (
            <div className="hidden items-center gap-1.5 lg:flex">
              <Pill icon={Users} tone="text-emerald-400" value={t.patientFacts} label="patient facts" />
              <Pill icon={Bot} tone="text-indigo-300" value={t.agentLessons} label="agent lessons" />
              <Pill icon={Globe2} tone="text-amber-300" value={t.shared} label="shared" />
              <Pill icon={Clock3} tone="text-[var(--color-text-secondary)]" value={t.pending} label="waiting" />
            </div>
          )}
          <button
            onClick={() => void load()}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-60"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-24 lg:overflow-hidden lg:pb-4 md:px-8">
        {error && <p className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[13px] text-red-300">{error}</p>}
        {!data && !error && <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-[var(--color-text-muted)]" />}

        {data?.setupNeeded && (
          <p className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 text-[13.5px] text-[var(--color-text-secondary)]">
            Call learning isn&apos;t switched on yet — run <code>sql/migration_v36.sql</code> in Supabase.
          </p>
        )}

        {data && !data.setupNeeded && (
          <div className="grid h-full grid-cols-1 gap-3 lg:grid-cols-12 lg:grid-rows-1">
            {/* LEFT: shared + per agent */}
            <div className="flex min-h-0 flex-col gap-3 lg:col-span-4">
              <Panel
                icon={Globe2}
                tone="text-amber-300"
                title="Shared by all agents"
                hint="Used in every agent's calls. A lesson is shared once two different agents — or three separate calls — show it."
                count={data.shared.length}
                className="lg:max-h-[34%]"
              >
                {data.shared.length === 0 ? (
                  <Empty>Nothing shared yet — it appears once a lesson shows up in three separate calls.</Empty>
                ) : (
                  data.shared.map((it) => <Lesson key={it.id} item={it} onForget={forget} meta={`from ${it.supportCount} calls`} />)
                )}
              </Panel>

              <Panel icon={Bot} tone="text-indigo-300" title="Per agent" hint="Active after two calls show the same thing." count={data.agents.reduce((n, a) => n + a.lessons.length, 0)} className="flex-1">
                {data.agents.length === 0 ? (
                  <Empty>No agent lessons yet.</Empty>
                ) : (
                  data.agents.map((a) => (
                    <div key={a.id}>
                      <p className="sticky top-0 z-10 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-text-primary)]">
                        {a.name}
                        <span className="ml-2 font-normal text-[var(--color-text-muted)]">
                          {a.lessons.filter((l) => l.status === "active").length} active · {a.lessons.filter((l) => l.status === "pending").length} waiting
                        </span>
                      </p>
                      {[...a.lessons].sort((x, y) => Number(y.status === "active") - Number(x.status === "active") || y.supportCount - x.supportCount).map((l) => (
                        <Lesson key={l.id} item={l} onForget={forget} dim={l.status === "pending"} meta={l.status === "pending" ? "waiting for a 2nd call" : `from ${l.supportCount} calls`} />
                      ))}
                    </div>
                  ))
                )}
              </Panel>
            </div>

            {/* RIGHT: patients */}
            <Panel
              icon={Users}
              tone="text-emerald-400"
              title="About patients"
              hint="What each patient told the agents — shared by every agent that calls them."
              count={patients.reduce((n, p) => n + p.facts.length, 0)}
              className="min-h-[320px] lg:col-span-8"
              action={
                <div className="relative w-44">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search…"
                    className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] py-1 pl-7 pr-2 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent-violet)]/50 focus:outline-none"
                  />
                </div>
              }
              bodyClassName="p-2"
            >
              {patients.length === 0 ? (
                <Empty>{q ? "No patient or fact matches." : "Nothing learned about patients yet — it appears after a call where the patient speaks."}</Empty>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {patients.map((p) => (
                    <div key={p.id} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]/50 p-2.5">
                      <Link href={`/admin/patients/${p.id}`} className="block truncate text-[12.5px] font-semibold text-[var(--color-text-primary)] hover:underline">
                        {p.name}
                      </Link>
                      <ul className="mt-1 space-y-1">
                        {p.facts.map((f) => (
                          <li key={f.id} className="group flex items-start justify-between gap-1" title={f.category.replace(/_/g, " ")}>
                            <span className="text-[11px] leading-snug text-[var(--color-text-secondary)]">• {f.text}</span>
                            <button onClick={() => void forget(f.id)} title="Forget this" className="mt-0.5 flex-none rounded text-[var(--color-text-muted)] opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 group-hover:opacity-100">
                              <X className="h-3 w-3" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

function Pill({ icon: Icon, tone, value, label }: { icon: React.ComponentType<{ className?: string }>; tone: string; value: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2.5 py-1 text-[12px] text-[var(--color-text-muted)]">
      <Icon className={`h-3 w-3 ${tone}`} />
      <b className="tabular-nums text-[var(--color-text-primary)]">{value}</b> {label}
    </span>
  );
}

function Panel({
  icon: Icon,
  tone,
  title,
  hint,
  count,
  action,
  className = "",
  bodyClassName = "",
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  title: string;
  hint: string;
  count: number;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] ${className}`}>
      <div className="flex flex-none items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <div className="min-w-0">
          <h2 className={`flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide ${tone}`}>
            <Icon className="h-3.5 w-3.5" /> {title} <span className="font-medium normal-case text-[var(--color-text-muted)]">· {count}</span>
          </h2>
          <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-text-muted)]">{hint}</p>
        </div>
        {action}
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-3 text-[12.5px] text-[var(--color-text-muted)]">{children}</p>;
}

function Lesson({ item, onForget, meta, dim }: { item: LearnedItem; onForget: (id: string) => Promise<void>; meta?: string; dim?: boolean }) {
  return (
    <div className="group flex items-start justify-between gap-2 border-b border-[var(--color-border-subtle)] px-3 py-1.5 last:border-b-0">
      <p className={`min-w-0 text-[12px] leading-snug ${dim ? "text-[var(--color-text-muted)]" : "text-[var(--color-text-secondary)]"}`}>
        {item.text}
        {meta && <span className="ml-1.5 whitespace-nowrap text-[10.5px] text-[var(--color-text-muted)]">· {meta}</span>}
      </p>
      <button onClick={() => void onForget(item.id)} title="Forget this" className="mt-0.5 flex-none rounded p-0.5 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 group-hover:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
