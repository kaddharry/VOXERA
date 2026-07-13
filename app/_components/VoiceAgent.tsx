"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Send, Square, Activity, Loader2 } from "lucide-react";

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
}

interface TurnEntry {
  user: string;
  reply: string;
  trace: TurnTrace;
}

export function VoiceAgent() {
  const [transcript, setTranscript] = useState("");
  const [history, setHistory] = useState<TurnEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onplay = () => setIsPlaying(true);
      audioRef.current.onended = () => setIsPlaying(false);
      audioRef.current.onpause = () => setIsPlaying(false);
    }
  }, []);

  const submitTurn = useCallback(
    async (text: string, sttConfidence?: number) => {
      if (!text.trim() || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text, sttConfidence }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `turn failed (${res.status})`);
        }
        const data: { reply: string; trace: TurnTrace } = await res.json();
        setHistory((h) => [...h, { user: text, reply: data.reply, trace: data.trace }]);
        setTranscript("");

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
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const startRecording = useCallback(async () => {
    setError(null);
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
          if (!data.transcript) throw new Error("no transcript produced");
          setTranscript(data.transcript);
          await submitTurn(data.transcript, data.confidence);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [submitTurn]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      
      {/* Input Area */}
      <div className="flex flex-col bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-2 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Type a message or press Record to speak…"
          className="w-full bg-transparent border-0 focus:ring-0 px-4 py-3 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] resize-none min-h-[80px]"
        />
        
        {/* Actions Bar */}
        <div className="flex justify-between items-center px-2 pb-2">
          
          <div className="flex items-center gap-2">
            {/* Audio State Visualizer */}
            {(busy || isPlaying || recording) && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)]">
                {recording ? (
                  <div className="flex items-center gap-2 text-red-500 font-mono text-[10px] font-bold uppercase tracking-widest">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,1)]" /> Recording
                  </div>
                ) : busy ? (
                  <div className="flex items-center gap-2 text-[var(--color-accent-cyan)] font-mono text-[10px] font-bold uppercase tracking-widest">
                    <Loader2 className="w-3 h-3 animate-spin" /> Processing
                  </div>
                ) : isPlaying ? (
                  <div className="flex items-center gap-2 text-[var(--color-accent-violet)] font-mono text-[10px] font-bold uppercase tracking-widest">
                    <Activity className="w-3 h-3 animate-pulse" /> Agent Speaking
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={recording ? stopRecording : startRecording}
              disabled={busy && !recording}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all ${
                recording 
                  ? "bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)] hover:bg-red-600" 
                  : "bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:border-[var(--color-border-active)]"
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
    <article className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-6 flex flex-col gap-5 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[var(--color-bg-base)] rounded-xl p-4 border border-[var(--color-border-subtle)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-[var(--color-text-muted)]" />
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-secondary)] mb-2">User</div>
          <div className="text-[14px] text-[var(--color-text-primary)] leading-relaxed">{entry.user}</div>
        </div>
        <div className="bg-[var(--color-bg-base)] rounded-xl p-4 border border-[var(--color-border-subtle)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[var(--color-accent-violet)] to-[var(--color-accent-cyan)]" />
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--color-accent-cyan)] mb-2">Agent</div>
          <div className="text-[14px] text-[var(--color-text-primary)] leading-relaxed">{entry.reply}</div>
        </div>
      </div>

      <div className="border-t border-[var(--color-border-subtle)] pt-5">
        <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-secondary)] mb-4">Acoustic Trace & Policy</div>
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
        <div className="flex items-center gap-3 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-xl p-3">
          <div className="flex-none px-3 py-1.5 rounded-lg bg-[var(--color-accent-cyan)]/10 border border-[var(--color-accent-cyan)]/30 text-[var(--color-accent-cyan)] font-mono font-bold text-[12px]">
            CAI {t.cai.score}
          </div>
          <div className="text-[12px] text-[var(--color-text-secondary)] leading-snug">
            <span className="font-semibold text-[var(--color-text-primary)]">{t.cai.category}:</span> {t.cai.explanation}
          </div>
        </div>
      )}

      <details className="text-[11px] text-[var(--color-text-muted)] group">
        <summary className="cursor-pointer select-none font-mono tracking-widest uppercase hover:text-[var(--color-text-secondary)] transition-colors">Developer Logs · Retrieval & LLM</summary>
        <pre className="mt-3 whitespace-pre-wrap break-words bg-[var(--color-bg-base)] p-4 rounded-xl border border-[var(--color-border-subtle)] text-[10px]">
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
      <dt className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)]">{label}</dt>
      <dd className={`font-mono ${highlight ? 'text-[var(--color-accent-violet)] font-bold' : 'text-[var(--color-text-secondary)]'}`}>{value}</dd>
    </div>
  );
}
