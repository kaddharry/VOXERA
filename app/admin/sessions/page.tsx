"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MessageSquare, LayoutList, Activity, Terminal, Zap, User, Bot, AlertTriangle, CheckCircle2, PhoneCall, RotateCcw, HelpCircle, ChevronRight, ArrowLeft } from "lucide-react";
import { GlassCard } from "@/app/_components/GlassCard";
import { ValenceTimeline, type ValencePoint } from "@/components/admin/ValenceTimeline";

/** A real, LLM-generated post-call read for a clinician — see
 * lib/agent/call-summary.ts. Grounded strictly in the transcript, never
 * fabricated. */
interface CallSummary {
  sentimentTrajectory: string;
  flaggedConcerns: string[];
  recommendedAction: string;
  followUpOutcome: "resolved" | "needs_retry" | "needs_review";
  requestedDoNotContact: boolean;
}

interface CallLogRow {
  id: string;
  sessionId: string | null;
  patientId: string | null;
  callerNumber: string | null;
  status: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  summary: CallSummary | null;
}

interface PatientInfo {
  id: string;
  name: string;
  phone: string;
}

interface SessionEvent {
  type: string;
  ts: number;
  sessionId: string;
  userId: string;
  payload: Record<string, unknown>;
}

// ─── Emotion color maps ───────────────────────────────────────────────────────

const EMOTION_COLORS: Record<string, string> = {
  anger:       "bg-red-500/15 text-red-400 border border-red-500/30",
  frustration: "bg-orange-500/15 text-orange-400 border border-orange-500/30",
  distress:    "bg-rose-500/15 text-rose-400 border border-rose-500/30",
  sadness:     "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30",
  fear:        "bg-purple-500/15 text-purple-400 border border-purple-500/30",
  confusion:   "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  joy:         "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  gratitude:   "bg-teal-500/15 text-teal-400 border border-teal-500/30",
  neutral:     "bg-[#4F46E5]/10 text-[var(--color-text-secondary)] border border-[#4F46E5]/10",
};

const POSITIVE_EMOTIONS = new Set(["joy", "gratitude", "excitement", "calm"]);

/** Calls placed from the Test Agent page (app/admin/try-call) rather than a
 * real phone call — see the literal "Browser Demo" callerNumber it inserts.
 * These never have a patientId, but they're not "unlinked" in the sense of a
 * real caller whose number didn't match a patient record, so they get their
 * own label rather than being lumped in with genuine unmatched phone calls. */
function isTestCall(callerNumber: string | null): boolean {
  return callerNumber === "Browser Demo";
}

function emotionBadge(label: string) {
  return EMOTION_COLORS[label] ?? "bg-[#4F46E5]/10 text-[var(--color-text-secondary)] border border-[#4F46E5]/10";
}

type TabId = "overview" | "transcript" | "emotion" | "technical";

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "overview", label: "Overview", icon: LayoutList },
  { id: "transcript", label: "Transcript", icon: MessageSquare },
  { id: "emotion", label: "Emotion Timeline", icon: Activity },
  { id: "technical", label: "Technical Log", icon: Terminal },
];

const FOLLOW_UP_META: Record<CallSummary["followUpOutcome"], { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  resolved: { label: "Resolved — no further action needed", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25", icon: CheckCircle2 },
  needs_retry: { label: "Needs a follow-up call", className: "bg-amber-500/10 text-amber-400 border-amber-500/25", icon: RotateCcw },
  needs_review: { label: "Needs clinician review", className: "bg-red-500/10 text-red-400 border-red-500/25", icon: HelpCircle },
};

export default function SessionsPage() {
  const searchParams = useSearchParams();
  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [patients, setPatients] = useState<Record<string, PatientInfo>>({});
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<CallLogRow | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [tab, setTab] = useState<TabId>("overview");

  useEffect(() => {
    Promise.all([
      fetch("/api/session/recent").then((r) => r.json()),
      fetch("/api/admin/patients").then((r) => r.json()),
    ])
      .then(([callsData, patientsData]) => {
        setCalls(callsData.calls ?? []);
        const byId: Record<string, PatientInfo> = {};
        for (const p of patientsData.patients ?? []) byId[p.id] = { id: p.id, name: p.name, phone: p.phone };
        setPatients(byId);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Deep-link support: a patient/alert row elsewhere links here with
  // ?session=ID (e.g. "View call" on an alert, "Full analysis" on a
  // patient's call history) — load that session directly rather than
  // requiring the viewer to find it in the list, which may not even include
  // it if it falls outside the 20 most-recently-ended calls.
  useEffect(() => {
    const requested = searchParams.get("session");
    if (requested) loadSession(requested);
  }, [searchParams]);

  const loadSession = async (sessionId: string) => {
    setSelectedSession(sessionId);
    setSelectedCall(null);
    setTab("overview");
    setEventsLoading(true);
    try {
      const res = await fetch(`/api/session/${sessionId}`);
      const data = await res.json();
      setEvents((data.events ?? []).slice().sort((a: SessionEvent, b: SessionEvent) => a.ts - b.ts));
      setSelectedCall(data.call ?? null);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

  // Group calls by patient so a clinician can find "this patient's calls"
  // directly instead of scanning a flat list of opaque session ids — calls
  // with no patientId (browser test calls, numbers that never matched a
  // patient record) fall into their own "Unlinked Calls" bucket, keyed by
  // caller number instead of a name.
  const groupedCalls = useMemo(() => {
    const groups = new Map<string, { patient: PatientInfo | null; calls: CallLogRow[] }>();
    for (const c of calls) {
      const key = c.patientId ?? `unlinked:${c.callerNumber ?? c.id}`;
      const existing = groups.get(key);
      if (existing) {
        existing.calls.push(c);
      } else {
        groups.set(key, { patient: c.patientId ? (patients[c.patientId] ?? null) : null, calls: [c] });
      }
    }
    return Array.from(groups.entries())
      .map(([key, g]) => ({ key, ...g, calls: g.calls.sort((a, b) => b.startedAt - a.startedAt) }))
      .sort((a, b) => b.calls[0].startedAt - a.calls[0].startedAt);
  }, [calls, patients]);

  // Collapsed by default — a doctor picks a patient's name to reveal their
  // calls, rather than every patient's session list being expanded (and
  // taking up the whole column) all at once.
  const [expandedPatients, setExpandedPatients] = useState<Set<string>>(new Set());
  const togglePatient = (key: string) =>
    setExpandedPatients((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Whichever call is currently selected (deep-linked, or picked from the
  // list) should always have its patient group visibly expanded — otherwise
  // a ?session= deep link would select a call hidden inside a collapsed
  // group with no indication of where it went.
  useEffect(() => {
    if (!selectedSession) return;
    const group = groupedCalls.find((g) => g.calls.some((c) => c.sessionId === selectedSession));
    if (group) setExpandedPatients((prev) => (prev.has(group.key) ? prev : new Set(prev).add(group.key)));
  }, [selectedSession, groupedCalls]);

  const emotionEvents = useMemo(
    () => events.filter((e) => e.type === "emotion"),
    [events]
  );
  const utteranceEvents = useMemo(
    () => events.filter((e) => e.type === "utterance"),
    [events]
  );
  const escalationEvents = useMemo(
    () => events.filter((e) => e.type === "escalation"),
    [events]
  );
  const caiEvents = useMemo(
    () => events.filter((e) => e.type === "cai"),
    [events]
  );
  const escalationTs = useMemo(() => new Set(escalationEvents.map((e) => e.ts)), [escalationEvents]);

  // Emotion events and transcript turns aren't logged at identical
  // timestamps, so linking them is a nearest-in-time match rather than an
  // exact one — correct for this app's event cadence (a turn and its
  // derived emotion read land within the same few hundred ms of each
  // other), not a general-purpose alignment algorithm. Returns the whole
  // utterance event (not just its ts) so the chart can quote it directly.
  function nearestUtterance(ts: number): SessionEvent | null {
    if (utteranceEvents.length === 0) return null;
    let best = utteranceEvents[0];
    let bestDiff = Math.abs(best.ts - ts);
    for (const u of utteranceEvents) {
      const diff = Math.abs(u.ts - ts);
      if (diff < bestDiff) {
        best = u;
        bestDiff = diff;
      }
    }
    // Further than ~4s from any transcribed turn isn't really "what was
    // being said at that moment" anymore — better to show nothing than a
    // misleadingly-attributed quote.
    return bestDiff <= 4000 ? best : null;
  }

  const valencePoints: ValencePoint[] = useMemo(
    () =>
      emotionEvents.map((e) => {
        const p = e.payload as Record<string, unknown>;
        const vad = p.vad as { v?: number } | undefined;
        const turn = nearestUtterance(e.ts);
        return {
          ts: e.ts,
          v: vad?.v ?? 0,
          label: (p.label as string) ?? "neutral",
          confidence: (p.confidence as number) ?? 0,
          escalation: Array.from(escalationTs).some((ts) => Math.abs(ts - e.ts) < 2000),
          text: (turn?.payload.text as string) ?? undefined,
          speaker: (turn?.payload.role as "user" | "agent") ?? undefined,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emotionEvents, escalationTs, utteranceEvents],
  );

  // ── Overview metrics — derived entirely from the real event log, nothing fabricated ──
  const overview = useMemo(() => {
    if (events.length === 0) return null;
    const durationMs = events.length > 1 ? events[events.length - 1].ts - events[0].ts : 0;
    const dominantCounts: Record<string, number> = {};
    for (const e of emotionEvents) {
      const label = (e.payload.label as string) ?? "neutral";
      dominantCounts[label] = (dominantCounts[label] ?? 0) + 1;
    }
    const dominant = Object.entries(dominantCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "neutral";
    const positiveCount = emotionEvents.filter((e) => POSITIVE_EMOTIONS.has((e.payload.label as string) ?? "")).length;
    const positiveRate = emotionEvents.length > 0 ? Math.round((positiveCount / emotionEvents.length) * 100) : null;
    const lastCai = caiEvents.length > 0 ? (caiEvents[caiEvents.length - 1].payload.score as number) : null;
    const avgCai = caiEvents.length > 0
      ? Math.round(caiEvents.reduce((s, e) => s + ((e.payload.score as number) ?? 0), 0) / caiEvents.length)
      : null;
    return {
      durationMs,
      turnCount: utteranceEvents.filter((e) => e.payload.role === "user").length,
      dominant,
      positiveRate,
      lastCai,
      avgCai,
      escalationCount: escalationEvents.length,
      eventCount: events.length,
    };
  }, [events, emotionEvents, utteranceEvents, caiEvents, escalationEvents]);

  const formatDuration = (ms: number) => {
    const totalSecs = Math.round(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="flex h-full flex-col font-body">
      {/* Compact single-line title — the breadcrumb above already names this
          page, so a full hero heading + description here was just repeating
          that at the cost of vertical space the patient list and call
          detail panel need far more. */}
      <header className="flex flex-none items-center gap-2 border-b border-[var(--color-border-subtle)] px-6 py-3">
        <MessageSquare className="h-4 w-4 text-[var(--color-accent-cyan)]" />
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Calls & Insights</span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Call list, grouped by patient — its own scroll region, independent
            of the detail panel, so a long call history never pushes the
            page itself into scrolling. Grouping by patient (instead of a
            flat list of session ids) is what makes "pull up this patient's
            calls" actually fast. */}
        {/* Below md there's no room for both columns side by side (the
            detail panel was squeezed to a sliver on phones), so it's one
            or the other: the list, or the selected call with a Back button. */}
        <div
          className={`w-full flex-col border-[var(--color-border-subtle)] md:flex md:w-[300px] md:flex-none md:border-r ${
            selectedSession ? "hidden" : "flex"
          }`}
        >
          <h2 className="flex-none px-4 pt-4 text-[11px] font-mono font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">
            Patients
          </h2>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {loading ? (
              <p className="animate-pulse text-[13px] text-[var(--color-text-muted)]">Loading...</p>
            ) : groupedCalls.length === 0 ? (
              <p className="text-[13px] italic text-[var(--color-text-muted)]">No calls found.</p>
            ) : (
              groupedCalls.map((g) => {
                const isOpen = expandedPatients.has(g.key);
                return (
                <div key={g.key}>
                  <button
                    onClick={() => togglePatient(g.key)}
                    className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--color-bg-elevated)]/60"
                  >
                    <ChevronRight className={`h-3.5 w-3.5 flex-none text-[var(--color-text-muted)] transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                        {g.patient?.name ?? (isTestCall(g.calls[0].callerNumber) ? "Test Call" : "Unlinked Calls")}
                      </div>
                      <div className="truncate text-[11px] text-[var(--color-text-muted)]">
                        {g.patient?.phone ?? g.calls[0].callerNumber ?? "Unknown number"}
                        {" · "}
                        {g.calls.length} call{g.calls.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </button>
                  {isOpen && (
                  <div className="mt-1.5 space-y-1.5 pl-5">
                    {g.calls.map((c) => {
                      const flagged = !!c.summary?.flaggedConcerns.length;
                      const isSelected = c.sessionId === selectedSession;
                      return (
                        <button
                          key={c.id}
                          onClick={() => c.sessionId && loadSession(c.sessionId)}
                          disabled={!c.sessionId}
                          className={`w-full rounded-lg border p-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                            isSelected
                              ? "border-[var(--color-border-active)] bg-[var(--color-bg-elevated)]"
                              : "border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:border-[var(--color-border-active)]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12.5px] font-medium text-[var(--color-text-primary)]">
                              {new Date(c.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                              {" · "}
                              {new Date(c.startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                            </span>
                            {flagged && <AlertTriangle className="h-3 w-3 flex-none text-amber-400" />}
                          </div>
                          <div className="mt-1 text-[10.5px] text-[var(--color-text-muted)]">
                            {c.durationMs ? formatDuration(c.durationMs) : c.status}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  )}
                </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className={`min-h-0 min-w-0 flex-1 flex-col md:flex ${selectedSession ? "flex" : "hidden"}`}>
          {!selectedSession ? (
            <div className="flex flex-1 items-center justify-center text-[14px] text-[var(--color-text-muted)]">
              Select a call to view its details
            </div>
          ) : eventsLoading ? (
            <div className="animate-pulse p-8 text-[14px] text-[var(--color-text-muted)]">Loading session...</div>
          ) : (
            <>
              {/* Who this call was with — grounds the whole detail view in a
                  patient/caller instead of an opaque session id. One
                  compact line, not a stacked block. */}
              <div className="flex flex-none flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-[var(--color-border-subtle)] px-4 py-2.5 sm:px-6">
                <button
                  type="button"
                  onClick={() => setSelectedSession(null)}
                  className="mr-1 flex items-center gap-1 self-center rounded-lg px-1.5 py-1 text-[12px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] md:hidden"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Calls
                </button>
                <span className="text-[13.5px] font-semibold text-[var(--color-text-primary)]">
                  {(selectedCall?.patientId && patients[selectedCall.patientId]?.name) ??
                    (isTestCall(selectedCall?.callerNumber ?? null) ? "Test call" : "Unlinked call")}
                </span>
                <span className="text-[12px] text-[var(--color-text-muted)]">
                  {(selectedCall?.patientId && patients[selectedCall.patientId]?.phone) ?? selectedCall?.callerNumber ?? "Unknown number"}
                  {selectedCall && ` · ${new Date(selectedCall.startedAt).toLocaleString()}`}
                </span>
              </div>

              {/* Tab bar */}
              <div className="flex flex-none items-center gap-1.5 overflow-x-auto border-b border-[var(--color-border-subtle)] px-4 pt-2 sm:px-6">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
                      tab === t.id
                        ? "border-[var(--color-accent-cyan)] text-[var(--color-text-primary)]"
                        : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                    }`}
                  >
                    <t.icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-28 sm:p-6 sm:pb-28">
              {tab === "overview" && overview && (
                <div className="space-y-6">
                  {/* Clinical Summary — the LLM-generated, transcript-grounded
                      read a clinician actually came here for (see
                      lib/agent/call-summary.ts), led with before the
                      technical stat tiles below it. */}
                  {selectedCall?.summary ? (
                    <GlassCard className="p-5">
                      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
                        <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">Clinical Summary</h3>
                        {(() => {
                          const meta = FOLLOW_UP_META[selectedCall.summary.followUpOutcome];
                          const Icon = meta.icon;
                          return (
                            <span className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${meta.className}`}>
                              <Icon className="h-3.5 w-3.5" /> {meta.label}
                            </span>
                          );
                        })()}
                      </div>
                      <p className="text-[14.5px] leading-relaxed text-[var(--color-text-primary)]">{selectedCall.summary.sentimentTrajectory}</p>

                      {selectedCall.summary.flaggedConcerns.length > 0 && (
                        <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3.5">
                          <h4 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" /> Flagged Concerns
                          </h4>
                          <ul className="list-disc space-y-1 pl-4 text-[13px] text-[var(--color-text-primary)]">
                            {selectedCall.summary.flaggedConcerns.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-3.5">
                        <PhoneCall className="mt-0.5 h-3.5 w-3.5 flex-none text-[var(--color-accent-cyan)]" />
                        <div>
                          <h4 className="mb-0.5 text-[11.5px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Recommended Action</h4>
                          <p className="text-[13.5px] text-[var(--color-text-primary)]">{selectedCall.summary.recommendedAction}</p>
                        </div>
                      </div>

                      {selectedCall.summary.requestedDoNotContact && (
                        <p className="mt-3 text-[12px] font-semibold text-red-400">
                          Patient asked not to be contacted again — this has been recorded on their chart.
                        </p>
                      )}
                    </GlassCard>
                  ) : (
                    <GlassCard className="p-5">
                      <h3 className="mb-1.5 text-[13px] font-bold text-[var(--color-text-primary)]">Clinical Summary</h3>
                      <p className="text-[13px] text-[var(--color-text-muted)]">
                        {selectedCall?.status === "active"
                          ? "This call is still in progress — a summary is generated once it ends."
                          : "No summary was generated for this call (e.g. too short, or no transcript captured)."}
                      </p>
                    </GlassCard>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <StatTile label="Duration" value={formatDuration(overview.durationMs)} />
                    <StatTile label="User Turns" value={String(overview.turnCount)} />
                    <StatTile
                      label="Avg CAI"
                      value={overview.avgCai !== null ? `${overview.avgCai}/100` : "—"}
                    />
                    <StatTile
                      label="Escalations"
                      value={String(overview.escalationCount)}
                      accent={overview.escalationCount > 0 ? "text-red-400" : undefined}
                    />
                  </div>
                  <GlassCard className="p-5">
                    <h3 className="text-[13px] font-bold text-[var(--color-text-primary)] mb-3">Sentiment Summary</h3>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold capitalize ${emotionBadge(overview.dominant)}`}>
                        Dominant: {overview.dominant}
                      </span>
                      {overview.positiveRate !== null && (
                        <span className="text-[13px] text-[var(--color-text-secondary)]">
                          {overview.positiveRate}% of emotion reads were positive
                        </span>
                      )}
                    </div>
                  </GlassCard>
                  {escalationEvents.length > 0 && (
                    <GlassCard className="p-5 border-red-500/25">
                      <h3 className="text-[13px] font-bold text-red-400 mb-3 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5" /> Escalations
                      </h3>
                      <div className="space-y-2">
                        {escalationEvents.map((e, i) => (
                          <div key={i} className="text-[12.5px] text-[var(--color-text-secondary)]">
                            <span className="font-mono text-[11px] text-[var(--color-text-muted)] mr-2">
                              {new Date(e.ts).toLocaleTimeString()}
                            </span>
                            {(e.payload.reason as string) || "Escalation triggered"}
                          </div>
                        ))}
                      </div>
                    </GlassCard>
                  )}
                </div>
              )}

              {tab === "transcript" && (
                <GlassCard className="p-6">
                  {utteranceEvents.length === 0 ? (
                    <p className="text-[var(--color-text-muted)] text-[13px]">No transcript recorded for this session.</p>
                  ) : (
                    <div className="space-y-3">
                      {utteranceEvents.map((e, i) => {
                        const role = (e.payload.role as string) ?? "user";
                        const isAgent = role === "agent";
                        return (
                          <div key={i} className={`flex gap-3 ${isAgent ? "" : "flex-row-reverse"}`}>
                            <div className={`flex-none w-7 h-7 rounded-full flex items-center justify-center ${isAgent ? "bg-[var(--color-accent-violet)]/15 text-[var(--color-accent-violet)]" : "bg-[var(--color-accent-cyan)]/15 text-[var(--color-accent-cyan)]"}`}>
                              {isAgent ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                            </div>
                            <div className={`max-w-[75%] p-3 rounded-xl text-[13px] leading-relaxed ${isAgent ? "bg-[#4F46E5]/[0.05] text-[var(--color-text-primary)]" : "bg-[var(--color-accent-cyan)]/10 text-[var(--color-text-primary)] border border-[var(--color-accent-cyan)]/20"}`}>
                              <p>{(e.payload.text as string) || "—"}</p>
                              <span className="block text-[10px] font-mono text-[var(--color-text-muted)] mt-1.5">
                                {new Date(e.ts).toLocaleTimeString()}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </GlassCard>
              )}

              {tab === "emotion" && (
                <GlassCard className="flex h-full flex-col p-6">
                  <div className="mb-4 flex flex-none items-center justify-between">
                    <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">How the Call Felt, Moment by Moment</h3>
                    <div className="flex items-center gap-3 text-[10px] font-mono text-[var(--color-text-muted)]">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> positive</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> neutral</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> confused/anxious</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> upset</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-500 inline-block opacity-60" /> unclear</span>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <ValenceTimeline points={valencePoints} />
                  </div>
                  <p className="mt-3 flex-none text-[11px] text-[var(--color-text-muted)]">
                    This is an AI-estimated conversational cue, not a clinical or diagnostic measure.
                  </p>
                </GlassCard>
              )}

              {tab === "technical" && (
                <GlassCard className="p-6">
                  <p className="mb-4 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-3.5 py-2.5 text-[12px] text-[var(--color-text-muted)]">
                    Engineering/debugging detail — the raw pipeline event log, not written for clinical review.
                    For the patient-facing read, see the Overview and Emotion Timeline tabs.
                  </p>
                  <h2 className="text-[11px] font-mono font-bold text-[var(--color-text-secondary)] uppercase tracking-widest mb-5">
                    Full Event Log ({events.length} events)
                  </h2>
                  <div className="space-y-3">
                    {events.map((ev, i) => (
                      <div key={i} className="flex gap-4 p-4 rounded-xl bg-[#4F46E5]/[0.03] border border-[var(--color-border-subtle)]">
                        <div className="flex-none pt-1">
                          <div className={`w-2.5 h-2.5 rounded-full ${ev.type === "escalation" ? "bg-red-400 shadow-[0_0_8px_#f87171]" : "bg-[var(--color-accent-cyan)] shadow-[0_0_8px_var(--color-accent-cyan)]"}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="font-semibold text-[var(--color-text-primary)] capitalize text-[14px]">{ev.type.replace(/_/g, " ")}</span>
                            <span className="text-[11px] font-mono text-[var(--color-text-muted)]">{new Date(ev.ts).toLocaleTimeString()}</span>
                            {ev.type === "escalation" && (
                              <span className="text-[10px] font-mono font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-md">⚡ escalation</span>
                            )}
                            {ev.type === "emotion" && (
                              <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-md capitalize ${emotionBadge((ev.payload.label as string) ?? "neutral")}`}>
                                {(ev.payload.label as string) ?? "neutral"}
                              </span>
                            )}
                          </div>
                          {ev.type === "retrieval" ? (
                            <div className="space-y-3 mt-2">
                              <div className="flex items-center gap-2 text-[10px] font-mono">
                                <span className="bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/20">MTM: {(ev.payload.mtmIds as string[])?.length ?? 0}</span>
                                <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">LTM User: {(ev.payload.ltmUserIds as string[])?.length ?? 0}</span>
                                <span className="bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20">LTM Client: {(ev.payload.ltmClientIds as string[])?.length ?? 0}</span>
                              </div>
                              {!!ev.payload.timeline && (ev.payload.timeline as any[]).length > 0 && (
                                <div className="bg-[#4F46E5]/[0.03] border border-[var(--color-border-subtle)] rounded-lg p-3 space-y-1.5">
                                  <span className="text-[9px] font-mono font-bold text-[var(--color-text-muted)] block uppercase">Grouped Timeline Events</span>
                                  <div className="space-y-2">
                                    {(ev.payload.timeline as any[]).map((evt, idx) => (
                                      <div key={idx} className="border-l border-[var(--color-accent-cyan)] pl-2">
                                        <span className="font-bold text-[var(--color-text-primary)] text-[11px] uppercase tracking-wider">{evt.topic}</span>
                                        <p className="text-[11px] text-[var(--color-text-secondary)] italic">"{evt.summary}"</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {!!ev.payload.scores && (ev.payload.scores as any[]).length > 0 && (
                                <div className="space-y-2">
                                  {(ev.payload.scores as any[]).slice(0, 4).map((sObj, idx) => {
                                    const exp = (ev.payload.explanations as Record<string, any>)?.[sObj.id];
                                    return (
                                      <div key={idx} className="bg-[#4F46E5]/[0.03] border border-[var(--color-border-subtle)] rounded-lg p-2.5 space-y-1">
                                        <div className="flex justify-between items-center text-[10px]">
                                          <span className="font-mono text-[var(--color-text-muted)]">ID: {sObj.id}</span>
                                          <span className="font-mono font-bold text-[var(--color-accent-cyan)]">Score: {sObj.score}</span>
                                        </div>
                                        {!!exp && (
                                          <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">{exp.reason}</p>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {(ev.payload.scores as any[]).length > 4 && (
                                    <div className="text-[10px] font-mono text-[var(--color-text-muted)] text-center">
                                      + {(ev.payload.scores as any[]).length - 4} more records...
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <pre className="text-[12px] text-[var(--color-text-secondary)] whitespace-pre-wrap font-mono break-all bg-[#4F46E5]/[0.03] p-3 rounded-lg border border-[var(--color-border-subtle)] max-h-32 overflow-hidden">
                              {JSON.stringify(ev.payload, null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <GlassCard className="p-4">
      <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1.5">{label}</span>
      <span className={`font-mono text-xl font-extrabold tabular-nums ${accent ?? "text-[var(--color-text-primary)]"}`}>{value}</span>
    </GlassCard>
  );
}
