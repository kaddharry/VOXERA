"use client";

import { useEffect, useState } from "react";

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
  anger:       "bg-red-500 text-white",
  frustration: "bg-orange-500 text-white",
  distress:    "bg-rose-600 text-white",
  sadness:     "bg-indigo-500 text-white",
  fear:        "bg-purple-500 text-white",
  confusion:   "bg-amber-500 text-black",
  joy:         "bg-emerald-500 text-white",
  gratitude:   "bg-teal-500 text-white",
  neutral:     "bg-zinc-500 text-white",
};

const EMOTION_DOT: Record<string, string> = {
  anger:       "bg-red-500",
  frustration: "bg-orange-500",
  distress:    "bg-rose-600",
  sadness:     "bg-indigo-500",
  fear:        "bg-purple-500",
  confusion:   "bg-amber-400",
  joy:         "bg-emerald-500",
  gratitude:   "bg-teal-500",
  neutral:     "bg-zinc-400",
};

function trajectoryArrow(slope: number): string {
  if (slope > 0.05) return "↑";
  if (slope < -0.05) return "↓";
  return "→";
}

// ─────────────────────────────────────────────────────────────────────────────

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);

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
    setEventsLoading(true);
    try {
      const res = await fetch(`/api/session/${sessionId}`);
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

  const emotionEvents = events
    .filter((e) => e.type === "emotion")
    .sort((a, b) => a.ts - b.ts);

  const escalationTs = new Set(
    events.filter((e) => e.type === "escalation").map((e) => e.ts)
  );

  return (
    <div className="p-6 md:p-10 font-body min-h-screen">
      <header className="mb-10">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)]">Session History</h1>
        <p className="text-[15px] text-[var(--color-text-secondary)] mt-2">
          Browse past conversations and inspect emotion timelines.
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
                const badgeColor = EMOTION_COLORS[s.dominantEmotion] ?? "bg-zinc-600 text-white";
                return (
                  <button
                    key={s.sessionId}
                    onClick={() => loadSession(s.sessionId)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      selectedSession === s.sessionId
                        ? "border-[var(--color-border-active)] bg-[var(--color-bg-surface)] shadow-[0_0_15px_var(--color-accent-glow)]"
                        : "border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-active)]"
                    }`}
                  >
                    <div className="font-mono text-[12px] font-medium text-[var(--color-text-primary)] truncate mb-2">{s.sessionId}</div>
                    <div className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest">
                      <span className="px-2 py-1 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[var(--color-accent-cyan)] rounded-md">{s.eventCount} events</span>
                      <span className={`flex items-center gap-1 px-2 py-1 rounded-md capitalize ${badgeColor}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${dotColor} opacity-80`} />
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
        <div className="flex-1 space-y-6">
          {!selectedSession ? (
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl flex items-center justify-center h-64 text-[var(--color-text-muted)] text-[14px]">
              Select a session to view its emotion timeline
            </div>
          ) : eventsLoading ? (
            <div className="text-[var(--color-text-muted)] text-[14px] animate-pulse p-8">Loading events...</div>
          ) : (
            <>
              {/* ── Emotion Timeline (Sprint 2) ─────────────────────────── */}
              {emotionEvents.length > 0 && (
                <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6">
                  <h2 className="text-[11px] font-mono font-bold text-[var(--color-text-secondary)] uppercase tracking-widest mb-5">
                    ⚡ Emotion Timeline — {emotionEvents.length} turns
                  </h2>

                  <div className="overflow-x-auto pb-2">
                    <div className="flex items-end gap-4 min-w-max">
                      {emotionEvents.map((ev, i) => {
                        const p = ev.payload as Record<string, unknown>;
                        const label = (p.label as string) ?? "neutral";
                        const intensity = (p.intensity as number) ?? 0;
                        const traj = p.trajectory as Record<string, number> | undefined;
                        const slopeA = traj?.slope_a ?? 0;
                        const dotColor = EMOTION_DOT[label] ?? "bg-zinc-400";
                        const badgeColor = EMOTION_COLORS[label] ?? "bg-zinc-600 text-white";
                        const arrow = trajectoryArrow(slopeA);
                        const nearEscalation = Array.from(escalationTs).some(
                          (ts) => Math.abs(ts - ev.ts) < 2000
                        );

                        return (
                          <div key={i} className="flex flex-col items-center gap-1 relative" style={{ minWidth: 60 }}>
                            {nearEscalation && (
                              <span className="absolute -top-6 text-red-400 text-[14px]" title="Escalation triggered">⚡</span>
                            )}
                            <span className="text-[9px] font-mono text-[var(--color-text-muted)]">T{i + 1}</span>
                            {/* Intensity bar */}
                            <div className="w-7 bg-[var(--color-bg-base)] rounded-t-sm" style={{ height: 48 }}>
                              <div
                                className={`w-full rounded-t-sm ${dotColor} opacity-70`}
                                style={{ height: `${Math.round(intensity * 100)}%`, marginTop: "auto" }}
                              />
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

                  {/* Legend */}
                  <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
                    {Object.entries(EMOTION_COLORS).map(([label, color]) => (
                      <span key={label} className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-md capitalize ${color}`}>
                        {label}
                      </span>
                    ))}
                    <span className="text-[9px] font-mono text-red-400 ml-2">⚡ escalation</span>
                    <span className="text-[9px] font-mono text-[var(--color-text-muted)] ml-1">↑↓→ arousal</span>
                  </div>
                </div>
              )}

              {/* ── Raw Event Log ───────────────────────────────────────── */}
              <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
                <h2 className="text-[11px] font-mono font-bold text-[var(--color-text-secondary)] uppercase tracking-widest mb-5">
                  Event Log — <span className="text-[var(--color-accent-cyan)]">{selectedSession.slice(0, 12)}...</span> ({events.length} events)
                </h2>
                <div className="overflow-y-auto max-h-[500px] pr-2 space-y-3">
                  {events.map((ev, i) => (
                    <div key={i} className="flex gap-4 p-4 rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)]">
                      <div className="flex-none pt-1">
                        <div className={`w-2.5 h-2.5 rounded-full ${ev.type === "escalation" ? "bg-red-500 shadow-[0_0_8px_#ef4444]" : "bg-[var(--color-accent-cyan)] shadow-[0_0_8px_var(--color-accent-cyan)]"}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="font-semibold text-[var(--color-text-primary)] capitalize text-[14px]">{ev.type.replace(/_/g, " ")}</span>
                          <span className="text-[11px] font-mono text-[var(--color-text-muted)]">{new Date(ev.ts).toLocaleTimeString()}</span>
                          {ev.type === "escalation" && (
                            <span className="text-[10px] font-mono font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-md">⚡ escalation</span>
                          )}
                          {ev.type === "emotion" && (
                            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-md capitalize ${EMOTION_COLORS[(ev.payload.label as string) ?? "neutral"] ?? "bg-zinc-600 text-white"}`}>
                              {(ev.payload.label as string) ?? "neutral"}
                            </span>
                          )}
                        </div>
                        {ev.type === "retrieval" ? (
                          <div className="space-y-3 mt-2">
                            {/* Summary counts */}
                            <div className="flex items-center gap-2 text-[10px] font-mono">
                              <span className="bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/20">MTM: {(ev.payload.mtmIds as string[])?.length ?? 0}</span>
                              <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">LTM User: {(ev.payload.ltmUserIds as string[])?.length ?? 0}</span>
                              <span className="bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20">LTM Client: {(ev.payload.ltmClientIds as string[])?.length ?? 0}</span>
                            </div>
                            {/* Timeline if present */}
                            {!!ev.payload.timeline && (ev.payload.timeline as any[]).length > 0 && (
                              <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-lg p-3 space-y-1.5">
                                <span className="text-[9px] font-mono font-bold text-zinc-500 block uppercase">Grouped Timeline Events</span>
                                <div className="space-y-2">
                                  {(ev.payload.timeline as any[]).map((evt, idx) => (
                                    <div key={idx} className="border-l border-[var(--color-accent-cyan)] pl-2">
                                      <span className="font-bold text-white text-[11px] uppercase tracking-wider">{evt.topic}</span>
                                      <p className="text-[11px] text-[var(--color-text-secondary)] italic">"{evt.summary}"</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Explanations if present */}
                            {!!ev.payload.scores && (ev.payload.scores as any[]).length > 0 && (
                              <div className="space-y-2">
                                {(ev.payload.scores as any[]).slice(0, 4).map((sObj, idx) => {
                                  const exp = (ev.payload.explanations as Record<string, any>)?.[sObj.id];
                                  return (
                                    <div key={idx} className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-lg p-2.5 space-y-1">
                                      <div className="flex justify-between items-center text-[10px]">
                                        <span className="font-mono text-zinc-400">ID: {sObj.id}</span>
                                        <span className="font-mono font-bold text-[var(--color-accent-cyan)]">Score: {sObj.score}</span>
                                      </div>
                                      {!!exp && (
                                        <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
                                          {exp.reason}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                                {(ev.payload.scores as any[]).length > 4 && (
                                  <div className="text-[10px] font-mono text-zinc-500 text-center">
                                    + {(ev.payload.scores as any[]).length - 4} more records...
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <pre className="text-[12px] text-[var(--color-text-secondary)] whitespace-pre-wrap font-mono break-all bg-[var(--color-bg-base)] p-3 rounded-lg border border-[var(--color-border-subtle)] max-h-32 overflow-hidden">
                            {JSON.stringify(ev.payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
