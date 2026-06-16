import { CONFIG } from "../config";
import type { EmotionContext, MemoryRecord } from "../types";
import { clamp, cosine } from "../util/math";

// Equation I1: importance = α·intensity + β·ΔVAD_user + γ·novelty + δ·recurrence
//            + ε·taskCriticality + ζ·policyFlag
export function importanceScore(args: {
  text: string;
  emotion: EmotionContext;
  novelty: number;
  recurrence: number;
  taskCriticality: number;
  policyFlag: number;
}): number {
  const { alpha, beta, gamma, delta, epsilon, zeta } = CONFIG.importance;
  const deviation = clamp(args.emotion.zDeviation / 3);
  const raw =
    alpha * args.emotion.current.intensity +
    beta * deviation +
    gamma * args.novelty +
    delta * clamp(Math.log1p(args.recurrence) / Math.log(5)) +
    epsilon * args.taskCriticality +
    zeta * args.policyFlag;
  return clamp(raw);
}

export function taskCriticality(text: string): number {
  const t = text.toLowerCase();
  let hits = 0;
  for (const kw of CONFIG.taskCritical) {
    if (t.includes(kw)) hits++;
  }
  if (hits === 0) return 0;
  return clamp(0.4 + 0.2 * hits);
}

export function policyFlag(ctx: EmotionContext): number {
  if (ctx.flags.increasing_distress) return 1;
  if (ctx.flags.repeated_frustration) return 0.8;
  if (ctx.flags.chronic_negativity) return 0.6;
  return 0;
}

export function novelty(embedding: number[], existing: MemoryRecord[]): number {
  if (existing.length === 0) return 1;
  let maxSim = 0;
  for (const m of existing) {
    if (!m.embedding || m.embedding.length === 0) continue;
    const s = cosine(embedding, m.embedding);
    if (s > maxSim) maxSim = s;
  }
  return clamp(1 - maxSim);
}
