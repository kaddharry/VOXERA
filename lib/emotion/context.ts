import type { EmotionContext, EmotionSignal, MemoryRecord, Utterance, VAD } from "../types";
import { slope, variance } from "../util/math";

const DEFAULT_BASELINE = { v: 0, a: 0, d: 0, sigma_v: 0.3, sigma_a: 0.3, sigma_d: 0.3 };

export function buildEmotionContext(args: {
  current: EmotionSignal;
  stm: Utterance[];
  ltmUser: MemoryRecord[];
  window?: number;
}): EmotionContext {
  const window = args.window ?? 6;
  const baseline = deriveBaseline(args.ltmUser) ?? DEFAULT_BASELINE;

  const recentSignals = args.stm
    .slice(-window)
    .map((u) => u.emotion)
    .filter((e): e is EmotionSignal => !!e);

  const arousals = recentSignals.map((e) => e.vad.a).concat(args.current.vad.a);
  const valences = recentSignals.map((e) => e.vad.v).concat(args.current.vad.v);

  const slope_a = slope(arousals);
  const slope_v = slope(valences);

  const negLabels = new Set(["frustration", "anger", "distress", "sadness"]);
  const negCount = [...recentSignals, args.current].filter((e) => negLabels.has(e.label)).length;
  const chronic = countChronicFromLtm(args.ltmUser);

  const zV = baseline.sigma_v > 0 ? Math.abs((args.current.vad.v - baseline.v) / baseline.sigma_v) : 0;
  const zA = baseline.sigma_a > 0 ? Math.abs((args.current.vad.a - baseline.a) / baseline.sigma_a) : 0;
  const zDeviation = Math.min(3, Math.sqrt(zV * zV + zA * zA));

  return {
    current: args.current,
    trajectory: { slope_v, slope_a, window },
    zDeviation,
    flags: {
      repeated_frustration: negCount >= 3 || chronic >= 2,
      increasing_distress: slope_a > 0.1 && slope_v < -0.05 && args.current.intensity > 0.5,
      affect_oscillation: variance(valences) > 0.25,
      chronic_negativity: chronic >= 2,
    },
    baseline,
  };
}

function deriveBaseline(ltm: MemoryRecord[]) {
  const vads = ltm.map((m) => m.vad).filter((v): v is VAD => !!v && typeof v.v === "number");
  if (vads.length < 3) return null;
  const mean = avg(vads);
  return {
    ...mean,
    sigma_v: std(vads.map((x) => x.v), mean.v),
    sigma_a: std(vads.map((x) => x.a), mean.a),
    sigma_d: std(vads.map((x) => x.d), mean.d),
  };
}

function avg(vads: VAD[]): VAD {
  const n = vads.length;
  return {
    v: vads.reduce((s, x) => s + x.v, 0) / n,
    a: vads.reduce((s, x) => s + x.a, 0) / n,
    d: vads.reduce((s, x) => s + x.d, 0) / n,
  };
}

function std(xs: number[], m: number): number {
  if (xs.length < 2) return 0.3;
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.max(0.1, Math.sqrt(v));
}

function countChronicFromLtm(ltm: MemoryRecord[]): number {
  return ltm.filter((m) => m.topic === "chronic_issue" || m.recurrence >= 3).length;
}
