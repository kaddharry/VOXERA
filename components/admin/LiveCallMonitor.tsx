"use client";

import { useEffect, useState } from "react";
import { Activity, Radio, Volume2, ShieldAlert, Zap, MessageSquare } from "lucide-react";
import { EmotionSparkline, type EmotionPoint } from "./EmotionSparkline";
import { GlassCard } from "@/app/_components/GlassCard";

const MAX_HISTORY_POINTS = 60;

interface LiveSessionState {
  sessionId: string;
  emotionLabel: string;
  intensity: number;
  confidence: number;
  caiScore: number;
  caiCategory: string;
  flags: Record<string, boolean>;
  transcript: Array<{ role: "user" | "agent"; text: string }>;
}

export function LiveCallMonitor({
  onLiveUpdate,
}: {
  /** Reports real, live signal (not a decorative loop) whenever it changes
   * — e.g. for VoiceOrb elsewhere on the page to react to an actual
   * in-progress call instead of sitting idle. */
  onLiveUpdate?: (info: { active: boolean; intensity: number; caiScore: number; emotionLabel: string }) => void;
}) {
  const [activeCalls, setActiveCalls] = useState<Array<{ id: string; sessionId?: string; callerNumber: string; startedAt: number }>>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<LiveSessionState | null>(null);
  const [emotionHistory, setEmotionHistory] = useState<EmotionPoint[]>([]);

  // Fetch active call logs
  useEffect(() => {
    async function fetchCalls() {
      try {
        const res = await fetch("/api/session/active");
        const json = await res.json();
        if (json.calls) {
          setActiveCalls(json.calls);
          if (json.calls.length > 0 && !selectedSessionId) {
            // Live events (emotion/cai/transcript) are published to
            // `session:${sessionId}` — the "tel-xxx" id TelephonyStreamHandler
            // generates per call — not `session:${callSid}`. call.id is
            // always truthy, so it must be checked second or the SSE
            // subscription below silently listens on the wrong channel.
            setSelectedSessionId(json.calls[0].sessionId || json.calls[0].id);
          }
          if (json.calls.length === 0) {
            onLiveUpdate?.({ active: false, intensity: 0, caiScore: 0, emotionLabel: "neutral" });
          }
        }
      } catch (err) {
        console.error("Failed to fetch active calls:", err);
      }
    }
    fetchCalls();
    const interval = setInterval(fetchCalls, 5000);
    return () => clearInterval(interval);
  }, [selectedSessionId, onLiveUpdate]);

  // Subscribe to SSE stream for selected session
  useEffect(() => {
    if (!selectedSessionId) return;

    // Reset state for new session
    setLiveState({
      sessionId: selectedSessionId,
      emotionLabel: "neutral",
      intensity: 0,
      confidence: 0.5,
      caiScore: 50,
      caiCategory: "Moderate Engagement",
      flags: {},
      transcript: [],
    });
    setEmotionHistory([]);

    const es = new EventSource(`/api/session/${selectedSessionId}/stream`);

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload.type) return;

        setLiveState((prev) => {
          if (!prev) return null;
          const updated = { ...prev };

          if (payload.type === "emotion") {
            updated.emotionLabel = payload.data.label || "neutral";
            updated.intensity = payload.data.intensity || 0;
            updated.confidence = payload.data.confidence || 0.5;
            updated.flags = payload.data.flags || {};
            setEmotionHistory((hist) => [
              ...hist.slice(-(MAX_HISTORY_POINTS - 1)),
              {
                ts: Date.now(),
                v: payload.data.vad?.v ?? 0,
                a: payload.data.vad?.a ?? 0,
                intensity: payload.data.intensity || 0,
                label: payload.data.label || "neutral",
              },
            ]);
          } else if (payload.type === "cai") {
            updated.caiScore = payload.data.score || 50;
            updated.caiCategory = payload.data.category || "Moderate Engagement";
          } else if (payload.type === "transcript") {
            updated.transcript = [
              ...updated.transcript,
              { role: payload.data.role, text: payload.data.text },
            ];
          }

          onLiveUpdate?.({ active: true, intensity: updated.intensity, caiScore: updated.caiScore, emotionLabel: updated.emotionLabel });
          return updated;
        });
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };

    return () => {
      es.close();
    };
  }, [selectedSessionId, onLiveUpdate]);

  const getEmotionColor = (label: string) => {
    switch (label) {
      case "anger":
      case "frustration":
      case "distress":
        return "text-red-400 border-red-500/30 bg-red-500/10";
      case "fear":
      case "confusion":
      case "disappointment":
        return "text-amber-400 border-amber-500/30 bg-amber-500/10";
      case "joy":
      case "gratitude":
      case "excitement":
      case "calm":
        return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
      default:
        return "text-[var(--color-accent-cyan)] border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10";
    }
  };

  return (
    <GlassCard className="p-6">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[var(--color-accent-violet)]/10 border border-[var(--color-accent-violet)]/25 rounded-lg text-[var(--color-accent-violet)]">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Live Call & Emotion Monitor</h2>
            <p className="text-[11.5px] text-[var(--color-text-muted)]">Real-time SSE emotion stream &amp; prosody monitoring</p>
          </div>
        </div>
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
          <Activity className="w-3.5 h-3.5 mr-1 animate-spin" /> Stream Active
        </span>
      </div>

      {activeCalls.length === 0 ? (
        <div className="text-center py-8 text-[var(--color-text-muted)]">
          <Volume2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-[13.5px]">No active calls streaming at the moment.</p>
          <p className="text-[11.5px] mt-1">
            <a href="/admin/try-call" className="text-[var(--color-accent-violet)] hover:underline">Try a call</a> or receive a phone call to monitor the live stream.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active Call Selector */}
          <div className="space-y-3 lg:border-r lg:border-[var(--color-border-subtle)] lg:pr-6">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Active Calls</h3>
            {activeCalls.map((call) => {
              const callSessionId = call.sessionId || call.id;
              return (
              <button
                key={call.id}
                onClick={() => setSelectedSessionId(callSessionId)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedSessionId === callSessionId
                    ? "bg-[var(--color-accent-violet)]/10 border-[var(--color-accent-violet)]/40 text-[var(--color-text-primary)]"
                    : "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-accent-violet)]/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[13px] font-medium">{call.callerNumber || call.id}</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                </div>
                <div className="text-[10.5px] text-[var(--color-text-muted)] mt-1">
                  ID: {call.id.slice(0, 10)}...
                </div>
              </button>
              );
            })}
          </div>

          {/* Live Emotion & CAI Display */}
          {liveState && (
            <div className="space-y-6 lg:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Emotion Ring / Badge */}
                <div className={`p-4 rounded-xl border ${getEmotionColor(liveState.emotionLabel)}`}>
                  <div className="text-[10.5px] uppercase font-medium tracking-wider opacity-70 mb-1">Detected Emotion</div>
                  <div className="text-2xl font-bold capitalize flex items-center justify-between font-mono">
                    <span>{liveState.emotionLabel}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-black/5 font-mono">
                      Conf: {(liveState.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="text-[11px] mt-2 opacity-70">
                    Intensity: {(liveState.intensity * 100).toFixed(0)}%
                  </div>
                </div>

                {/* CAI Score */}
                <div className="p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)]">
                  <div className="text-[10.5px] uppercase font-medium tracking-wider text-[var(--color-text-muted)] mb-1">Engagement Index (CAI)</div>
                  <div className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center justify-between font-mono">
                    <span>{liveState.caiScore} <span className="text-[13px] font-normal text-[var(--color-text-muted)]">/ 100</span></span>
                    <Zap className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)] mt-2">
                    {liveState.caiCategory}
                  </div>
                </div>
              </div>

              <EmotionSparkline history={emotionHistory} />

              {/* Active Emotion Pattern Flags */}
              {Object.values(liveState.flags).some(Boolean) && (
                <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-lg flex items-center gap-2 text-red-400 text-[11.5px] font-medium">
                  <ShieldAlert className="w-4 h-4" />
                  <span>
                    Pattern Triggered: {Object.entries(liveState.flags).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " ")).join(", ")}
                  </span>
                </div>
              )}

              {/* Real-time Transcript */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2 flex items-center">
                  <MessageSquare className="w-3.5 h-3.5 mr-1" /> Live Transcript Stream
                </h3>
                <div className="bg-[var(--color-bg-elevated)] rounded-lg p-3 border border-[var(--color-border-subtle)] max-h-48 overflow-y-auto space-y-2">
                  {liveState.transcript.length === 0 ? (
                    <p className="text-[11.5px] text-[var(--color-text-muted)] italic">Waiting for turn transcript…</p>
                  ) : (
                    liveState.transcript.map((t, idx) => (
                      <div key={idx} className={`text-[11.5px] p-2 rounded ${t.role === "user" ? "bg-white/[0.06] text-[var(--color-text-primary)]" : "bg-[var(--color-accent-violet)]/10 text-[var(--color-text-primary)] border border-[var(--color-accent-violet)]/20"}`}>
                        <span className="font-semibold uppercase text-[9.5px] block opacity-60 mb-0.5">{t.role}</span>
                        {t.text}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}
