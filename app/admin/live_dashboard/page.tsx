"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Radio, PhoneCall, ShieldAlert, Zap, Database, HelpCircle, History, Circle, LayoutGrid, Maximize2, Trash2, RotateCcw } from "lucide-react";
import { EngineDiagnosticPanel, type DiagnosticEmotionResult } from "../../_components/EngineDashboard";

interface ActiveCall {
  id: string;
  sessionId?: string;
  callerNumber: string;
  patientId?: string | null;
  startedAt: number;
}

interface RecentCall {
  id: string;
  sessionId?: string;
  callerNumber: string;
  patientId?: string | null;
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

interface PatientInfo {
  id: string;
  name: string;
  phone: string | null;
}

/** Browser-local marker for "Clear history": past calls that started at or
 * before this instant are hidden from the Live Calls bar. Hiding, not
 * deleting — call_logs also back Calls & Insights and each patient's
 * history, which must keep them. */
const HISTORY_CLEARED_KEY = "voxera.liveCalls.historyClearedAt";

function readHistoryClearedAt(): number {
  try {
    return Number(window.localStorage.getItem(HISTORY_CLEARED_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeHistoryClearedAt(value: number) {
  try {
    if (value) window.localStorage.setItem(HISTORY_CLEARED_KEY, String(value));
    else window.localStorage.removeItem(HISTORY_CLEARED_KEY);
  } catch {
    // Storage unavailable (private window, blocked site data) — the clear
    // still applies for this page visit, it just won't be remembered.
  }
}

const digitsOnly = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "");

/** The patient/client a call belongs to: by the call's patientId, else by
 * matching the caller's number against a patient's phone (an inbound call
 * from a known patient isn't tagged with patientId), else "Unknown caller".
 * Never falls back to showing the raw phone number. */
function callerName(
  call: { patientId?: string | null; callerNumber: string } | null | undefined,
  patients: Record<string, PatientInfo>,
  patientsByPhone: Record<string, PatientInfo>,
): string {
  if (!call) return "Call";
  if (call.patientId && patients[call.patientId]) return patients[call.patientId].name;
  const digits = digitsOnly(call.callerNumber);
  // Compare the last 10 digits so "+91 98765 43210" matches "9876543210".
  const byPhone = digits ? patientsByPhone[digits.slice(-10)] : undefined;
  return byPhone?.name ?? "Unknown caller";
}

/** "Today, 5:30 pm" / "Yesterday, 11:02 am" / "24 Oct, 9:15 am". */
function formatCallTime(ms: number): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  if (ms >= startOfToday.getTime()) return `Today, ${time}`;
  if (ms >= startOfToday.getTime() - dayMs) return `Yesterday, ${time}`;
  const sameYear = date.getFullYear() === startOfToday.getFullYear();
  const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  return `${day}, ${time}`;
}

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
  // "focus" = one detail view (transcript + analytics for a single call).
  // "grid" = every live call at once, side by side — what "can we see 2
  // callers live" actually needs: watching more than one call's
  // transcript/emotion feed simultaneously, not just switching which single
  // one is displayed.
  const [viewMode, setViewMode] = useState<"focus" | "grid">("focus");
  // Which analytics tab is showing for the focused call — Overview (emotion
  // + engagement + flags), Engine Breakdown (the dual text-engine + acoustic
  // diagnostic panel), or Data Source (retrieval/grounding explainability).
  // Tabbed instead of stacked so the whole right column fits one viewport
  // without scrolling past it.
  const [analyticsTab, setAnalyticsTab] = useState<"overview" | "engine" | "source">("overview");
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
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
  const eventSourcesRef = useRef<Record<string, EventSource>>({});
  // Patient names for the call bar/headers, keyed by id and by the last 10
  // digits of their phone number.
  const [patients, setPatients] = useState<Record<string, PatientInfo>>({});
  const patientsByPhone = useMemo(() => {
    const map: Record<string, PatientInfo> = {};
    for (const p of Object.values(patients)) {
      const digits = digitsOnly(p.phone);
      if (digits) map[digits.slice(-10)] = p;
    }
    return map;
  }, [patients]);
  // Read after mount (not in the initializer) so server and client render
  // the same first frame.
  const [historyClearedAt, setHistoryClearedAt] = useState(0);
  useEffect(() => {
    setHistoryClearedAt(readHistoryClearedAt());
  }, []);

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

  // Patient list — refreshed every minute so a patient added mid-session
  // gets their name on the bar without a page reload.
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/admin/patients");
        const data = await res.json();
        const byId: Record<string, PatientInfo> = {};
        for (const p of data.patients ?? []) byId[p.id] = { id: p.id, name: p.name, phone: p.phone ?? null };
        setPatients(byId);
      } catch {
        // keep last known names on a transient failure
      }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  function selectCall(id: string) {
    setSessionId(id);
  }

  // Newest first. Past calls hidden by "Clear history" are filtered out
  // here; live calls are never hidden.
  const sortedActiveCalls = useMemo(() => [...activeCalls].sort((a, b) => b.startedAt - a.startedAt), [activeCalls]);
  const visibleRecentCalls = useMemo(
    () => recentCalls.filter((c) => c.startedAt > historyClearedAt).sort((a, b) => b.startedAt - a.startedAt),
    [recentCalls, historyClearedAt],
  );
  const hiddenRecentCount = recentCalls.length - visibleRecentCalls.length;

  function clearHistory() {
    if (!window.confirm("Clear past calls from this bar? They stay saved in Calls & Insights and each patient's history.")) return;
    const now = Date.now();
    setHistoryClearedAt(now);
    writeHistoryClearedAt(now);
    // Drop the focus if it was on a past call that just got hidden.
    setSessionId((current) => (current && activeCalls.some((c) => (c.sessionId || c.id) === current) ? current : null));
  }

  function restoreHistory() {
    setHistoryClearedAt(0);
    writeHistoryClearedAt(0);
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

      // The stream only carries what happens from now on. If the call was
      // already underway when this page opened (or the page was refreshed
      // mid-call), load everything said so far from the persisted log so
      // the transcript doesn't start blank. Skipped if live turns already
      // arrived in the meantime, so nothing is shown twice.
      fetch(`/api/session/${id}/replay`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const snapshot = data?.liveState as LiveState | undefined;
          if (!snapshot || !eventSourcesRef.current[id]) return;
          setLiveStates((prev) => {
            const existing = prev[id];
            if (snapshot.transcript.length === 0 || (existing && existing.transcript.length > 0)) return prev;
            return { ...prev, [id]: { ...snapshot, sessionId: id } };
          });
        })
        .catch(() => {});
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
            patientId: data.call.patientId ?? null,
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

  // Scroll only the transcript panel's own scroll container, not the page.
  // scrollIntoView() (the previous approach) scrolls EVERY scrollable
  // ancestor needed to bring its target into view, which in practice
  // included the whole page — each new turn nudged the entire viewport
  // down, eventually scrolling the header/nav off-screen entirely on a
  // long call. Setting scrollTop directly on the transcript's own
  // container touches only that element.
  // Also keyed on the last bubble's text, so the view keeps following a
  // reply as it streams in word by word, not only when a new bubble starts.
  const turnCount = focusedLiveState?.transcript.length ?? 0;
  const lastTurnText = focusedLiveState?.transcript[turnCount - 1]?.text;
  useEffect(() => {
    const el = transcriptContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turnCount, lastTurnText]);

  const activeCall = activeCalls.find((c) => (c.sessionId || c.id) === sessionId);
  const recentCall = recentCalls.find((c) => (c.sessionId || c.id) === sessionId) ?? replayCallMeta;
  const hasAnyCalls = sortedActiveCalls.length + visibleRecentCalls.length > 0;
  const focusedCall = activeCall ?? recentCall;
  const hue = focusedLiveState ? EMOTION_HUE[focusedLiveState.emotionLabel] ?? EMOTION_HUE.neutral : "#7679A0";

  const chipClass = (selected: boolean, accent: "cyan" | "violet") =>
    `flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[11.5px] transition-colors ${
      selected
        ? accent === "cyan"
          ? "bg-[var(--console-cyan)]/20 border border-[var(--console-cyan)]/50 text-[var(--console-cyan)]"
          : "bg-[var(--console-violet)]/20 border border-[var(--console-violet)]/50 text-[var(--console-violet)]"
        : "bg-[var(--console-surface)]/60 border border-[var(--console-border)] text-[var(--console-text-dim)] hover:text-[var(--console-text)]"
    }`;

  return (
    <div className="flex h-full flex-col voxera-console">
      {/* Page header row — title, call switcher (single scrollable line,
          never wraps into extra rows) and the grid/focus toggle, all in one
          compact strip instead of a tall centered hero. Each chip is the
          patient's name plus when the call started, newest first: live
          calls, then past ones. */}
      <div className="flex flex-none items-center gap-3 border-b border-[var(--console-border)] px-6 py-3">
        <div className="flex flex-none items-center gap-2">
          <Radio className="h-4 w-4 text-[var(--console-cyan)]" />
          <span className="text-[13px] font-semibold text-[var(--console-text)]">Live Calls</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {sortedActiveCalls.map((c) => {
            const id = c.sessionId || c.id;
            return (
              <button
                key={id}
                onClick={() => selectCall(id)}
                title={`Live · started ${formatCallTime(c.startedAt)}`}
                className={chipClass(id === sessionId && viewMode === "focus", "cyan")}
              >
                <Circle className="h-2 w-2 fill-current animate-pulse" />
                <span className="font-semibold">{callerName(c, patients, patientsByPhone)}</span>
                <span className="opacity-70">· Live</span>
              </button>
            );
          })}
          {visibleRecentCalls.map((c) => {
            const id = c.sessionId || c.id;
            return (
              <button
                key={id}
                onClick={() => selectCall(id)}
                className={chipClass(id === sessionId && viewMode === "focus", "violet")}
              >
                <History className="h-3 w-3" />
                <span className="font-semibold">{callerName(c, patients, patientsByPhone)}</span>
                <span className="opacity-70">· {formatCallTime(c.startedAt)}</span>
              </button>
            );
          })}
          {!hasAnyCalls && hiddenRecentCount > 0 && (
            <span className="text-[11.5px] italic text-[var(--console-text-dim)]">History cleared</span>
          )}
        </div>

        {visibleRecentCalls.length > 0 ? (
          <button
            onClick={clearHistory}
            title="Hide past calls from this bar (they stay in Calls & Insights)"
            className="flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--console-border)] bg-[var(--console-surface)]/60 px-3 py-1 text-[11.5px] text-[var(--console-text-dim)] transition-colors hover:border-red-500/50 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
            Clear history
          </button>
        ) : hiddenRecentCount > 0 ? (
          <button
            onClick={restoreHistory}
            title="Show the past calls you cleared again"
            className="flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--console-border)] bg-[var(--console-surface)]/60 px-3 py-1 text-[11.5px] text-[var(--console-text-dim)] transition-colors hover:text-[var(--console-text)]"
          >
            <RotateCcw className="h-3 w-3" />
            Show cleared ({hiddenRecentCount})
          </button>
        ) : null}

        {/* Watching 2+ live callers at once needs a side-by-side grid, not
            just fast switching between single-focus views — this toggle is
            that view. Only worth showing once there's actually more than
            one call happening live at the same time. */}
        {activeCalls.length > 1 && (
          <button
            onClick={() => setViewMode((m) => (m === "grid" ? "focus" : "grid"))}
            className={`flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[11.5px] font-mono transition-colors ${
              viewMode === "grid"
                ? "bg-emerald-500/20 border border-emerald-500/50 text-emerald-400"
                : "bg-[var(--console-surface)]/60 border border-[var(--console-border)] text-[var(--console-text-dim)] hover:text-[var(--console-text)]"
            }`}
          >
            {viewMode === "grid" ? <Maximize2 className="h-3 w-3" /> : <LayoutGrid className="h-3 w-3" />}
            {viewMode === "grid" ? "Focus" : `All ${activeCalls.length}`}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 p-4">
        {viewMode === "grid" ? (
          <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto md:grid-cols-2">
            {sortedActiveCalls.map((c) => {
              const id = c.sessionId || c.id;
              const state = liveStates[id];
              const cardHue = state ? EMOTION_HUE[state.emotionLabel] ?? EMOTION_HUE.neutral : "#7679A0";
              const lastTurns = state?.transcript.slice(-4) ?? [];
              return (
                <button
                  key={id}
                  onClick={() => {
                    selectCall(id);
                    setViewMode("focus");
                  }}
                  className="flex min-h-[220px] flex-col gap-3 rounded-2xl voxera-console-hairline bg-[var(--console-surface)]/60 p-4 text-left backdrop-blur-xl transition-colors hover:border-[var(--console-cyan)]/40"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: cardHue }} />
                      <span className="text-[13.5px] font-bold text-[var(--console-text)]">{callerName(c, patients, patientsByPhone)}</span>
                    </div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--console-text-dim)] capitalize">
                      {state?.emotionLabel ?? "neutral"}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-[11px] text-[var(--console-text-dim)]">
                    <span>Engagement <span className="text-[var(--console-text)] font-semibold">{state?.caiScore ?? 50}</span>/100</span>
                    {state && Object.values(state.flags).some(Boolean) && (
                      <span className="flex items-center gap-1 text-red-400"><ShieldAlert className="h-3 w-3" /> flagged</span>
                    )}
                  </div>

                  <div className="flex min-h-[110px] max-h-[150px] flex-1 flex-col gap-1.5 overflow-y-auto text-[12px]">
                    {lastTurns.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center italic text-[var(--console-text-dim)]">
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
                          {t.streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle opacity-70" />}
                        </div>
                      ))
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : !focusedLiveState && !activeCall && !recentCall ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Radio className="h-8 w-8 text-[var(--console-text-dim)]" />
            <div className="text-[15px] font-bold text-[var(--console-text)]">Waiting for a call</div>
            <div className="max-w-md text-[12.5px] text-[var(--console-text-dim)]">
              Build an agent in Agent Builder, upload its knowledge base, then place a call from Bulk Calls or a real
              inbound call — this page picks it up automatically once it connects.
            </div>
          </div>
        ) : (
          <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
            {/* Transcript column — compact status strip up top instead of a
                full-width hero, then the conversation filling the rest of
                the column with its own internal scroll. */}
            <div className="flex min-h-0 flex-col rounded-2xl voxera-console-hairline bg-[var(--console-surface)]/60 backdrop-blur-xl">
              <div className="flex flex-none items-center gap-3 border-b border-[var(--console-border)] px-4 py-3">
                <span className="h-2.5 w-2.5 flex-none rounded-full animate-pulse" style={{ background: hue }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold text-[var(--console-text)]">
                    {callerName(focusedCall, patients, patientsByPhone)}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10.5px] font-mono uppercase tracking-widest text-[var(--console-text-dim)]">
                    {activeCall ? (
                      <>
                        <span className="text-[var(--console-cyan)]">On call</span>
                        <span>· {formatCallTime(activeCall.startedAt)}</span>
                        {focusedLiveState && <span className="capitalize">· {focusedLiveState.emotionLabel}</span>}
                      </>
                    ) : (
                      <>
                        <History className="h-3 w-3" />
                        {recentCall?.startedAt ? `${formatCallTime(recentCall.startedAt)} · ` : ""}
                        Ended{recentCall?.durationMs ? ` · ${Math.round(recentCall.durationMs / 1000)}s` : ""}
                        {recentCall?.status === "failed" && <span className="text-red-400">· failed</span>}
                      </>
                    )}
                  </div>
                </div>
                <PhoneCall className="h-3.5 w-3.5 flex-none text-[var(--console-text-dim)]" />
              </div>

              <div ref={transcriptContainerRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
                {!focusedLiveState || focusedLiveState.transcript.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-[12px] italic text-[var(--console-text-dim)]">
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
                      {t.streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle opacity-70" />}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Analytics column — tabbed instead of stacked, so Overview +
                Engine Breakdown + Data Source each get the full column
                height instead of adding to it. */}
            <div className="flex min-h-0 flex-col rounded-2xl voxera-console-hairline bg-[var(--console-surface)]/60 backdrop-blur-xl">
              <div className="flex flex-none items-center gap-1 border-b border-[var(--console-border)] px-2 pt-2">
                {(
                  [
                    { key: "overview", label: "Overview" },
                    { key: "engine", label: "Engine" },
                    { key: "source", label: "Data Source" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setAnalyticsTab(tab.key)}
                    className={`rounded-t-lg px-3 py-2 text-[11.5px] font-semibold transition-colors ${
                      analyticsTab === tab.key
                        ? "bg-[var(--console-surface-raised)] text-[var(--console-text)]"
                        : "text-[var(--console-text-dim)] hover:text-[var(--console-text)]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {!focusedLiveState ? (
                  <div className="flex h-full items-center justify-center text-[12px] italic text-[var(--console-text-dim)]">
                    No analytics yet.
                  </div>
                ) : analyticsTab === "overview" ? (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl voxera-console-hairline bg-[var(--console-surface-raised)]/60 p-3.5">
                        <div className="mb-1 text-[9px] font-mono uppercase tracking-widest text-[var(--console-text-dim)]">
                          Detected Emotion
                        </div>
                        <div className="text-[15px] font-bold capitalize text-[var(--console-text)]">
                          {focusedLiveState.emotionLabel}
                        </div>
                        <div className="mt-1 text-[10.5px] text-[var(--console-text-dim)]">
                          {(focusedLiveState.confidence * 100).toFixed(0)}% conf
                        </div>
                      </div>
                      <div className="rounded-xl voxera-console-hairline bg-[var(--console-surface-raised)]/60 p-3.5">
                        <div className="mb-1 flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-[var(--console-text-dim)]">
                          <Zap className="h-3 w-3" /> Engagement
                        </div>
                        <div className="text-[15px] font-bold text-[var(--console-text)]">
                          {focusedLiveState.caiScore}
                          <span className="text-[11px] font-normal text-[var(--console-text-dim)]"> /100</span>
                        </div>
                        <div className="mt-1 text-[10.5px] text-[var(--console-text-dim)]">{focusedLiveState.caiCategory}</div>
                      </div>
                    </div>

                    {Object.values(focusedLiveState.flags).some(Boolean) && (
                      <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[11.5px] font-medium text-red-400">
                        <ShieldAlert className="h-4 w-4 flex-none" />
                        {Object.entries(focusedLiveState.flags).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " ")).join(", ")}
                      </div>
                    )}
                  </div>
                ) : analyticsTab === "engine" ? (
                  <EngineDiagnosticPanel diagnostics={focusedLiveState.diagnostics} compact />
                ) : (
                  // Explainability — which knowledge source the reply actually
                  // drew from and why, or that nothing cleared the grounding
                  // bar and the predefined fallback/hedge language was used
                  // instead.
                  <div>
                    {!focusedLiveState.retrieval ? (
                      <div className="text-[11.5px] italic text-[var(--console-text-dim)]">No retrieval data for this turn yet.</div>
                    ) : focusedLiveState.retrieval.usedFallback ? (
                      <div className="flex items-start gap-2 text-[12px] leading-snug text-amber-400">
                        <HelpCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                        <div>
                          Nothing cleared the grounding bar — spoke the predefined fallback instead of guessing.
                          {focusedLiveState.retrieval.fallbackText && (
                            <div className="mt-1.5 text-[11px] italic text-[var(--console-text-dim)]">
                              "{focusedLiveState.retrieval.fallbackText}"
                            </div>
                          )}
                        </div>
                      </div>
                    ) : focusedLiveState.retrieval.topSource ? (
                      <div className="flex items-start gap-2 text-[12px] leading-snug text-[var(--console-text)]">
                        <Database className="mt-0.5 h-3.5 w-3.5 flex-none text-[var(--console-cyan)]" />
                        <div>
                          Pulled from <span className="font-semibold text-[var(--console-cyan)]">{focusedLiveState.retrieval.topSource}</span>
                          {focusedLiveState.retrieval.similarity !== undefined && (
                            <span className="text-[var(--console-text-dim)]"> · {(focusedLiveState.retrieval.similarity * 100).toFixed(0)}% match</span>
                          )}
                          {focusedLiveState.retrieval.reason && (
                            <div className="mt-1 text-[11px] text-[var(--console-text-dim)]">{focusedLiveState.retrieval.reason}</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11.5px] italic text-[var(--console-text-dim)]">No knowledge lookup needed for this turn.</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
