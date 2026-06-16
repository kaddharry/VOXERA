"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface TurnTrace {
  utterance: { id: string; text: string; emotion?: { label: string; intensity: number; confidence: number; confidenceCategory?: string } };
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
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      <div className="flex flex-col sm:flex-row gap-3 items-stretch">
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Type a message or press Record to speak…"
          className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm min-h-[60px]"
        />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => submitTurn(transcript)}
            disabled={busy || !transcript.trim()}
            className="rounded-md bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm disabled:opacity-40"
          >
            Send
          </button>
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={busy && !recording}
            className={`rounded-md px-4 py-2 text-sm text-white ${recording ? "bg-red-600" : "bg-indigo-600"} disabled:opacity-40`}
          >
            {recording ? "Stop" : "Record"}
          </button>
        </div>
      </div>
      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300 px-3 py-2">
          {error}
        </div>
      )}
      <audio ref={audioRef} controls className="w-full" />
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
    <article className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 flex flex-col gap-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500">User</div>
        <div className="text-sm">{entry.user}</div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500">Agent</div>
        <div className="text-sm">{entry.reply}</div>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
        <Cell label="Emotion" value={`${t.emotion.current.label} · ${t.emotion.current.intensity.toFixed(2)}`} />
        <Cell label="Confidence" value={`${t.emotion.current.confidence.toFixed(2)} (${t.utterance.emotion?.confidenceCategory ?? confCategory(t.emotion.current.confidence)})`} />
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
        <Cell label="Policy" value={`${t.policy.pace} · esc=${t.policy.escalate}`} />
        <Cell label="Flags" value={flagList.length ? flagList.join(", ") : "—"} />
        {t.cai && <Cell label="CAI" value={`${t.cai.score}/100 · ${t.cai.category}`} />}
      </dl>
      {t.cai && (
        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900 rounded px-2 py-1">
          <span className="font-semibold">Engagement:</span> {t.cai.explanation}
        </div>
      )}
      <details className="text-xs text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer select-none">retrieval · guard · llm</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words">{JSON.stringify(
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
        )}</pre>
      </details>
    </article>
  );
}

function confCategory(c: number): string {
  if (c >= 0.75) return "High";
  if (c >= 0.45) return "Medium";
  return "Low";
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
