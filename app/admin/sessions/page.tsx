"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquare, LayoutList, Activity, Terminal, Zap, User, Bot } from "lucide-react";
import { GlassCard } from "@/app/_components/GlassCard";

interface SessionSummary {
  sessionId: string;
  eventCount: number;
  lastTs: number;
  dominantEmotion: string;
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
  neutral:     "bg-white/10 text-[var(--color-text-secondary)] border border-white/10",
};

const EMOTION_DOT: Record<string, string> = {
  anger: "bg-red-400", frustration: "bg-orange-400", distress: "bg-rose-400",
  sadness: "bg-indigo-400", fear: "bg-purple-400", confusion: "bg-amber-400",
  joy: "bg-emerald-400", gratitude: "bg-teal-400", neutral: "bg-zinc-400",
};

const POSITIVE_EMOTIONS = new Set(["joy", "gratitude", "excitement", "calm"]);

function trajectoryArrow(slope: number): string {
  if (slope > 0.05) return "↑";
  if (slope < -0.05) return "↓";
  return "→";
}

function emotionBadge(label: string) {
  return EMOTION_COLORS[label] ?? "bg-white/10 text-[var(--color-text-secondary)] border border-white/10";
}

type TabId = "overview" | "transcript" | "emotion" | "diagnostics";

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "overview", label: "Overview", icon: LayoutList },
  { id: "transcript", label: "Transcript", icon: MessageSquare },
  { id: "emotion", label: "Emotion Timeline", icon: Activity },
  { id: "diagnostics", label: "Diagnostics", icon: Terminal },
];

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [tab, setTab] = useState<TabId>("overview");

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.recentSessions ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const loadSession = async (sessionId: string) => {
    setSelectedSession(sessionId);
    setTab("overview");
    setEventsLoading(true);
    try {
      const res = await fetch(`/api/session/${sessionId}`);
      const data = await res.json();
      setEvents((data.events ?? []).slice().sort((a: SessionEvent, b: SessionEvent) => a.ts - b.ts));
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

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
    <div className="p-6 md:p-10 font-body min-h-screen">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)] flex items-center gap-3">
          <MessageSquare className="w-8 h-8 text-[var(--color-accent-cyan)]" />
          Session History
        </h1>
        <p className="text-[15px] text-[var(--color-text-secondary)] mt-2 max-w-xl">
          Browse past conversations, transcripts, and emotion timelines.
        </p>
      </header>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Session List */}
        <div className="w-full md:w-[300px] flex-none">
          <h2 className="text-[11px] font-mono font-bold text-[var(--color-text-secondary)] uppercase tracking-widest mb-4">Sessions</h2>
          {loading ? (
            <p className="text-[var(--color-text-muted)] text-[13px] animate-pulse">Loading...</p>
          ) : sessions.length === 0 ? (
            <p className="text-[var(--color-text-muted)] text-[13px] italic">No sessions found.</p>
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => {
                const dotColor = EMOTION_DOT[s.dominantEmotion] ?? "bg-zinc-400";
                const badgeColor = emotionBadge(s.dominantEmotion);
                return (
                  <button
                    key={s.sessionId}
                    onClick={() => loadSession(s.sessionId)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      selectedSession === s.sessionId
                        ? "border-[var(--color-border-active)] bg-white/[0.06]"
                        : "border-[var(--color-border-subtle)] bg-white/[0.03] hover:border-[var(--color-border-active)]"
                    }`}
                  >
                    <div className="font-mono text-[12px] font-medium text-[var(--color-text-primary)] truncate mb-2">{s.sessionId}</div>
                    <div className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest">
                      <span className="px-2 py-1 bg-white/[0.04] border border-[var(--color-border-subtle)] text-[var(--color-accent-cyan)] rounded-md">{s.eventCount} events</span>
                      <span className={`flex items-center gap-1 px-2 py-1 rounded-md capitalize ${badgeColor}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                        {s.dominantEmotion}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--color-text-muted)] mt-3">{new Date(s.lastTs).toLocaleString()}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="flex-1 min-w-0">
          {!selectedSession ? (
            <GlassCard className="flex items-center justify-center h-64 text-[var(--color-text-muted)] text-[14px]">
              Select a session to view its details
            </GlassCard>
          ) : eventsLoading ? (
            <div className="text-[var(--color-text-muted)] text-[14px] animate-pulse p-8">Loading session...</div>
          ) : (
            <>
              {/* Tab bar */}
              <div className="flex items-center gap-1.5 mb-5 border-b border-[var(--color-border-subtle)] overflow-x-auto">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors ${
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

              {tab === "overview" && overview && (
                <div className="space-y-6">
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
                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                      {utteranceEvents.map((e, i) => {
                        const role = (e.payload.role as string) ?? "user";
                        const isAgent = role === "agent";
                        return (
                          <div key={i} className={`flex gap-3 ${isAgent ? "" : "flex-row-reverse"}`}>
                            <div className={`flex-none w-7 h-7 rounded-full flex items-center justify-center ${isAgent ? "bg-[var(--color-accent-violet)]/15 text-[var(--color-accent-violet)]" : "bg-[var(--color-accent-cyan)]/15 text-[var(--color-accent-cyan)]"}`}>
                              {isAgent ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                            </div>
                            <div className={`max-w-[75%] p-3 rounded-xl text-[13px] leading-relaxed ${isAgent ? "bg-white/[0.05] text-[var(--color-text-primary)]" : "bg-[var(--color-accent-cyan)]/10 text-[var(--color-text-primary)] border border-[var(--color-accent-cyan)]/20"}`}>
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
                <GlassCard className="p-6">
                  {emotionEvents.length === 0 ? (
                    <p className="text-[var(--color-text-muted)] text-[13px]">No emotion data recorded for this session.</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto pb-2">
                        <div className="flex items-end gap-4 min-w-max">
                          {emotionEvents.map((ev, i) => {
                            const p = ev.payload as Record<string, unknown>;
                            const label = (p.label as string) ?? "neutral";
                            const intensity = (p.intensity as number) ?? 0;
                            const traj = p.trajectory as Record<string, number> | undefined;
                            const slopeA = traj?.slope_a ?? 0;
                            const dotColor = EMOTION_DOT[label] ?? "bg-zinc-400";
                            const badgeColor = emotionBadge(label);
                            const arrow = trajectoryArrow(slopeA);
                            const nearEscalation = Array.from(escalationTs).some((ts) => Math.abs(ts - ev.ts) < 2000);

                            return (
                              <div key={i} className="flex flex-col items-center gap-1 relative" style={{ minWidth: 60 }}>
                                {nearEscalation && (
                                  <span className="absolute -top-6 text-red-400 text-[14px]" title="Escalation triggered">⚡</span>
                                )}
                                <span className="text-[9px] font-mono text-[var(--color-text-muted)]">T{i + 1}</span>
                                <div className="w-7 bg-white/[0.05] rounded-t-sm flex items-end" style={{ height: 48 }}>
                                  <div className={`w-full rounded-t-sm ${dotColor} opacity-70`} style={{ height: `${Math.round(intensity * 100)}%` }} />
                                </div>
                                <div className={`w-3 h-3 rounded-full ${dotColor} shadow-[0_0_6px_currentColor]`} />
                                <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-md capitalize ${badgeColor}`}>
                                  {label.slice(0, 5)}
                                </span>
                                <span className="text-[11px] text-[var(--color-text-muted)]">{arrow}</span>
                                <span className="text-[8px] font-mono text-[var(--color-text-muted)]">
                                  {new Date(ev.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
                        {Object.entries(EMOTION_COLORS).map(([label, color]) => (
                          <span key={label} className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-md capitalize ${color}`}>
                            {label}
                          </span>
                        ))}
                        <span className="text-[9px] font-mono text-red-400 ml-2">⚡ escalation</span>
                        <span className="text-[9px] font-mono text-[var(--color-text-muted)] ml-1">↑↓→ arousal</span>
                      </div>
                    </>
                  )}
                </GlassCard>
              )}

              {tab === "diagnostics" && (
                <GlassCard className="p-6">
                  <h2 className="text-[11px] font-mono font-bold text-[var(--color-text-secondary)] uppercase tracking-widest mb-5">
                    Full Event Log ({events.length} events)
                  </h2>
                  <div className="max-h-[600px] overflow-y-auto pr-2 space-y-3">
                    {events.map((ev, i) => (
                      <div key={i} className="flex gap-4 p-4 rounded-xl bg-white/[0.03] border border-[var(--color-border-subtle)]">
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
                                <div className="bg-white/[0.03] border border-[var(--color-border-subtle)] rounded-lg p-3 space-y-1.5">
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
                                      <div key={idx} className="bg-white/[0.03] border border-[var(--color-border-subtle)] rounded-lg p-2.5 space-y-1">
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
                            <pre className="text-[12px] text-[var(--color-text-secondary)] whitespace-pre-wrap font-mono break-all bg-white/[0.03] p-3 rounded-lg border border-[var(--color-border-subtle)] max-h-32 overflow-hidden">
                              {JSON.stringify(ev.payload, null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              )}
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
