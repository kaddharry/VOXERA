"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Send, Square, Activity, Loader2, Repeat, Gauge, PlayCircle, StopCircle } from "lucide-react";
import {
  PipelineTracker,
  EngineDiagnosticPanel,
  EmotionTimeline,
  type PipelineStage,
  type DiagnosticEmotionResult,
  type EmotionHistoryPoint,
} from "./EngineDashboard";
import { getMicSupport, describeMicError } from "./micUtils";

interface TurnTrace {
  utterance: {
    id: string;
    text: string;
    emotion?: {
      label: string;
      intensity: number;
      confidence: number;
      confidenceCategory?: string | { level: string; explanation?: string };
    };
  };
  emotion: {
    current: { label: string; intensity: number; confidence: number; vad: { v: number; a: number; d: number } };
    trajectory: { slope_v: number; slope_a: number };
    zDeviation: number;
    flags: Record<string, boolean>;
  };
  importance: number;
  memoryWrite: { tier: string; recordId?: string; merged?: boolean };
  retrieved: { mtmIds: string[]; ltmUserIds: string[]; ltmClientIds: string[]; scores: { id: string; score: number }[] };
  policy: { acknowledgeFirst: boolean; pace: string; allowUpsell: boolean; escalate: string; notes: string[] };
  guardReasons: string[];
  llmModel: string;
  usedLiveLlm: boolean;
  cai?: { score: number; category: string; explanation: string };
  emotionDiagnostics?: DiagnosticEmotionResult;
}

interface TurnEntry {
  user: string;
  reply: string;
  trace: TurnTrace;
}

interface VoiceAgentProps {
  sessionId?: string;
  clientId?: string;
  userId?: string;
  /** Show a row of curated ambiguous/difficult example inputs above the textarea (Text Demo mode only). */
  showExamples?: boolean;
}

const EXAMPLE_INPUTS = [
  "I'm feeling low",
  "I lost my pencil",
  "My pencil broke",
  "Great. Just great.",
  "I can't believe you did that",
  "I'm fine",
  "Whatever",
  "That's okay",
  "I don't care anymore",
];

const MAX_SILENT_RETRIES = 3;

/** One-click scripted conversations — lets a judge watch the emotion engine
 * adapt turn-by-turn without having to improvise good test inputs
 * themselves. Each line is sent as its own turn, paced with a delay so the
 * reply is readable before the next one fires. */
interface Scenario {
  key: string;
  label: string;
  description: string;
  turns: string[];
}

const SCENARIOS: Scenario[] = [
  {
    key: "angry-escalation",
    label: "Angry escalation",
    description: "Repeated frustration ramping into anger — watch policy trigger a hand-off.",
    turns: [
      "This is the third time I've called about this exact same issue.",
      "I'm honestly furious right now, nobody has fixed this yet.",
      "This is completely unacceptable. I want this escalated immediately.",
    ],
  },
  {
    key: "genuine-distress",
    label: "Genuine distress",
    description: "A caller in real distress — watch the persona slow down and prioritize safety.",
    turns: [
      "I don't really know what to do right now, I'm kind of panicking.",
      "This is an emergency, I'm really scared and can't think straight.",
      "Can you please just help me, I don't know who else to call.",
    ],
  },
  {
    key: "happy-upsell",
    label: "Happy news",
    description: "Positive, high-energy news — watch tone match energy without overdoing it.",
    turns: [
      "I just got some amazing news, I got the promotion!",
      "I'm so excited, I honestly wasn't expecting it at all.",
      "What else can you help me with today?",
    ],
  },
  {
    key: "confused-rambling",
    label: "Confused & rambling",
    description: "Unclear, meandering input — watch replies stay short and ask one thing at a time.",
    turns: [
      "Wait, sorry, what were we even talking about again?",
      "I don't really understand what's happening here, can you explain?",
      "Actually never mind, I'm not sure what I'm asking honestly.",
    ],
  },
];

export function VoiceAgent({ sessionId, clientId, userId, showExamples }: VoiceAgentProps = {}) {
  const [transcript, setTranscript] = useState("");
  const [history, setHistory] = useState<TurnEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  /** True only once the caller has actually done something (started
   * recording, or sent a typed turn) — the "Live call" banner used to key
   * off `sessionId` alone, which the page always passes in from the moment
   * it loads (a call_logs row is created on mount), so it showed "Live
   * call · End Call" immediately even though nothing had happened yet. */
  const [callStarted, setCallStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micSupported, setMicSupported] = useState(false);
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [diagnostics, setDiagnostics] = useState<DiagnosticEmotionResult | null>(null);
  const [emotionHistory, setEmotionHistory] = useState<EmotionHistoryPoint[]>([]);
  const [continuousMode, setContinuousMode] = useState(false);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [scenarioStep, setScenarioStep] = useState(0);
  /** Manual acoustic-engine calibration knob (-1..1, default 0) — see
   * lib/emotion/audio-emotion.ts's detectAudioEmotion() opts doc. Persists
   * across turns in this session so a judge/operator can dial it in once. */
  const [sensitivityBias, setSensitivityBias] = useState(0);
  const scenarioAbortRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const continuousModeRef = useRef(false);
  const silentRetriesRef = useRef(0);
  const startRecordingRef = useRef<() => void>(() => {});

  useEffect(() => {
    setMicSupported(getMicSupport());
  }, []);

  useEffect(() => {
    continuousModeRef.current = continuousMode;
  }, [continuousMode]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onplay = () => {
        setIsPlaying(true);
        setStage("speaking");
      };
      audioRef.current.onended = () => {
        setIsPlaying(false);
        setStage("idle");
        if (continuousModeRef.current) {
          setTimeout(() => startRecordingRef.current(), 500);
        }
      };
      audioRef.current.onpause = () => setIsPlaying(false);
    }
  }, []);

  const submitTurn = useCallback(
    async (text: string, sttConfidence?: number) => {
      if (!text.trim() || busy) return;
      setCallStarted(true);
      setBusy(true);
      setError(null);
      setStage("thinking");
      try {
        const res = await fetch("/api/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text, sttConfidence, sessionId, clientId, userId, diagnostics: true, sensitivityBias }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `turn failed (${res.status})`);
        }
        const data: { reply: string; trace: TurnTrace } = await res.json();
        setHistory((h) => [...h, { user: text, reply: data.reply, trace: data.trace }]);
        setTranscript("");
        if (data.trace.emotionDiagnostics) {
          setDiagnostics(data.trace.emotionDiagnostics);
        }
        setEmotionHistory((h) => [
          ...h.slice(-59),
          { ts: Date.now(), label: data.trace.emotion.current.label, intensity: data.trace.emotion.current.intensity },
        ]);

        setStage("synthesizing");
        const persona = localStorage.getItem("voxera_voice_persona") || "female-friendly";
        const tts = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: data.reply, policy: data.trace.policy, persona }),
        });
        if (tts.ok) {
          const blob = await tts.blob();
          const url = URL.createObjectURL(blob);
          if (audioRef.current) {
            audioRef.current.src = url;
            audioRef.current.play().catch(() => {});
          }
        } else {
          setStage("idle");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage("idle");
      } finally {
        setBusy(false);
      }
    },
    [busy, sessionId, clientId, userId, sensitivityBias],
  );

  const runScenario = useCallback(
    async (scenario: Scenario) => {
      if (busy || runningScenario) return;
      setRunningScenario(scenario.key);
      scenarioAbortRef.current = false;
      for (let i = 0; i < scenario.turns.length; i++) {
        if (scenarioAbortRef.current) break;
        setScenarioStep(i);
        await submitTurn(scenario.turns[i]);
        if (scenarioAbortRef.current) break;
        // Paced so the reply is actually readable/audible before the next
        // line fires — this is meant to be watched, not raced through.
        await new Promise((r) => setTimeout(r, 3500));
      }
      setRunningScenario(null);
    },
    [busy, runningScenario, submitTurn],
  );

  const stopScenario = useCallback(() => {
    scenarioAbortRef.current = true;
    setRunningScenario(null);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    if (!getMicSupport()) {
      setMicSupported(false);
      setError("Microphone requires HTTPS (or localhost) and a browser that supports getUserMedia.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setBusy(true);
        setStage("transcribing");
        try {
          const res = await fetch("/api/stt", {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error ?? `stt failed (${res.status})`);
          }
          const data: { transcript: string; confidence: number } = await res.json();
          if (!data.transcript) {
            // No speech detected — in continuous mode, listen again (bounded) instead of surfacing an error.
            if (continuousModeRef.current && silentRetriesRef.current < MAX_SILENT_RETRIES) {
              silentRetriesRef.current += 1;
              setStage("idle");
              setBusy(false);
              setTimeout(() => startRecordingRef.current(), 400);
              return;
            }
            if (continuousModeRef.current) {
              setContinuousMode(false);
              setError("Continuous mode paused — no speech detected. Click Record to continue.");
            } else {
              throw new Error("no transcript produced");
            }
            setStage("idle");
            setBusy(false);
            return;
          }
          silentRetriesRef.current = 0;
          setTranscript(data.transcript);
          setBusy(false);
          await submitTurn(data.transcript, data.confidence);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setStage("idle");
          setBusy(false);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
      setCallStarted(true);
      setStage("recording");
    } catch (e) {
      setError(describeMicError(e));
    }
  }, [submitTurn]);

  useEffect(() => {
    startRecordingRef.current = () => {
      startRecording();
    };
  }, [startRecording]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  const toggleContinuousMode = useCallback(() => {
    setContinuousMode((prev) => {
      const next = !prev;
      if (next) {
        silentRetriesRef.current = 0;
        setError(null);
        if (!recording && !busy && !isPlaying) {
          setTimeout(() => startRecordingRef.current(), 150);
        }
      }
      return next;
    });
  }, [recording, busy, isPlaying]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
      if (sessionId) {
        navigator.sendBeacon?.(
          "/api/session/end",
          new Blob([JSON.stringify({ sessionId })], { type: "application/json" })
        );
      }
    };
  }, [sessionId]);

  const endCall = useCallback(() => {
    if (!sessionId) return;
    fetch("/api/session/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {});
    setCallStarted(false);
  }, [sessionId]);

  return (
    <div className="flex flex-col gap-6">
      {sessionId && callStarted && (
        <div className="flex items-center justify-between rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] font-mono text-[var(--color-text-secondary)]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live call · visible in the admin dashboard
          </div>
          <button
            onClick={endCall}
            className="text-[12px] font-semibold text-red-400 hover:text-red-300 transition-colors"
          >
            End Call
          </button>
        </div>
      )}

      {/* Live Engine Console */}
      <section className="voxera-console flex flex-col rounded-2xl shadow-[0_20px_60px_-15px_rgba(10,12,20,0.5)] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b voxera-console-hairline">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--console-violet)]/15 text-[var(--console-violet)] flex-none">
              <Gauge className="w-4 h-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <div className="text-[13px] font-bold text-[var(--console-text)] leading-tight">Live Engine Console</div>
                <span className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--console-cyan)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--console-cyan)] animate-pulse shadow-[0_0_6px_var(--console-cyan)]" /> Live
                </span>
              </div>
              <div className="text-[10.5px] text-[var(--console-text-dim)]">Ground-truth view of every stage, every turn</div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-none">
            {continuousMode && (
              <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--console-violet)] bg-[var(--console-violet)]/10 px-2.5 py-1 rounded-full">
                <Repeat className="w-3 h-3 animate-pulse" /> Continuous
              </span>
            )}
            <div className={`voxera-waveform ${stage === "idle" ? "is-idle" : ""}`} aria-hidden="true">
              <span /><span /><span /><span /><span /><span /><span />
            </div>
          </div>
        </div>

        <div className="px-5 pt-5 pb-4 border-b voxera-console-hairline">
          <PipelineTracker stage={stage} />
        </div>

        <div className="px-5 pt-4 pb-1">
          <div className="voxera-console-label text-[10px] font-bold mb-2.5">
            Emotion Engines — HF / Lexicon / Local ONNX / Acoustic
          </div>
          <EngineDiagnosticPanel diagnostics={diagnostics} />
        </div>

        <div className="px-5 pt-4 pb-5">
          <div className="voxera-console-label text-[10px] font-bold mb-2.5">
            Emotion Timeline — this session
          </div>
          <EmotionTimeline history={emotionHistory} />
        </div>

        <div className="px-5 pt-1 pb-5">
          <div className="flex items-center justify-between mb-2">
            <div
              className="voxera-console-label text-[10px] font-bold"
              title="Acoustic-heuristic engines tend to over-read ambiguous/quiet audio as negative. This nudges the acoustic engine's label scoring toward positive or negative labels before it picks a winner — it does not affect the Lexicon or Local ONNX text engines."
            >
              Acoustic Sensitivity Calibration
            </div>
            <span className="text-[11px] font-mono text-[var(--console-cyan)]">
              {sensitivityBias === 0 ? "Off" : sensitivityBias > 0 ? `+${sensitivityBias.toFixed(1)} positive` : `${sensitivityBias.toFixed(1)} negative`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--console-text-dim)] flex-none">− Negative</span>
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
            <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--console-text-dim)] flex-none">Positive +</span>
          </div>
        </div>
      </section>

      {/* Input Console — same dark instrument-panel language as the Live
          Engine Console above it, so the two read as one continuous
          console instead of a dark panel stacked on a mismatched light card. */}
      <div className="voxera-console flex flex-col rounded-2xl shadow-[0_20px_60px_-15px_rgba(10,12,20,0.5)] overflow-hidden">
        {showExamples && (
          <div className="flex flex-col gap-2.5 px-5 pt-4">
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--console-text-dim)] py-1">
                Scenarios:
              </span>
              {SCENARIOS.map((s) => {
                const isRunning = runningScenario === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    title={s.description}
                    onClick={() => (isRunning ? stopScenario() : runScenario(s))}
                    disabled={!isRunning && (busy || !!runningScenario)}
                    className={`flex items-center gap-1.5 text-[11.5px] px-2.5 py-1 rounded-full border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      isRunning
                        ? "bg-[var(--console-violet)]/20 border-[var(--console-violet)]/50 text-[var(--console-violet)]"
                        : "bg-[var(--console-surface)] border-[var(--console-border)] text-[var(--console-text-dim)] hover:border-[var(--console-border-active)] hover:text-[var(--console-text)]"
                    }`}
                  >
                    {isRunning ? (
                      <>
                        <StopCircle className="w-3.5 h-3.5" /> Stop ({scenarioStep + 1}/{s.turns.length})
                      </>
                    ) : (
                      <>
                        <PlayCircle className="w-3.5 h-3.5" /> {s.label}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--console-text-dim)] py-1">Try:</span>
              {EXAMPLE_INPUTS.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setTranscript(example)}
                  className="text-[11.5px] px-2.5 py-1 rounded-full bg-[var(--console-surface)] border border-[var(--console-border)] text-[var(--console-text-dim)] hover:border-[var(--console-border-active)] hover:text-[var(--console-text)] transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Type a message or press Record to speak…"
          className="w-full bg-transparent border-0 focus:ring-0 px-5 pt-4 pb-2 text-[14px] text-[var(--console-text)] placeholder:text-[var(--console-text-dim)] resize-none min-h-[56px]"
        />

        {/* Actions Bar */}
        <div className="flex justify-between items-center gap-3 px-4 py-3 border-t voxera-console-hairline bg-black/10">
          <div className="flex items-center min-w-0">
            {(busy || isPlaying || recording) ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--console-surface-raised)] border border-[var(--console-border)]">
                {recording ? (
                  <div className="flex items-center gap-2 text-red-400 font-mono text-[10px] font-bold uppercase tracking-widest">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,1)]" /> Recording
                  </div>
                ) : busy ? (
                  <div className="flex items-center gap-2 text-[var(--console-cyan)] font-mono text-[10px] font-bold uppercase tracking-widest">
                    <Loader2 className="w-3 h-3 animate-spin" /> {stage === "transcribing" ? "Transcribing" : "Thinking"}
                  </div>
                ) : isPlaying ? (
                  <div className="flex items-center gap-2 text-[var(--console-violet)] font-mono text-[10px] font-bold uppercase tracking-widest">
                    <Activity className="w-3 h-3 animate-pulse" /> Agent Speaking
                  </div>
                ) : null}
              </div>
            ) : (
              <span className="text-[11.5px] text-[var(--console-text-dim)] hidden sm:inline">Type, or press Record to speak</span>
            )}
          </div>

          <div className="flex gap-2 flex-none">
            <button
              onClick={toggleContinuousMode}
              title="Automatically listen again after each reply — a continuous back-and-forth conversation loop"
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] font-semibold transition-all ${
                continuousMode
                  ? "bg-[var(--console-violet)]/20 border border-[var(--console-violet)]/50 text-[var(--console-violet)]"
                  : "bg-[var(--console-surface-raised)] border border-[var(--console-border)] text-[var(--console-text-dim)] hover:border-[var(--console-border-active)]"
              }`}
            >
              <Repeat className="w-4 h-4" />
              <span className="hidden sm:inline">Continuous</span>
            </button>

            <button
              onClick={recording ? stopRecording : startRecording}
              disabled={(busy && !recording) || (!recording && !micSupported)}
              title={!micSupported && !recording ? "Microphone requires HTTPS (or localhost) and a supported browser" : undefined}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all ${
                recording
                  ? "bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)] hover:bg-red-600"
                  : "bg-[var(--console-surface-raised)] border border-[var(--console-border)] text-[var(--console-text)] hover:border-[var(--console-border-active)]"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {recording ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-4 h-4" />}
              {recording ? "Stop" : "Record"}
            </button>

            <button
              onClick={() => submitTurn(transcript)}
              disabled={busy || !transcript.trim() || recording}
              className="flex items-center gap-2 px-6 py-2 rounded-xl btn-gradient text-white text-[13px] font-semibold shadow-[0_0_15px_var(--color-accent-glow)] transition-all hover:scale-[1.02] disabled:opacity-40 disabled:scale-100 disabled:shadow-none disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" /> Send
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-950/30 border border-red-900/50 text-[13px] text-red-400 px-4 py-3">
          {error}
        </div>
      )}

      {/* Hidden Audio Player */}
      <audio ref={audioRef} className="hidden" />

      {/* History Log */}
      <section className="flex flex-col gap-4">
        {history.slice().reverse().map((entry, idx) => (
          <TurnCard key={history.length - idx} entry={entry} />
        ))}
      </section>
    </div>
  );
}

function TurnCard({ entry }: { entry: TurnEntry }) {
  const t = entry.trace;
  const flagList = Object.entries(t.emotion.flags)
    .filter(([, v]) => v)
    .map(([k]) => k);
    
  return (
    <article className="voxera-console rounded-2xl p-6 flex flex-col gap-5 shadow-[0_20px_60px_-15px_rgba(10,12,20,0.5)]">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[var(--console-surface)] rounded-xl p-4 border border-[var(--console-border)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-[var(--console-text-dim)]" />
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--console-text-dim)] mb-2">User</div>
          <div className="text-[14px] text-[var(--console-text)] leading-relaxed">{entry.user}</div>
        </div>
        <div className="bg-[var(--console-surface)] rounded-xl p-4 border border-[var(--console-border)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[var(--console-violet)] to-[var(--console-cyan)]" />
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--console-cyan)] mb-2">Agent</div>
          <div className="text-[14px] text-[var(--console-text)] leading-relaxed">{entry.reply}</div>
        </div>
      </div>

      <div className="border-t voxera-console-hairline pt-5">
        <div className="voxera-console-label text-[10px] font-bold mb-4">Acoustic Trace & Policy</div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4 text-[12px]">
          <Cell label="Emotion" value={`${t.emotion.current.label} · ${t.emotion.current.intensity.toFixed(2)}`} highlight />
          <Cell
            label="Confidence"
            value={`${t.emotion.current.confidence.toFixed(2)} (${(() => {
              const rawCat = t.utterance.emotion?.confidenceCategory;
              const level = (typeof rawCat === "object" && rawCat) ? rawCat.level : (rawCat ?? confCategory(t.emotion.current.confidence));
              return level.charAt(0).toUpperCase() + level.slice(1);
            })()}`}
          />
          <Cell label="Importance" value={t.importance.toFixed(2)} />
          <Cell label="Memory" value={`${t.memoryWrite.tier}${t.memoryWrite.merged ? " (merged)" : ""}`} />
          <Cell
            label="VAD"
            value={`${t.emotion.current.vad.v.toFixed(2)} / ${t.emotion.current.vad.a.toFixed(2)} / ${t.emotion.current.vad.d.toFixed(2)}`}
          />
          <Cell
            label="Trajectory"
            value={`Δv=${t.emotion.trajectory.slope_v.toFixed(2)} Δa=${t.emotion.trajectory.slope_a.toFixed(2)}`}
          />
          <Cell label="Policy" value={`${t.policy.pace} · esc=${t.policy.escalate}`} highlight />
          <Cell label="Flags" value={flagList.length ? flagList.join(", ") : "—"} />
        </dl>
      </div>

      {t.cai && (
        <div className="flex items-center gap-3 bg-[var(--console-surface)] border border-[var(--console-border)] rounded-xl p-3">
          <div className="flex-none px-3 py-1.5 rounded-lg bg-[var(--console-cyan)]/10 border border-[var(--console-cyan)]/30 text-[var(--console-cyan)] font-mono font-bold text-[12px]">
            CAI {t.cai.score}
          </div>
          <div className="text-[12px] text-[var(--console-text-dim)] leading-snug">
            <span className="font-semibold text-[var(--console-text)]">{t.cai.category}:</span> {t.cai.explanation}
          </div>
        </div>
      )}

      <details className="text-[11px] text-[var(--console-text-dim)] group">
        <summary className="cursor-pointer select-none font-mono tracking-widest uppercase hover:text-[var(--console-text)] transition-colors">Developer Logs · Retrieval & LLM</summary>
        <pre className="mt-3 whitespace-pre-wrap break-words bg-[var(--console-surface)] p-4 rounded-xl border border-[var(--console-border)] text-[10px] text-[var(--console-text-dim)]">
          {JSON.stringify(
            {
              retrievalScores: t.retrieved.scores,
              mtmIds: t.retrieved.mtmIds,
              ltmUserIds: t.retrieved.ltmUserIds,
              ltmClientIds: t.retrieved.ltmClientIds,
              guardReasons: t.guardReasons,
              llmModel: t.llmModel,
              usedLiveLlm: t.usedLiveLlm,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </article>
  );
}

function confCategory(c: number): string {
  if (c >= 0.75) return "High";
  if (c >= 0.45) return "Medium";
  return "Low";
}

function Cell({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[10px] font-mono uppercase tracking-widest text-[var(--console-text-dim)]">{label}</dt>
      <dd className={`font-mono ${highlight ? 'text-[var(--console-violet)] font-bold' : 'text-[var(--console-text-dim)]'}`}>{value}</dd>
    </div>
  );
}
