import type { EmotionLabel, VAD } from "../types";

/** One patient turn's fused emotion, as logged per turn (session_logs
 * "emotion" events written by lib/agent/orchestrator.ts). */
export interface TurnEmotion {
  label: EmotionLabel;
  intensity: number;
  vad?: VAD;
}

/** How the patient felt across the whole call — per-turn labels say how
 * each sentence sounded; this says how the call went. */
export interface CallEmotion {
  /** The emotion that carried the most weight (turn count × intensity),
   * ignoring neutral unless nothing else was felt. */
  overall: EmotionLabel;
  /** Average valence over the call, -1 (very negative) to 1 (very positive). */
  averageValence: number;
  negativeTurns: number;
  positiveTurns: number;
  totalTurns: number;
  /** Mood at the end of the call compared with the start. */
  trend: "improved" | "worsened" | "steady";
  /** The most intense negative moment, if any. */
  peakNegative: { turn: number; label: EmotionLabel; intensity: number } | null;
}

const NEGATIVE: ReadonlySet<EmotionLabel> = new Set(["anger", "frustration", "sadness", "distress", "fear", "disappointment", "confusion"]);
const POSITIVE: ReadonlySet<EmotionLabel> = new Set(["joy", "gratitude", "excitement", "calm"]);

/** Valence change between the first and last third of the call that counts as a real shift. */
const TREND_THRESHOLD = 0.2;

function valenceOf(t: TurnEmotion): number {
  if (t.vad) return t.vad.v;
  return NEGATIVE.has(t.label) ? -t.intensity : POSITIVE.has(t.label) ? t.intensity : 0;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summarizeCallEmotion(turns: TurnEmotion[]): CallEmotion | null {
  if (turns.length === 0) return null;

  const weight = new Map<EmotionLabel, number>();
  for (const t of turns) {
    if (t.label === "neutral") continue;
    weight.set(t.label, (weight.get(t.label) ?? 0) + Math.max(t.intensity, 0.1));
  }
  const overall = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "neutral";

  const valences = turns.map(valenceOf);
  const third = Math.max(1, Math.floor(turns.length / 3));
  const shift = mean(valences.slice(-third)) - mean(valences.slice(0, third));
  const trend = turns.length < 2 ? "steady" : shift > TREND_THRESHOLD ? "improved" : shift < -TREND_THRESHOLD ? "worsened" : "steady";

  let peakNegative: CallEmotion["peakNegative"] = null;
  turns.forEach((t, i) => {
    if (NEGATIVE.has(t.label) && (!peakNegative || t.intensity > peakNegative.intensity)) {
      peakNegative = { turn: i + 1, label: t.label, intensity: Math.round(t.intensity * 100) / 100 };
    }
  });

  return {
    overall,
    averageValence: Math.round(mean(valences) * 100) / 100,
    negativeTurns: turns.filter((t) => NEGATIVE.has(t.label)).length,
    positiveTurns: turns.filter((t) => POSITIVE.has(t.label)).length,
    totalTurns: turns.length,
    trend,
    peakNegative,
  };
}

/** One line for people: "Mostly fear · 5 of 8 turns negative · improved by
 * the end · strongest: distress at turn 2". */
export function describeCallEmotion(e: CallEmotion): string {
  const parts = [
    e.overall === "neutral" ? "Mostly neutral" : `Mostly ${e.overall}`,
    `${e.negativeTurns} of ${e.totalTurns} turns negative`,
    e.trend === "improved" ? "improved by the end" : e.trend === "worsened" ? "worsened by the end" : "steady through the call",
  ];
  if (e.peakNegative) parts.push(`strongest: ${e.peakNegative.label} at turn ${e.peakNegative.turn}`);
  return parts.join(" · ");
}
