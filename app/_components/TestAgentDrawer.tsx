"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Radio, X, Phone, PhoneOff, Sparkles, ChevronDown, Database, ListTree, AlertTriangle, CheckCircle2, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { getMicSupport, describeMicError } from "./micUtils";
import { useVoiceActivityDetection } from "./useVoiceActivityDetection";
import {
  EngineDiagnosticPanel,
  EmotionTimeline,
  type DiagnosticEmotionResult,
  type EmotionHistoryPoint,
} from "./EngineDashboard";

const TARGET_SAMPLE_RATE = 16000;
// ~100ms per WS frame at 16kHz — batches the AudioWorklet's 128-sample
// (2.7ms) render quanta into chunks actually useful for streaming STT.
const SEND_CHUNK_SAMPLES = 1600;
const WS_BASE_URL = process.env.NEXT_PUBLIC_REALTIME_WS_URL || "ws://localhost:3001";

type CallStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

interface Agent {
  id: string;
  name: string;
  description: string | null;
}

interface TurnPolicy {
  acknowledgeFirst: boolean;
  pace: string;
  allowUpsell: boolean;
  escalate: string;
  notes: string[];
}

interface MemorySnippet {
  id: string;
  summary: string;
  topic: string;
  emotion: string;
  importance: number;
  ts: number;
}

interface TurnMemory {
  write?: { tier: string; recordId?: string; merged?: boolean };
  retrieved?: {
    mtmIds: string[];
    ltmUserIds: string[];
    ltmClientIds: string[];
    mtmSnippets?: MemorySnippet[];
    ltmUserSnippets?: MemorySnippet[];
    ltmClientSnippets?: MemorySnippet[];
  };
}

interface TurnTimings {
  sttMs?: number;
  emotionMs: number;
  retrievalMs: number;
  llmMs: number;
  ttsMs?: number;
  totalMs: number;
}

interface TranscriptTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  emotion?: string;
  diagnostics?: DiagnosticEmotionResult;
  cai?: { score: number; category: string };
  policy?: TurnPolicy;
  memory?: TurnMemory;
  timings?: TurnTimings;
  /** Which custom agent actually resolved server-side for this reply —
   * undefined when no agentId was requested, or a custom agent lookup
   * failed and it silently fell back to the demo agent. */
  resolvedAgent?: { id: string; name: string };
  llmModel?: string;
  usedLiveLlm?: boolean;
}

function downsampleTo16kMono(input: Float32Array, inputSampleRate: number): Int16Array {
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = Math.floor(i * ratio);
    const sample = Math.max(-1, Math.min(1, input[srcIndex] ?? 0));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}

/** RMS amplitude (0–1) of an analyser's current time-domain buffer. */
function readLevel(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buf);
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) {
    const centered = (buf[i] - 128) / 128;
    sumSq += centered * centered;
  }
  return Math.min(1, Math.sqrt(sumSq / buf.length) * 4); // *4 — RMS of speech is quiet relative to full-scale
}

/** Makes two easy-to-misdiagnose failure modes visible instead of silent:
 * (1) a custom agent was selected for testing but the server-side lookup
 * didn't find it, so the turn silently fell back to the demo agent's
 * prompt — previously indistinguishable from the custom agent actually
 * being used; (2) every LLM provider failed and the reply is the generic,
 * agent-agnostic offline-fallback string, which looks identical to a
 * real "the agent isn't using my prompt" bug unless it's labeled as such. */
function AgentStatusBanner({
  turn,
  requestedAgentName,
}: {
  turn: TranscriptTurn;
  requestedAgentName: string | null;
}) {
  const rows: { tone: "ok" | "warn"; text: string }[] = [];

  if (requestedAgentName !== null) {
    if (turn.resolvedAgent) {
      rows.push({ tone: "ok", text: `Agent: ${turn.resolvedAgent.name}` });
    } else {
      rows.push({
        tone: "warn",
        text: `"${requestedAgentName}" wasn't found server-side — this reply used the demo agent's prompt instead.`,
      });
    }
  }

  if (turn.usedLiveLlm === false) {
    rows.push({
      tone: "warn",
      text: "No LLM provider responded (ZenMux/Groq/OpenAI all failed or are unset) — this is a generic canned reply, not generated from any agent's prompt.",
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div
          key={i}
          className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10.5px] leading-snug ${
            r.tone === "ok"
              ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-400"
              : "border-amber-500/30 bg-amber-500/[0.06] text-amber-400"
          }`}
        >
          {r.tone === "ok" ? (
            <CheckCircle2 className="w-3 h-3 mt-0.5 flex-none" />
          ) : (
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-none" />
          )}
          <span>{r.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Real per-stage wall-clock timing for one reply, as a proportional bar —
 * the "Live Engine Console" pipeline visual's stages made concrete instead
 * of decorative. sttMs approximates listening duration from audio length
 * (true STT compute time isn't cleanly measurable mid-stream), the rest are
 * exact measurements from the orchestrator and TTS call. */
function PipelineLatencyBar({ timings }: { timings: TurnTimings }) {
  const segments = [
    { key: "stt", label: "Listen", ms: timings.sttMs ?? 0, color: "bg-sky-400" },
    { key: "emotion", label: "Analyze", ms: timings.emotionMs, color: "bg-violet-400" },
    { key: "retrieval", label: "Memory", ms: timings.retrievalMs, color: "bg-fuchsia-400" },
    { key: "llm", label: "LLM", ms: timings.llmMs, color: "bg-amber-400" },
    { key: "tts", label: "Voice", ms: timings.ttsMs ?? 0, color: "bg-cyan-400" },
  ].filter((s) => s.ms > 0);
  const total = segments.reduce((s, seg) => s + seg.ms, 0) || 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2 rounded-full overflow-hidden bg-[var(--console-surface)]">
        {segments.map((s) => (
          <div key={s.key} className={s.color} style={{ width: `${(s.ms / total) * 100}%` }} title={`${s.label}: ${s.ms}ms`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9.5px] font-mono text-[var(--console-text-dim)]">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${s.color}`} /> {s.label} {s.ms}ms
          </span>
        ))}
        <span className="ml-auto text-[var(--console-text)] font-semibold">total {timings.totalMs}ms</span>
      </div>
    </div>
  );
}

/** Actual retrieved memory content grouped by tier — the evidence a judge
 * (or the LLM's own [MEM_ID] citations) can point at, not just a count. */
function MemoryRetrievalDetail({ retrieved }: { retrieved: NonNullable<TurnMemory["retrieved"]> }) {
  const groups: { key: string; label: string; ids: string[]; snippets?: MemorySnippet[] }[] = [
    { key: "mtm", label: "Recent (MTM)", ids: retrieved.mtmIds, snippets: retrieved.mtmSnippets },
    { key: "ltmUser", label: "Long-term (user)", ids: retrieved.ltmUserIds, snippets: retrieved.ltmUserSnippets },
    { key: "ltmClient", label: "Client knowledge", ids: retrieved.ltmClientIds, snippets: retrieved.ltmClientSnippets },
  ];
  const total = groups.reduce((s, g) => s + g.ids.length, 0);
  if (total === 0) {
    return (
      <div className="text-[var(--console-text-dim)] mt-0.5">
        No memories retrieved for this reply — nothing in this session or long-term store matched yet.
      </div>
    );
  }
  return (
    <div className="mt-1 flex flex-col gap-2">
      {groups.map(
        (g) =>
          g.ids.length > 0 && (
            <div key={g.key}>
              <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--console-text-dim)]">
                {g.label} ({g.ids.length})
              </div>
              {g.snippets && g.snippets.length > 0 ? (
                <ul className="mt-0.5 flex flex-col gap-1">
                  {g.snippets.slice(0, 3).map((s) => (
                    <li
                      key={s.id}
                      className="text-[var(--console-text)] text-[10.5px] leading-snug rounded-lg bg-[var(--console-surface-raised)] border border-[var(--console-border)] px-2 py-1.5"
                    >
                      <span className="font-mono text-[9px] text-[var(--console-text-dim)] uppercase mr-1">[{s.topic}]</span>
                      {s.summary}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[10px] text-[var(--console-text-dim)] italic">snippet text unavailable</div>
              )}
            </div>
          )
      )}
    </div>
  );
}

/** Session-level rollup computed from turns already stored client-side —
 * turns "I had a conversation" into a measurable outcome: CAI trend,
 * how much escalation was needed, how memory grew. Updates live as the
 * call progresses, not just once it ends. */
function SessionScorecard({ turns }: { turns: TranscriptTurn[] }) {
  const assistantTurns = turns.filter((t) => t.role === "assistant");
  if (assistantTurns.length === 0) return null;

  const caiScores = assistantTurns.filter((t) => t.cai).map((t) => t.cai!.score);
  const caiFirst = caiScores[0];
  const caiLast = caiScores[caiScores.length - 1];
  const caiAvg = caiScores.length > 0 ? Math.round(caiScores.reduce((a, b) => a + b, 0) / caiScores.length) : null;
  const caiDelta = caiScores.length > 1 ? caiLast - caiFirst : 0;

  const escalatedTurns = assistantTurns.filter((t) => t.policy && t.policy.escalate !== "none");
  const highestEscalation = escalatedTurns.some((t) => t.policy?.escalate === "human")
    ? "human"
    : escalatedTurns.length > 0
      ? "tier2"
      : "none";

  const memoryWrites = assistantTurns.filter((t) => t.memory?.write?.recordId);
  const emotionCounts = new Map<string, number>();
  for (const t of assistantTurns) {
    if (!t.emotion) continue;
    emotionCounts.set(t.emotion, (emotionCounts.get(t.emotion) ?? 0) + 1);
  }
  const dominantEmotion = [...emotionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const durationMs = turns.length > 1 ? turns[turns.length - 1].ts - turns[0].ts : 0;
  const durationLabel = durationMs > 0 ? `${Math.round(durationMs / 1000)}s` : "—";

  return (
    <div className="rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] p-3 grid grid-cols-2 gap-x-3 gap-y-2.5 text-[11px]">
      <ScorecardStat label="Turns" value={String(assistantTurns.length)} sub={durationLabel} />
      <ScorecardStat
        label="Avg CAI"
        value={caiAvg !== null ? String(caiAvg) : "—"}
        sub={caiDelta !== 0 ? (caiDelta > 0 ? `↑ +${caiDelta}` : `↓ ${caiDelta}`) : undefined}
        subColor={caiDelta > 0 ? "text-emerald-400" : caiDelta < 0 ? "text-red-400" : undefined}
      />
      <ScorecardStat
        label="Escalations"
        value={String(escalatedTurns.length)}
        sub={highestEscalation !== "none" ? `peak: ${highestEscalation}` : undefined}
        subColor={highestEscalation === "human" ? "text-red-400" : highestEscalation === "tier2" ? "text-amber-400" : undefined}
      />
      <ScorecardStat label="Memories written" value={String(memoryWrites.length)} />
      {dominantEmotion && (
        <div className="col-span-2 flex items-center gap-1.5 text-[10.5px] text-[var(--console-text-dim)] pt-0.5 border-t border-[var(--console-border)] mt-0.5">
          Dominant emotion this session:{" "}
          <span className="font-semibold text-[var(--console-text)] capitalize">{dominantEmotion}</span>
        </div>
      )}
    </div>
  );
}

function ScorecardStat({
  label,
  value,
  sub,
  subColor,
}: {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--console-text-dim)]">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[16px] font-bold text-[var(--console-text)] leading-tight">{value}</span>
        {sub && <span className={`text-[9.5px] font-mono ${subColor ?? "text-[var(--console-text-dim)]"}`}>{sub}</span>}
      </span>
    </div>
  );
}

export function TestAgentDrawer() {
  const [open, setOpen] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [interim, setInterim] = useState("");
  const [emotionHistory, setEmotionHistory] = useState<EmotionHistoryPoint[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(""); // "" = demo agent
  const [activeAgentName, setActiveAgentName] = useState<string | null>(null);
  const [showReasoning, setShowReasoning] = useState(true);
  /** Manual acoustic-engine calibration knob (-1..1, default 0) — see
   * lib/emotion/audio-emotion.ts's detectAudioEmotion() opts doc. */
  const [sensitivityBias, setSensitivityBiasState] = useState(0);
  // Which turn the analytics column is showing. Auto-advances to each new
  // reply as it arrives (the original "always show what just happened"
  // behavior); clicking an older bubble in the transcript pins it here so
  // it can be inspected, until the next new reply auto-advances again.
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  // Self-mute (mic) and speaker-mute (agent audio) toggles for testing —
  // independent of each other and of call state, so either can be flipped
  // mid-call.
  const [micMuted, setMicMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const playbackSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const statusRef = useRef<CallStatus>("idle");
  const active = useRef(false);
  const vad = useVoiceActivityDetection();
  // AudioWorkletNode.process() fires once per 128-sample render quantum —
  // sending a WS frame per call (~2.7ms of audio, ~375 msg/s) is far too
  // fragmented for Deepgram. Buffer on the main thread and flush in
  // larger batches instead, same chunking pattern AcousticDemo.tsx uses.
  const captureBufferRef = useRef<Int16Array[]>([]);
  const captureBufferedSamplesRef = useRef(0);

  useEffect(() => {
    setMicSupported(getMicSupport());
  }, []);

  // Fetch the list of real Agent Builder agents once the drawer is first
  // opened, so "test my own agent" doesn't require reloading the page.
  // Fails silently to an empty list (falls back to the demo agent) — most
  // commonly because Supabase isn't reachable in this environment, which
  // /api/agents already degrades gracefully for.
  useEffect(() => {
    if (!open || agents.length > 0) return;
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data: { agents: Agent[] }) => setAgents(data.agents ?? []))
      .catch(() => {});
  }, [open, agents.length]);

  // Deep-link support: /demo?agentId=<id> (used by the "Test this agent"
  // button in /admin/agents) pre-selects that agent and opens the drawer
  // automatically, once its info has loaded.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const agentId = params.get("agentId");
    if (agentId) {
      setSelectedAgentId(agentId);
      setOpen(true);
    }
  }, []);

  // Lets other pages (e.g. the /demo mode switcher's "Live Call" CTA) open
  // this single site-wide drawer instance without prop-drilling or context.
  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener("voxera:open-test-drawer", openHandler);
    return () => window.removeEventListener("voxera:open-test-drawer", openHandler);
  }, []);

  useEffect(() => {
    statusRef.current = status;
    if (orbRef.current) {
      orbRef.current.style.setProperty("--hue", status === "speaking" ? "var(--console-cyan)" : "var(--console-violet)");
    }
  }, [status]);

  // One persistent AudioContext + MediaElementSourceNode for the reply
  // player — a source node can only be created once per <audio> element.
  useEffect(() => {
    if (!playerRef.current || playbackAudioContextRef.current) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const source = ctx.createMediaElementSource(playerRef.current);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    playbackAudioContextRef.current = ctx;
    playbackSourceRef.current = source;
    playbackAnalyserRef.current = analyser;
  }, [open]);

  // Toggling mid-call disables/re-enables the live mic track directly —
  // a disabled MediaStreamTrack outputs silence to every consumer (the
  // capture worklet that streams audio to Deepgram, the level meter, VAD)
  // without needing to touch any of that plumbing individually.
  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !micMuted; });
  }, [micMuted]);

  // HTMLMediaElement.muted silences output immediately, including audio
  // already mid-playback, and persists across future `audio.src` swaps on
  // the same element (the reply_audio handler above only sets .src, not
  // .muted, so this doesn't need to re-run per reply).
  useEffect(() => {
    if (playerRef.current) playerRef.current.muted = speakerMuted;
  }, [speakerMuted]);

  const stopLevelLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    orbRef.current?.style.setProperty("--level", "0");
  }, []);

  const startLevelLoop = useCallback(() => {
    const micBuf = new Uint8Array(256);
    const playbackBuf = new Uint8Array(256);
    const tick = () => {
      const analyser = statusRef.current === "speaking" ? playbackAnalyserRef.current : micAnalyserRef.current;
      const buf = statusRef.current === "speaking" ? playbackBuf : micBuf;
      const level = analyser ? readLevel(analyser, buf) : 0;
      orbRef.current?.style.setProperty("--level", level.toFixed(3));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const endCall = useCallback(() => {
    active.current = false;
    stopLevelLoop();
    vad.destroy();
    captureNodeRef.current?.port.close();
    captureNodeRef.current?.disconnect();
    micSourceRef.current?.disconnect();
    micAnalyserRef.current?.disconnect();
    micAudioContextRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    wsRef.current?.close();
    captureNodeRef.current = null;
    micSourceRef.current = null;
    micAnalyserRef.current = null;
    micAudioContextRef.current = null;
    streamRef.current = null;
    wsRef.current = null;
    captureBufferRef.current = [];
    captureBufferedSamplesRef.current = 0;
    setStatus("idle");
    setInterim("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopLevelLoop]);

  useEffect(() => () => endCall(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const bargeIn = useCallback(() => {
    if (statusRef.current !== "speaking") return;
    const audio = playerRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    wsRef.current?.send(JSON.stringify({ type: "barge_in" }));
    setStatus("listening");
  }, []);

  const setSensitivityBias = useCallback((value: number) => {
    setSensitivityBiasState(value);
    wsRef.current?.send(JSON.stringify({ type: "set_sensitivity_bias", value }));
  }, []);

  const startCall = useCallback(async () => {
    setError(null);
    if (!getMicSupport()) {
      setMicSupported(false);
      setError("Microphone requires HTTPS (or localhost) and a browser that supports getUserMedia.");
      return;
    }

    setStatus("connecting");
    setTurns([]);
    setEmotionHistory([]);
    setSelectedTurnId(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Respect a mute toggled before the call started — disabling the
      // track makes it output silence to every consumer (worklet, level
      // meter, VAD) with no extra plumbing needed elsewhere.
      stream.getAudioTracks().forEach((t) => { t.enabled = !micMuted; });

      const selectedAgent = agents.find((a) => a.id === selectedAgentId);
      const effectiveAgentId = selectedAgent?.id ?? (selectedAgentId || undefined);
      const wsUrl = effectiveAgentId
        ? `${WS_BASE_URL}?agentId=${encodeURIComponent(effectiveAgentId)}`
        : WS_BASE_URL;
      setActiveAgentName(selectedAgent?.name ?? null);

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        active.current = true;
        if (sensitivityBias !== 0) {
          ws.send(JSON.stringify({ type: "set_sensitivity_bias", value: sensitivityBias }));
        }
      };

      ws.onerror = () => {
        setError(`Couldn't reach the realtime voice server at ${WS_BASE_URL}. Make sure it's running: npm run server`);
        setStatus("error");
        endCall();
      };

      ws.onclose = () => {
        if (active.current) {
          setError("Realtime connection closed unexpectedly.");
          setStatus("error");
        }
        active.current = false;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "system":
              setStatus("listening");
              break;
            case "transcript_interim":
              setInterim(msg.text);
              break;
            case "transcript_final":
              setInterim("");
              setTurns((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: msg.text, ts: Date.now() }]);
              break;
            case "turn_start":
              setStatus("thinking");
              break;
            case "reply_text": {
              const emotion = msg.trace?.emotion?.current;
              const diagnostics: DiagnosticEmotionResult | undefined = msg.trace?.emotionDiagnostics;
              const turnId: string = msg.turnId ?? `a-${Date.now()}`;
              setTurns((prev) => [
                ...prev,
                {
                  id: turnId,
                  role: "assistant",
                  text: msg.text,
                  ts: Date.now(),
                  emotion: emotion?.label,
                  diagnostics,
                  cai: msg.trace?.cai ? { score: msg.trace.cai.score, category: msg.trace.cai.category } : undefined,
                  policy: msg.trace?.policy,
                  memory: { write: msg.trace?.memoryWrite, retrieved: msg.trace?.retrieved },
                  timings: msg.trace?.timings,
                  resolvedAgent: msg.trace?.agent,
                  llmModel: msg.trace?.llmModel,
                  usedLiveLlm: msg.trace?.usedLiveLlm,
                },
              ]);
              setSelectedTurnId(turnId);
              if (emotion) {
                setEmotionHistory((h) => [...h.slice(-59), { ts: Date.now(), label: emotion.label, intensity: emotion.intensity }]);
              }
              break;
            }
            case "reply_audio": {
              setStatus("speaking");
              // Synthesis finishes after reply_text already landed — merge its
              // ttsMs into the matching turn (by server-assigned turnId)
              // instead of waiting to send timings all at once, so the text
              // and analytics still appear the instant they're ready.
              if (msg.turnId && typeof msg.ttsMs === "number") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === msg.turnId && t.timings ? { ...t, timings: { ...t.timings, ttsMs: msg.ttsMs } } : t
                  )
                );
              }
              const audio = playerRef.current;
              if (audio) {
                audio.src = `data:${msg.mime};base64,${msg.audio}`;
                audio.onended = () => {
                  if (active.current) setStatus("listening");
                };
                playbackAudioContextRef.current?.resume().catch(() => {});
                void audio.play().catch(() => {
                  if (active.current) setStatus("listening");
                });
              }
              break;
            }
            case "turn_end":
              break;
            case "error":
              setError(msg.message);
              break;
          }
        } catch {
          // ignore malformed frames
        }
      };

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioCtx();
      micAudioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      micSourceRef.current = source;

      const micAnalyser = audioContext.createAnalyser();
      micAnalyser.fftSize = 256;
      source.connect(micAnalyser);
      micAnalyserRef.current = micAnalyser;

      // AudioWorkletNode, not the deprecated ScriptProcessorNode — this
      // context is shared with VAD below, and mixing the legacy
      // ScriptProcessor and modern AudioWorklet subsystems on one context
      // is what caused "Failed to construct AudioWorkletNode: No execution
      // context available" previously. One consistent capture path avoids
      // it, and also avoids the separate failure mode of two independent
      // AudioContexts each opening their own MediaStreamAudioSourceNode on
      // the same mic stream (unreliable across browsers — one can end up
      // silently receiving silence instead of live audio).
      await audioContext.audioWorklet.addModule("/audio-worklets/pcm-capture-processor.js");
      const captureNode = new AudioWorkletNode(audioContext, "pcm-capture-processor");
      captureNodeRef.current = captureNode;
      captureBufferRef.current = [];
      captureBufferedSamplesRef.current = 0;
      captureNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!active.current || ws.readyState !== WebSocket.OPEN) return;
        const downsampled = downsampleTo16kMono(event.data, audioContext.sampleRate);
        captureBufferRef.current.push(downsampled);
        captureBufferedSamplesRef.current += downsampled.length;
        if (captureBufferedSamplesRef.current < SEND_CHUNK_SAMPLES) return;

        const chunks = captureBufferRef.current;
        captureBufferRef.current = [];
        captureBufferedSamplesRef.current = 0;
        const merged = new Int16Array(chunks.reduce((sum, c) => sum + c.length, 0));
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.length;
        }
        ws.send(merged.buffer);
      };
      source.connect(captureNode);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      captureNode.connect(silentGain);
      silentGain.connect(audioContext.destination);

      startLevelLoop();

      await vad.start(
        { onSpeechStart: bargeIn },
        { stream, audioContext }
      );
    } catch (e) {
      setError(describeMicError(e));
      setStatus("error");
      endCall();
    }
  }, [endCall, startLevelLoop, vad, bargeIn, agents, selectedAgentId, sensitivityBias, micMuted]);

  const isLive = status !== "idle" && status !== "error";

  const assistantTurnsWithDiagnostics = useMemo(
    () => turns.filter((t) => t.role === "assistant" && t.diagnostics),
    [turns]
  );
  const latestAssistantTurn = assistantTurnsWithDiagnostics[assistantTurnsWithDiagnostics.length - 1];
  // The analytics panel shows whichever turn is selected — by default the
  // latest one (auto-advances as replies arrive), or an older turn the user
  // clicked in the transcript to scrub back and inspect its reasoning.
  const selectedTurn = useMemo(
    () => assistantTurnsWithDiagnostics.find((t) => t.id === selectedTurnId) ?? latestAssistantTurn,
    [assistantTurnsWithDiagnostics, selectedTurnId, latestAssistantTurn]
  );
  const isViewingLatest = !selectedTurn || selectedTurn.id === latestAssistantTurn?.id;

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close agent test panel" : "Talk to the agent"}
        className="fixed bottom-6 right-6 z-[110] flex items-center gap-2.5 pl-4 pr-5 py-3.5 rounded-full bg-[var(--console-bg)] border border-[var(--console-border-active)] text-[var(--console-text)] shadow-[0_10px_40px_-8px_rgba(139,92,246,0.55)] hover:shadow-[0_14px_50px_-8px_rgba(139,92,246,0.7)] transition-shadow"
      >
        {open ? <X className="w-4 h-4" /> : <Radio className="w-4 h-4 text-[var(--console-violet)]" />}
        <span className="text-[13px] font-semibold">{open ? "Close" : "Talk to the agent"}</span>
        {!open && <span className="w-1.5 h-1.5 rounded-full bg-[var(--console-cyan)] animate-pulse" />}
      </button>

      <div
        className={`fixed inset-y-0 right-0 z-[105] w-full sm:w-[820px] xl:w-[960px] max-w-full voxera-console border-l border-[var(--console-border)] shadow-[-20px_0_60px_-15px_rgba(10,12,20,0.6)] transition-transform duration-300 ease-out flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Pinned top bar — orb, status, call control. Compact and horizontal
            so it never eats into the conversation/analytics split below. */}
        <div className="flex-none border-b border-[var(--console-border)] px-5 py-3.5 flex items-center gap-4">
          <div ref={orbRef} className="voxera-orb !w-14 !h-14 flex-none">
            <div className="voxera-orb-core !w-8 !h-8">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="min-w-0">
            <div className="text-[12px] font-bold text-[var(--console-text)] leading-tight">Live Test Call</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--console-text-dim)]">
              {status === "idle" && "Ready"}
              {status === "connecting" && "Connecting…"}
              {status === "listening" && "Listening"}
              {status === "thinking" && "Thinking…"}
              {status === "speaking" && "Speaking"}
              {status === "error" && "Error"}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setMicMuted((m) => !m)}
              title={micMuted ? "Unmute your microphone" : "Mute your microphone"}
              aria-pressed={micMuted}
              className={`flex-none flex items-center justify-center w-9 h-9 rounded-xl border transition-all ${
                micMuted
                  ? "bg-red-500/15 border-red-500/40 text-red-400"
                  : "bg-[var(--console-surface-raised)] border-[var(--console-border)] text-[var(--console-text-dim)] hover:text-[var(--console-text)]"
              }`}
            >
              {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setSpeakerMuted((m) => !m)}
              title={speakerMuted ? "Unmute the agent's voice" : "Mute the agent's voice"}
              aria-pressed={speakerMuted}
              className={`flex-none flex items-center justify-center w-9 h-9 rounded-xl border transition-all ${
                speakerMuted
                  ? "bg-red-500/15 border-red-500/40 text-red-400"
                  : "bg-[var(--console-surface-raised)] border-[var(--console-border)] text-[var(--console-text-dim)] hover:text-[var(--console-text)]"
              }`}
            >
              {speakerMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              onClick={isLive ? endCall : startCall}
              disabled={!micSupported && !isLive}
              title={!micSupported ? "Microphone requires HTTPS (or localhost) and a supported browser" : undefined}
              className={`flex-none flex items-center gap-2 px-5 py-2 rounded-xl text-[13px] font-semibold transition-all ${
                isLive
                  ? "bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)] hover:bg-red-600"
                  : "bg-[var(--console-violet)] text-[#0A0C14] hover:brightness-110"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {isLive ? <PhoneOff className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
              {isLive ? "End Call" : "Start Call"}
            </button>
          </div>
        </div>

        {/* Agent selector — pick which custom Agent Builder agent's actual
            prompt, persona, and knowledge base to test against, instead of
            always the hardcoded demo agent. Locked once a call starts. */}
        <div className="flex-none border-b border-[var(--console-border)] px-5 py-2 flex items-center gap-2 text-[11px]">
          <span className="font-mono uppercase tracking-widest text-[var(--console-text-dim)] flex-none">Testing:</span>
          {isLive ? (
            <span className="font-semibold text-[var(--console-text)]">{activeAgentName ?? "Demo agent"}</span>
          ) : (
            <div className="relative flex-1 min-w-0 max-w-[280px]">
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="w-full appearance-none bg-[var(--console-surface-raised)] border border-[var(--console-border)] rounded-lg px-2.5 py-1 pr-6 text-[11px] font-semibold text-[var(--console-text)] focus:outline-none focus:border-[var(--console-border-active)]"
              >
                <option value="">Demo agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id} className="bg-[var(--console-surface)] text-[var(--console-text)]">
                    {a.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--console-text-dim)]" />
            </div>
          )}
          {agents.length === 0 && (
            <span className="text-[var(--console-text-dim)]">(no custom agents found — testing the demo agent)</span>
          )}
        </div>

        {/* Split body: analytics update on the left the instant new data
            arrives, conversation keeps flowing independently on the right —
            neither one waits on or pushes around the other. */}
        <div className="flex-1 flex flex-col sm:flex-row min-h-0">
          {/* LEFT — live analytics for whichever turn is selected */}
          <div className="sm:w-[360px] flex-none min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4 border-b sm:border-b-0 sm:border-r border-[var(--console-border)]">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="voxera-console-label text-[10px] font-bold">
                  {isViewingLatest ? "Live Analytics" : "Reasoning Trace"}{" "}
                  {status === "thinking" && isViewingLatest && (
                    <span className="text-[var(--console-cyan)] normal-case">· updating…</span>
                  )}
                </div>
                {!isViewingLatest && (
                  <button
                    onClick={() => setSelectedTurnId(latestAssistantTurn?.id ?? null)}
                    className="text-[9.5px] font-mono uppercase tracking-wide text-[var(--console-violet)] hover:brightness-125 px-2 py-0.5 rounded-full border border-[var(--console-violet)]/30 bg-[var(--console-violet)]/10 flex-none"
                  >
                    ↳ Jump to latest
                  </button>
                )}
              </div>
              {selectedTurn && (activeAgentName !== null || selectedTurn.usedLiveLlm === false) && (
                <AgentStatusBanner turn={selectedTurn} requestedAgentName={activeAgentName} />
              )}
              {selectedTurn?.diagnostics ? (
                <>
                  <EngineDiagnosticPanel diagnostics={selectedTurn.diagnostics} compact />
                  {selectedTurn.cai && (
                    <div className="mt-2 text-[10px] font-mono text-[var(--console-text-dim)]">
                      CAI {selectedTurn.cai.score}/100 · {selectedTurn.cai.category}
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--console-border)] p-4 text-center text-[11.5px] text-[var(--console-text-dim)]">
                  Engine breakdown for each reply appears here the instant it's ready.
                </div>
              )}
            </div>

            {selectedTurn?.timings && (
              <div>
                <div className="voxera-console-label text-[9px] mb-1.5">Pipeline Latency — this reply</div>
                <PipelineLatencyBar timings={selectedTurn.timings} />
              </div>
            )}

            {(selectedTurn?.policy || selectedTurn?.memory) && (
              <div>
                <button
                  onClick={() => setShowReasoning((s) => !s)}
                  className="w-full flex items-center justify-between voxera-console-label text-[9px] mb-1.5"
                >
                  <span className="flex items-center gap-1.5">
                    <ListTree className="w-3 h-3" /> Source of Truth — why this reply
                  </span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showReasoning ? "rotate-180" : ""}`} />
                </button>
                {showReasoning && (
                  <div className="rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] p-3 flex flex-col gap-3 text-[11px]">
                    {selectedTurn.policy && (
                      <div>
                        <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--console-text-dim)] mb-1">Policy applied</div>
                        <div className="text-[var(--console-text)]">
                          Pace: <span className="font-semibold capitalize">{selectedTurn.policy.pace}</span>
                          {selectedTurn.policy.acknowledgeFirst && " · acknowledge-first"}
                          {!selectedTurn.policy.allowUpsell && " · no upsell"}
                          {selectedTurn.policy.escalate !== "none" && (
                            <span className="text-amber-400"> · escalate: {selectedTurn.policy.escalate}</span>
                          )}
                        </div>
                        {selectedTurn.policy.notes.length > 0 && (
                          <ul className="mt-1 list-disc list-inside text-[var(--console-text-dim)]">
                            {selectedTurn.policy.notes.map((n, i) => <li key={i}>{n}</li>)}
                          </ul>
                        )}
                      </div>
                    )}
                    {selectedTurn.memory && (
                      <div>
                        <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--console-text-dim)] mb-1 flex items-center gap-1.5">
                          <Database className="w-3 h-3" /> Memory
                        </div>
                        {selectedTurn.memory.write && (
                          <div className="text-[var(--console-text)]">
                            Wrote to <span className="font-semibold">{selectedTurn.memory.write.tier}</span>
                            {selectedTurn.memory.write.merged && " (merged with existing memory)"}
                          </div>
                        )}
                        {selectedTurn.memory.retrieved && (
                          <MemoryRetrievalDetail retrieved={selectedTurn.memory.retrieved} />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="voxera-console-label text-[9px] mb-1.5">Session Trajectory</div>
              <EmotionTimeline history={emotionHistory} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div
                  className="voxera-console-label text-[9px]"
                  title="Acoustic-heuristic engines tend to over-read ambiguous/quiet audio as negative. This nudges the Acoustic engine's label scoring toward positive or negative labels before it picks a winner — it does not affect the Lexicon or Local ONNX text engines."
                >
                  Acoustic Sensitivity Calibration
                </div>
                <span className="text-[10.5px] font-mono text-[var(--console-cyan)]">
                  {sensitivityBias === 0 ? "Off" : sensitivityBias > 0 ? `+${sensitivityBias.toFixed(1)} positive` : `${sensitivityBias.toFixed(1)} negative`}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-[9px] font-mono uppercase tracking-wide text-[var(--console-text-dim)] flex-none">− Neg</span>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.1}
                  value={sensitivityBias}
                  onChange={(e) => setSensitivityBias(parseFloat(e.target.value))}
                  className="w-full accent-[var(--console-cyan)] cursor-pointer"
                  aria-label="Acoustic sensitivity calibration"
                />
                <span className="text-[9px] font-mono uppercase tracking-wide text-[var(--console-text-dim)] flex-none">Pos +</span>
              </div>
            </div>

            {turns.length > 0 && (
              <div>
                <div className="voxera-console-label text-[9px] mb-1.5">Session Summary</div>
                <SessionScorecard turns={turns} />
              </div>
            )}
          </div>

          {/* RIGHT — continuous conversation */}
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-3">
            {turns.length === 0 && !interim ? (
              <div className="flex flex-col items-center justify-center text-center gap-2 py-10 flex-1">
                <Radio className="w-6 h-6 text-[var(--console-text-dim)]" />
                <p className="text-[12.5px] text-[var(--console-text-dim)] max-w-[280px]">
                  Start a call and speak — talk over the agent any time to interrupt it, just like a
                  real conversation. Live analytics for every turn appear on the left.
                </p>
              </div>
            ) : (
              <>
                {turns.map((t) => {
                  const inspectable = t.role === "assistant" && !!t.diagnostics;
                  const isSelected = inspectable && selectedTurn?.id === t.id && !isViewingLatest;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={inspectable ? () => setSelectedTurnId(t.id) : undefined}
                      className={`max-w-[85%] text-left rounded-2xl px-4 py-2.5 text-[13px] leading-snug flex flex-col gap-1 transition-colors ${
                        t.role === "user"
                          ? "self-end bg-[var(--console-violet)]/20 text-[var(--console-text)] cursor-default"
                          : `self-start bg-[var(--console-surface-raised)] border text-[var(--console-text)] ${
                              isSelected
                                ? "border-[var(--console-violet)]/60 shadow-[0_0_0_1px_rgba(167,139,250,0.3)]"
                                : "border-[var(--console-border)]"
                            } ${inspectable ? "cursor-pointer hover:border-[var(--console-violet)]/40" : "cursor-default"}`
                      }`}
                    >
                      {t.text}
                      {t.role === "assistant" && t.emotion && (
                        <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--console-text-dim)] flex items-center gap-1">
                          responded to: {t.emotion}
                          {inspectable && <span className="normal-case">· click to inspect reasoning</span>}
                        </span>
                      )}
                    </button>
                  );
                })}
                {interim && (
                  <div className="self-end max-w-[85%] rounded-2xl px-4 py-2.5 text-[13px] leading-snug italic text-[var(--console-text-dim)] bg-[var(--console-violet)]/[0.08] border border-dashed border-[var(--console-violet)]/30">
                    {interim}
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="rounded-xl bg-red-950/40 border border-red-900/60 text-[12.5px] text-red-300 px-4 py-3">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-md transition-opacity duration-300"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <audio ref={playerRef} className="hidden" crossOrigin="anonymous" />
    </>
  );
}
