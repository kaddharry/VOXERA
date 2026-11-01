"use client";

import { useCallback, useEffect, useState } from "react";
import { Lightbulb, RefreshCw, HelpCircle, TrendingDown, History, Check, X, Loader2, RotateCcw } from "lucide-react";
import { GlassCard } from "../../_components/GlassCard";

/**
 * Agent Learning — the self-learning pipeline's page (objective 3). Shows
 * what calls have taught the agent: suggestions to accept or dismiss,
 * knowledge gaps grouped by topic, emotional failure points, and each
 * agent's version history with restore. Data: GET /api/admin/insights.
 */

interface Suggestion {
  id: string;
  kind: "add_knowledge" | "prompt_change";
  agentId: string | null;
  title: string;
  explanation: string;
  proposal: string;
  occurrences: number;
  status: "open" | "accepted" | "dismissed";
  resultVersion: number | null;
}

interface GapGroup {
  key: string;
  topic: string;
  calls: number;
  questions: string[];
}

interface FailurePoint {
  id: string;
  sessionId: string;
  patientText: string | null;
  agentText: string | null;
  details: { patientAfter?: string; whatWentWrong?: string; before?: { label: string }; after?: { label: string }; reviewed?: boolean };
  createdAt: number;
}

interface AgentVersion {
  version: number;
  changeSummary: string;
  systemPrompt: string | null;
  createdAt: number;
}

interface LearningData {
  suggestions: Suggestion[];
  knowledgeGaps: GapGroup[];
  failurePoints: FailurePoint[];
  agents: Array<{ id: string; name: string; versions: AgentVersion[] }>;
  totals: { calls: number; knowledgeGaps: number; failurePoints: number };
}

const btn = "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50";

export default function AgentLearningPage() {
  const [data, setData] = useState<LearningData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/insights");
    const body = await res.json().catch(() => ({}));
    if (body.migrationRequired) return setMigrationRequired(true);
    if (!res.ok) return setError(body.error ?? "Couldn't load agent learning.");
    setError(null);
    setData(body);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    setError(null);
    const res = await fetch("/api/admin/insights/suggestions", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setGenerating(false);
    if (!res.ok) return setError(body.error ?? "Couldn't build suggestions.");
    await load();
  }

  const open = data?.suggestions.filter((s) => s.status === "open") ?? [];
  const decided = data?.suggestions.filter((s) => s.status !== "open") ?? [];
  const agentName = (id: string | null) => data?.agents.find((a) => a.id === id)?.name ?? "agent";

  return (
    <div className="flex h-full flex-col font-body">
      <header className="flex flex-none items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
        <div className="flex min-w-0 items-center gap-2">
          <Lightbulb className="h-4 w-4 flex-none text-[var(--color-accent-cyan)]" />
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Agent Learning</span>
          <span className="hidden truncate text-[12px] text-[var(--color-text-muted)] sm:inline">· what calls are teaching your agent</span>
        </div>
        <button
          onClick={() => void generate()}
          disabled={generating || migrationRequired}
          className="flex flex-none items-center gap-1.5 rounded-lg btn-gradient px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-all hover:scale-[1.02] disabled:opacity-60"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {generating ? "Looking for patterns…" : "Find suggestions"}
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-28 pt-4 sm:p-6 sm:pb-28 md:px-10">
        {migrationRequired && (
          <GlassCard className="p-5 text-[13.5px] text-[var(--color-text-secondary)]">
            Agent learning needs two database updates. Ask whoever manages the database to run{" "}
            <code>sql/migration_v25.sql</code> and <code>sql/migration_v26.sql</code>. Until then, each call&apos;s findings are still shown
            on Calls &amp; Insights.
          </GlassCard>
        )}
        {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[13px] text-red-300">{error}</p>}
        {!data && !migrationRequired && !error && <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-[var(--color-text-muted)]" />}

        {data && (
          <>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              From {data.totals.calls} analysed {data.totals.calls === 1 ? "call" : "calls"}: {data.totals.knowledgeGaps} unanswered{" "}
              {data.totals.knowledgeGaps === 1 ? "question" : "questions"} and {data.totals.failurePoints} emotional failure{" "}
              {data.totals.failurePoints === 1 ? "point" : "points"}.
            </p>

            <section className="space-y-3">
              <h2 className="text-[12px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Suggestions ({open.length})</h2>
              {open.length === 0 ? (
                <GlassCard className="p-5 text-[13px] text-[var(--color-text-muted)]">
                  No open suggestions. Click <span className="font-semibold">Find suggestions</span> after a few calls to look for patterns.
                </GlassCard>
              ) : (
                open.map((s) => <SuggestionCard key={s.id} s={s} agentName={agentName(s.agentId)} onDone={load} />)
              )}
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="space-y-3">
                <h2 className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-amber-400">
                  <HelpCircle className="h-3.5 w-3.5" /> Knowledge gaps
                </h2>
                {data.knowledgeGaps.length === 0 ? (
                  <p className="text-[13px] text-[var(--color-text-muted)]">None open.</p>
                ) : (
                  data.knowledgeGaps.map((g) => (
                    <GlassCard key={g.key} className="p-4 text-[13px]">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-semibold text-[var(--color-text-primary)]">{g.topic}</p>
                        <span className="flex-none text-[12px] text-[var(--color-text-muted)]">
                          {g.calls} {g.calls === 1 ? "call" : "calls"}
                        </span>
                      </div>
                      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[var(--color-text-secondary)]">
                        {g.questions.slice(0, 4).map((q) => (
                          <li key={q}>&ldquo;{q}&rdquo;</li>
                        ))}
                      </ul>
                    </GlassCard>
                  ))
                )}
              </section>

              <section className="space-y-3">
                <h2 className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-red-400">
                  <TrendingDown className="h-3.5 w-3.5" /> Emotional failure points
                </h2>
                {data.failurePoints.length === 0 ? (
                  <p className="text-[13px] text-[var(--color-text-muted)]">None open.</p>
                ) : (
                  data.failurePoints.map((f) => (
                    <GlassCard key={f.id} className="p-4 text-[13px]">
                      <p className="font-semibold text-[var(--color-text-primary)]">{f.details.whatWentWrong}</p>
                      <p className="mt-1.5 text-[var(--color-text-secondary)]">
                        <span className="text-[var(--color-text-muted)]">Agent: </span>&ldquo;{f.agentText}&rdquo;
                      </p>
                      <p className="mt-1 text-[var(--color-text-secondary)]">
                        <span className="text-[var(--color-text-muted)]">Patient then ({f.details.after?.label}): </span>&ldquo;{f.details.patientAfter}&rdquo;
                      </p>
                      <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">{new Date(f.createdAt).toLocaleString()}</p>
                    </GlassCard>
                  ))
                )}
              </section>
            </div>

            <section className="space-y-3">
              <h2 className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                <History className="h-3.5 w-3.5" /> Agent versions
              </h2>
              {data.agents.every((a) => a.versions.length === 0) ? (
                <p className="text-[13px] text-[var(--color-text-muted)]">No learned changes yet. Accepting an instruction suggestion creates version 2.</p>
              ) : (
                data.agents
                  .filter((a) => a.versions.length > 0)
                  .map((a) => <VersionHistory key={a.id} agentId={a.id} name={a.name} versions={a.versions} onDone={load} />)
              )}
            </section>

            {decided.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-[12px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Decided</h2>
                {decided.map((s) => (
                  <p key={s.id} className="text-[13px] text-[var(--color-text-secondary)]">
                    {s.status === "accepted" ? "✓" : "✕"} {s.title}
                    <span className="text-[var(--color-text-muted)]">
                      {" "}· {s.status}
                      {s.resultVersion ? ` · created version ${s.resultVersion}` : ""}
                    </span>
                  </p>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({ s, agentName, onDone }: { s: Suggestion; agentName: string; onDone: () => Promise<void> }) {
  const [text, setText] = useState(s.kind === "prompt_change" ? s.proposal : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "accept" | "dismiss") {
    setBusy(true);
    setError(null);
    const payload = action === "dismiss" ? { action } : s.kind === "add_knowledge" ? { action, answer: text } : { action, guideline: text };
    const res = await fetch(`/api/admin/insights/suggestions/${s.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Something went wrong.");
    await onDone();
  }

  const isKnowledge = s.kind === "add_knowledge";
  return (
    <GlassCard className="p-5 text-[13.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
            isKnowledge ? "bg-amber-500/15 text-amber-300" : "bg-indigo-500/15 text-indigo-300"
          }`}
        >
          {isKnowledge ? "Knowledge" : `Instructions · ${agentName}`}
        </span>
        <h3 className="font-semibold text-[var(--color-text-primary)]">{s.title}</h3>
      </div>
      <p className="mt-1.5 text-[var(--color-text-secondary)]">{s.explanation}</p>

      {isKnowledge ? (
        <>
          <p className="mt-3 text-[12px] font-semibold text-[var(--color-text-muted)]">Patients asked</p>
          <pre className="mt-1 whitespace-pre-wrap font-body text-[var(--color-text-secondary)]">{s.proposal}</pre>
          <label className="mt-3 block text-[12px] font-semibold text-[var(--color-text-muted)]" htmlFor={`answer-${s.id}`}>
            The hospital&apos;s answer (the agent will use exactly this)
          </label>
          <textarea
            id={`answer-${s.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="e.g. You can shower 48 hours after surgery. Please avoid baths and swimming for 2 weeks."
            className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent p-2.5 text-[13.5px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-active)]"
          />
        </>
      ) : (
        <>
          <label className="mt-3 block text-[12px] font-semibold text-[var(--color-text-muted)]" htmlFor={`guideline-${s.id}`}>
            Add to the agent&apos;s instructions (you can edit it)
          </label>
          <textarea
            id={`guideline-${s.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent p-2.5 text-[13.5px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-active)]"
          />
        </>
      )}

      {error && <p className="mt-2 text-[12.5px] text-red-400">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => void decide("accept")}
          className={`${btn} border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10`}
        >
          <Check className="h-3.5 w-3.5" /> {isKnowledge ? "Add to knowledge" : "Accept & create new version"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide("dismiss")}
          className={`${btn} border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]`}
        >
          <X className="h-3.5 w-3.5" /> Dismiss
        </button>
      </div>
    </GlassCard>
  );
}

function VersionHistory({ agentId, name, versions, onDone }: { agentId: string; name: string; versions: AgentVersion[]; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = versions[0]?.version;

  async function restore(version: number) {
    setBusy(version);
    setError(null);
    const res = await fetch(`/api/admin/agents/${agentId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restore: version }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(body.error ?? "Couldn't restore that version.");
    await onDone();
  }

  return (
    <GlassCard className="p-5 text-[13px]">
      <p className="font-semibold text-[var(--color-text-primary)]">{name}</p>
      {error && <p className="mt-1 text-[12.5px] text-red-400">{error}</p>}
      <ol className="mt-2 space-y-2">
        {versions.map((v) => (
          <li key={v.version} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[var(--color-text-secondary)]">
              <span className="font-semibold text-[var(--color-text-primary)]">v{v.version}</span>
              {v.version === current ? " (current)" : ""} · {v.changeSummary}
              <span className="text-[var(--color-text-muted)]"> · {new Date(v.createdAt).toLocaleString()}</span>
            </span>
            {v.version !== current && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void restore(v.version)}
                className={`${btn} border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]`}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </button>
            )}
          </li>
        ))}
      </ol>
    </GlassCard>
  );
}
