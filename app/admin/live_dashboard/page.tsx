"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Radio, PhoneCall, Sparkles, ShieldAlert, Zap, Database, HelpCircle, History, Circle, LayoutGrid, Maximize2 } from "lucide-react";
import { EngineDiagnosticPanel, type DiagnosticEmotionResult } from "../../_components/EngineDashboard";

interface ActiveCall {
  id: string;
  sessionId?: string;
  callerNumber: string;
  startedAt: number;
}

interface RecentCall {
  id: string;
  sessionId?: string;
  callerNumber: string;
  status: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
}

interface TranscriptTurn {
  role: "user" | "agent";
  text: string;
  /** True while this bubble is still being filled in word-by-word from
   * "transcript_delta" events — cleared once the turn's final "transcript"
   * event lands. Lets the UI show a subtle "typing" indicator instead of a
   * fully-formed sentence appearing to just materialize. */
  streaming?: boolean;
}

interface RetrievalInfo {
  usedFallback: boolean;
  fallbackText?: string;
  topSource: string | null;
  reason?: string;
  similarity?: number;
}

interface LiveState {
  sessionId: string;
  emotionLabel: string;
  intensity: number;
  confidence: number;
  caiScore: number;
  caiCategory: string;
  flags: Record<string, boolean>;
  transcript: TranscriptTurn[];
  diagnostics: DiagnosticEmotionResult | null;
  retrieval: RetrievalInfo | null;
}

const EMOTION_HUE: Record<string, string> = {
  anger: "#EF4444",
  frustration: "#F87171",
  distress: "#DC2626",
  fear: "#F59E0B",
  confusion: "#FBBF24",
  disappointment: "#FBBF24",
  sadness: "#60A5FA",
  joy: "#34D399",
  gratitude: "#34D399",
  excitement: "#10B981",
  calm: "#38BDF8",
  neutral: "#A78BFA",
};

function emptyLiveState(sessionId: string): LiveState {
  return {
    sessionId,
    emotionLabel: "neutral",
    intensity: 0,
    confidence: 0.5,
    caiScore: 50,
    caiCategory: "Moderate Engagement",
    flags: {},
    transcript: [],
    diagnostics: null,
    retrieval: null,
  };
}

function applySsePayload(prev: LiveState, payload: { type: string; data: any }): LiveState {
  const updated = { ...prev };
  if (payload.type === "emotion") {
    updated.emotionLabel = payload.data.label || "neutral";
    updated.intensity = payload.data.intensity || 0;
    updated.confidence = payload.data.confidence || 0.5;
    updated.flags = payload.data.flags || {};
  } else if (payload.type === "emotion_diagnostic") {
    updated.diagnostics = payload.data as DiagnosticEmotionResult;
  } else if (payload.type === "retrieval") {
    updated.retrieval = payload.data as RetrievalInfo;
  } else if (payload.type === "cai") {
    updated.caiScore = payload.data.score || 50;
    updated.caiCategory = payload.data.category || "Moderate Engagement";
  } else if (payload.type === "transcript_delta") {
    // Genuine word-by-word streaming, synced with what's actually being
    // generated — updates (never appends a new bubble for) the in-progress
    // agent turn as raw text deltas arrive. Only ever fires for the agent's
    // side; the caller's own turn is always already-final when it's
    // transcribed.
    const last = updated.transcript[updated.transcript.length - 1];
    if (last?.role === "agent" && last.streaming) {
      updated.transcript = [
        ...updated.transcript.slice(0, -1),
        { role: "agent", text: payload.data.text, streaming: true },
      ];
    } else {
      updated.transcript = [...updated.transcript, { role: "agent", text: payload.data.text, streaming: true }];
    }
  } else if (payload.type === "transcript") {
    // The authoritative, guarded final text for this turn. If a streaming
    // bubble for the same role is already in progress, replace it in place
    // (the turn is now finalized) rather than appending a duplicate.
    const last = updated.transcript[updated.transcript.length - 1];
    if (last?.role === payload.data.role && last.streaming) {
      updated.transcript = [
        ...updated.transcript.slice(0, -1),
        { role: payload.data.role, text: payload.data.text },
      ];
    } else {
      updated.transcript = [...updated.transcript, { role: payload.data.role, text: payload.data.text }];
    }
  }
  return updated;
}

export default function LiveDashboardPage() {
  return (
    <Suspense fallback={null}>
      <LiveDashboardInner />
    </Suspense>
  );
}

function LiveDashboardInner() {
  // Deep-link support — e.g. "/admin/live_dashboard?session=<id>" from the
  // Patients page's call-history list, so clicking a specific past call's
  // "View full analysis" jumps straight to it instead of landing on
  // whatever's currently live/most-recent.
  const searchParams = useSearchParams();
  const deepLinkedSessionId = searchParams.get("session");

  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(deepLinkedSessionId);
  // "focus" = one big detail view (the original design). "grid" = every
  // live call at once, side by side — what "can we see 2 callers live"
  // actually needs: watching more than one call's transcript/emotion feed
  // simultaneously, not just switching which single one is displayed.
  const [viewMode, setViewMode] = useState<"focus" | "grid">("focus");
  // Every ACTIVE call gets its own live state, updated continuously in the
  // background regardless of which one is currently focused/visible — this
  // is what makes switching between two live callers lossless. Keyed by
  // sessionId (falls back to call.id for the rare row with no sessionId
  // yet).
  const [liveStates, setLiveStates] = useState<Record<string, LiveState>>({});
  // Historical (ended) call currently focused, if any — fetched once via
  // replay, not updated afterward (a finished call's history doesn't change).
  const [replayState, setReplayState] = useState<LiveState | null>(null);
  // The replay endpoint's own call metadata — used for the header instead
  // of looking the session up in `recentCalls` (capped at the 20 most
  // recent calls tenant-wide), so a deep-linked call from a specific
  // patient's history still shows a correct header even if it's aged out
  // of that short list.
  const [replayCallMeta, setReplayCallMeta] = useState<RecentCall | null>(null);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
  const eventSourcesRef = useRef<Record<string, EventSource>>({});

  const isLive = activeCalls.some((c) => (c.sessionId || c.id) === sessionId);

  // Same active-call source LiveCallMonitor.tsx already uses — call_logs
  // rows only ever get written by lib/telephony/stream-handler.ts (real
  // Twilio calls, inbound or outbound), never by the browser demo/test-call
  // path (server.ts), so this is already exactly "the actual call feature,
  // not the testing one" with no extra filtering needed.
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch("/api/session/active");
        const data = await res.json();
        const calls: ActiveCall[] = data.calls ?? [];
        setActiveCalls(calls);
        setSessionId((current) => {
          if (current) return current;
          return calls.length > 0 ? calls[0].sessionId || calls[0].id : null;
        });
      } catch {
        // keep last known state on a transient poll failure
      }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  // Recently-ended calls — "make sure live dashboard sessions are also
  // saving so we can evaluate that also in that page" — polled less
  // aggressively since a finished call's history doesn't change.
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch("/api/session/recent");
        const data = await res.json();
        setRecentCalls(data.calls ?? []);
      } catch {
        // keep last known state on a transient poll failure
      }
    }
    poll();
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, []);

  function selectCall(id: string) {
    setSessionId(id);
  }

  // One persistent SSE connection PER active call, opened/closed to track
  // the active-call list — not just for whichever one is currently
  // focused. This is the actual fix for "watching 2 live callers": before,
  // switching away from call A to look at call B silently dropped every
  // event call A produced in the meantime, because only the focused call
  // had a subscription at all.
  useEffect(() => {
    const currentIds = new Set(activeCalls.map((c) => c.sessionId || c.id));
    const openIds = new Set(Object.keys(eventSourcesRef.current));

    for (const id of currentIds) {
      if (openIds.has(id)) continue;
      setLiveStates((prev) => (prev[id] ? prev : { ...prev, [id]: emptyLiveState(id) }));
      const es = new EventSource(`/api/session/${id}/stream`);
      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!payload.type) return;
          setLiveStates((prev) => {
            const existing = prev[id] ?? emptyLiveState(id);
            return { ...prev, [id]: applySsePayload(existing, payload) };
          });
        } catch {
          // ignore malformed frames
        }
      };
      eventSourcesRef.current[id] = es;
    }

    for (const id of openIds) {
      if (currentIds.has(id)) continue;
      eventSourcesRef.current[id]?.close();
      delete eventSourcesRef.current[id];
      setLiveStates((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, [activeCalls]);

  // Close every open SSE connection on unmount.
  useEffect(() => {
    return () => {
      for (const es of Object.values(eventSourcesRef.current)) es.close();
      eventSourcesRef.current = {};
    };
  }, []);

  // Historical path: a past (ended) call was focused — fetch its full
  // replay once instead of opening a live SSE subscription (there's nothing
  // further to stream for a call that's already over).
  useEffect(() => {
    if (!sessionId || isLive) {
      setReplayState(null);
      setReplayCallMeta(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/session/${sessionId}/replay`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.liveState) setReplayState(data.liveState as LiveState);
        if (data.call) {
          setReplayCallMeta({
            id: data.call.id,
            sessionId,
            callerNumber: data.call.callerNumber,
            status: data.call.status,
            startedAt: data.call.startedAt,
            endedAt: data.call.endedAt,
            durationMs: data.call.durationMs,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId, isLive]);

  const focusedLiveState = sessionId ? (isLive ? liveStates[sessionId] ?? null : replayState) : null;

  // Orb reacts to real detected-emotion intensity/label — there's no local
  // mic on this page (it's watching a phone call over SSE, not capturing
  // audio itself), so intensity is the honest "how much is happening right
  // now" signal available here.
  useEffect(() => {
    if (!orbRef.current) return;
    const level = focusedLiveState ? focusedLiveState.intensity : 0;
    const hue = focusedLiveState ? EMOTION_HUE[focusedLiveState.emotionLabel] ?? EMOTION_HUE.neutral : "#7679A0";
    orbRef.current.style.setProperty("--level", level.toFixed(3));
    orbRef.current.style.setProperty("--hue", hue);
  }, [focusedLiveState?.intensity, focusedLiveState?.emotionLabel]);

  // Scroll only the transcript panel's own scroll container, not the page.
  // scrollIntoView() (the previous approach) scrolls EVERY scrollable
  // ancestor needed to bring its target into view, which in practice
  // included the whole page — each new turn nudged the entire viewport
  // down, eventually scrolling the header/nav off-screen entirely on a
  // long call. Setting scrollTop directly on the transcript's own
  // container touches only that element.
  useEffect(() => {
    const el = transcriptContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [focusedLiveState?.transcript.length]);

  const activeCall = activeCalls.find((c) => (c.sessionId || c.id) === sessionId);
  const recentCall = recentCalls.find((c) => (c.sessionId || c.id) === sessionId) ?? replayCallMeta;
  const hasMultipleCalls = activeCalls.length + recentCalls.length > 1;

  return (
    <div className="min-h-screen voxera-console px-8 py-10 flex flex-col items-center">
      <div className="w-full max-w-6xl flex flex-col items-center">
        <div className="flex items-center gap-2 mb-2">
          <Radio className="w-4 h-4 text-[var(--console-cyan)]" />
          <span className="text-[10.5px] font-mono uppercase tracking-[0.25em] text-[var(--console-text-dim)]">
            Live Dashboard
          </span>
        </div>

        {/* Call switcher — active calls (live-pulsing) and recently-ended
            calls (for evaluation) side by side, so multiple concurrent
            calls (or a past one worth reviewing) are one click away instead
            of only ever showing whatever connected first. */}
        {hasMultipleCalls && (
          <div className="w-full flex flex-wrap items-center justify-center gap-2 mt-4">
            {activeCalls.map((c) => {
              const id = c.sessionId || c.id;
              const selected = id === sessionId;
              return (
                <button
                  key={id}
                  onClick={() => selectCall(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-mono transition-colors ${
                    selected && viewMode === "focus"
                      ? "bg-[var(--console-cyan)]/20 border border-[var(--console-cyan)]/50 text-[var(--console-cyan)]"
                      : "bg-[var(--console-surface)]/60 border border-[var(--console-border)] text-[var(--console-text-dim)] hover:text-[var(--console-text)]"
                  }`}
                >
                  <Circle className="w-2 h-2 fill-current animate-pulse" />
                  {c.callerNumber || "Live call"}
                </button>
              );
            })}
            {recentCalls.map((c) => {
              const id = c.sessionId || c.id;
              const selected = id === sessionId;
              return (
                <button
                  key={id}
                  onClick={() => selectCall(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-mono transition-colors ${
                    selected && viewMode === "focus"
                      ? "bg-[var(--console-violet)]/20 border border-[var(--console-violet)]/50 text-[var(--console-violet)]"
                      : "bg-[var(--console-surface)]/60 border border-[var(--console-border)] text-[var(--console-text-dim)] hover:text-[var(--console-text)]"
                  }`}
                >
                  <History className="w-3 h-3" />
                  {c.callerNumber || "Call"}
                </button>
              );
            })}

            {/* Watching 2+ live callers at once needs a side-by-side grid,
                not just fast switching between single-focus views — this
                toggle is that view. Only worth showing once there's
                actually more than one call happening live at the same
                time. */}
            {activeCalls.length > 1 && (
              <button
                onClick={() => setViewMode((m) => (m === "grid" ? "focus" : "grid"))}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-mono transition-colors ml-2 ${
                  viewMode === "grid"
                    ? "bg-emerald-500/20 border border-emerald-500/50 text-emerald-400"
                    : "bg-[var(--console-surface)]/60 border border-[var(--console-border)] text-[var(--console-text-dim)] hover:text-[var(--console-text)]"
                }`}
              >
                {viewMode === "grid" ? <Maximize2 className="w-3 h-3" /> : <LayoutGrid className="w-3 h-3" />}
                {viewMode === "grid" ? "Focus one call" : `View all ${activeCalls.length} live calls`}
              </button>
            )}
          </div>
        )}

        {viewMode === "grid" ? (
          <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-5 mt-8">
            {activeCalls.map((c) => {
              const id = c.sessionId || c.id;
              const state = liveStates[id];
              const hue = state ? EMOTION_HUE[state.emotionLabel] ?? EMOTION_HUE.neutral : "#7679A0";
              const lastTurns = state?.transcript.slice(-4) ?? [];
              return (
                <button
                  key={id}
                  onClick={() => {
                    selectCall(id);
                    setViewMode("focus");
                  }}
                  className="text-left voxera-console-hairline rounded-2xl bg-[var(--console-surface)]/60 backdrop-blur-xl p-4 flex flex-col gap-3 hover:border-[var(--console-cyan)]/40 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: hue }} />
                      <span className="text-[13.5px] font-bold text-[var(--console-text)]">{c.callerNumber || "Live call"}</span>
                    </div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--console-text-dim)] capitalize">
                      {state?.emotionLabel ?? "neutral"}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-[11px] text-[var(--console-text-dim)]">
                    <span>Engagement <span className="text-[var(--console-text)] font-semibold">{state?.caiScore ?? 50}</span>/100</span>
                    {state && Object.values(state.flags).some(Boolean) && (
                      <span className="flex items-center gap-1 text-red-400"><ShieldAlert className="w-3 h-3" /> flagged</span>
                    )}
                  </div>

                  <div className="flex-1 min-h-[110px] max-h-[150px] overflow-y-auto flex flex-col gap-1.5 text-[12px]">
                    {lastTurns.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-[var(--console-text-dim)] italic">
                        Waiting for the first turn…
                      </div>
                    ) : (
                      lastTurns.map((t, i) => (
                        <div
                          key={i}
                          className={`rounded-lg px-2.5 py-1.5 leading-snug ${
                            t.role === "user"
                              ? "self-end bg-[var(--console-violet)]/20 text-[var(--console-text)] max-w-[85%]"
                              : "self-start bg-[var(--console-surface-raised)] border border-[var(--console-border)] text-[var(--console-text)] max-w-[85%]"
                          }`}
                        >
                          {t.text}
                          {t.streaming && <span className="inline-block w-1.5 h-3.5 bg-current opacity-70 ml-0.5 align-middle animate-pulse" />}
                        </div>
                      ))
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <div ref={orbRef} className="voxera-orb-live w-40 h-40 sm:w-48 sm:h-48 flex-none mt-4 mb-6" />

            <div className="text-center mb-10">
              {activeCall ? (
                <>
                  <div className="text-[15px] font-bold text-[var(--console-text)]">{activeCall.callerNumber || "Live call"}</div>
                  <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--console-cyan)] flex items-center justify-center gap-1.5 mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--console-cyan)] animate-pulse" /> On call
                    {focusedLiveState && <span className="text-[var(--console-text-dim)] capitalize">· {focusedLiveState.emotionLabel}</span>}
                  </div>
                </>
              ) : recentCall ? (
                <>
                  <div className="text-[15px] font-bold text-[var(--console-text)]">{recentCall.callerNumber || "Call"}</div>
                  <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--console-violet)] flex items-center justify-center gap-1.5 mt-1">
                    <History className="w-3 h-3" /> Ended{recentCall.durationMs ? ` · ${Math.round(recentCall.durationMs / 1000)}s` : ""}
                    {recentCall.status === "failed" && <span className="text-red-400">· failed</span>}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[15px] font-bold text-[var(--console-text)]">Waiting for a call</div>
                  <div className="text-[11.5px] text-[var(--console-text-dim)] mt-1 max-w-md">
                    Build an agent in Agent Builder, upload its knowledge base, then place a call from Bulk Calls or a
                    real inbound call — this page picks it up automatically once it connects.
                  </div>
                </>
              )}
            </div>

            {focusedLiveState && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6">
                {/* Live transcript — the real call, not the browser test-call feature */}
                <div className="voxera-console-hairline rounded-2xl bg-[var(--console-surface)]/60 backdrop-blur-xl p-5 flex flex-col min-h-[420px] max-h-[560px]">
                  <div className="voxera-console-label text-[10px] font-bold mb-3 flex items-center gap-1.5">
                    <PhoneCall className="w-3.5 h-3.5" /> {isLive ? "Live Transcript" : "Transcript"}
                  </div>
                  <div ref={transcriptContainerRef} className="flex-1 overflow-y-auto flex flex-col gap-2.5 pr-1">
                    {focusedLiveState.transcript.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--console-text-dim)] italic">
                        Waiting for the first turn…
                      </div>
                    ) : (
                      focusedLiveState.transcript.map((t, i) => (
                        <div
                          key={i}
                          className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[13px] leading-snug ${
                            t.role === "user"
                              ? "self-end bg-[var(--console-violet)]/20 text-[var(--console-text)]"
                              : "self-start bg-[var(--console-surface-raised)] border border-[var(--console-border)] text-[var(--console-text)]"
                          }`}
                        >
                          {t.text}
                          {t.streaming && <span className="inline-block w-1.5 h-3.5 bg-current opacity-70 ml-0.5 align-middle animate-pulse" />}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Dual-engine emotion analysis + CAI + flags */}
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="voxera-console-hairline rounded-xl bg-[var(--console-surface)]/60 backdrop-blur-xl p-3.5">
                      <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--console-text-dim)] mb-1">Detected Emotion</div>
                      <div className="text-[15px] font-bold capitalize text-[var(--console-text)]">{focusedLiveState.emotionLabel}</div>
                      <div className="text-[10.5px] text-[var(--console-text-dim)] mt-1">{(focusedLiveState.confidence * 100).toFixed(0)}% conf</div>
                    </div>
                    <div className="voxera-console-hairline rounded-xl bg-[var(--console-surface)]/60 backdrop-blur-xl p-3.5">
                      <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--console-text-dim)] mb-1 flex items-center gap-1">
                        <Zap className="w-3 h-3" /> Engagement
                      </div>
                      <div className="text-[15px] font-bold text-[var(--console-text)]">{focusedLiveState.caiScore}<span className="text-[11px] font-normal text-[var(--console-text-dim)]"> /100</span></div>
                      <div className="text-[10.5px] text-[var(--console-text-dim)] mt-1">{focusedLiveState.caiCategory}</div>
                    </div>
                  </div>

                  {Object.values(focusedLiveState.flags).some(Boolean) && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 flex items-center gap-2 text-red-400 text-[11.5px] font-medium">
                      <ShieldAlert className="w-4 h-4 flex-none" />
                      {Object.entries(focusedLiveState.flags).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " ")).join(", ")}
                    </div>
                  )}

                  {/* Explainability — which knowledge source the reply actually
                      drew from and why, or that nothing cleared the grounding
                      bar and the predefined fallback/hedge language was used
                      instead. */}
                  {focusedLiveState.retrieval && (
                    <div className="voxera-console-hairline rounded-xl bg-[var(--console-surface)]/60 backdrop-blur-xl p-3.5">
                      <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--console-text-dim)] mb-2 flex items-center gap-1">
                        {focusedLiveState.retrieval.usedFallback ? <HelpCircle className="w-3 h-3" /> : <Database className="w-3 h-3" />}
                        Data Source
                      </div>
                      {focusedLiveState.retrieval.usedFallback ? (
                        <div className="text-[12px] text-amber-400 leading-snug">
                          Nothing cleared the grounding bar — spoke the predefined fallback instead of guessing.
                          {focusedLiveState.retrieval.fallbackText && (
                            <div className="mt-1.5 text-[11px] text-[var(--console-text-dim)] italic">"{focusedLiveState.retrieval.fallbackText}"</div>
                          )}
                        </div>
                      ) : focusedLiveState.retrieval.topSource ? (
                        <div className="text-[12px] text-[var(--console-text)] leading-snug">
                          Pulled from <span className="font-semibold text-[var(--console-cyan)]">{focusedLiveState.retrieval.topSource}</span>
                          {focusedLiveState.retrieval.similarity !== undefined && (
                            <span className="text-[var(--console-text-dim)]"> · {(focusedLiveState.retrieval.similarity * 100).toFixed(0)}% match</span>
                          )}
                          {focusedLiveState.retrieval.reason && (
                            <div className="mt-1 text-[11px] text-[var(--console-text-dim)]">{focusedLiveState.retrieval.reason}</div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[11.5px] text-[var(--console-text-dim)] italic">No knowledge lookup needed for this turn.</div>
                      )}
                    </div>
                  )}

                  <div className="voxera-console-hairline rounded-2xl bg-[var(--console-surface)]/60 backdrop-blur-xl p-4">
                    <div className="voxera-console-label text-[10px] font-bold mb-3 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Engine Breakdown
                    </div>
                    <EngineDiagnosticPanel diagnostics={focusedLiveState.diagnostics} compact />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
