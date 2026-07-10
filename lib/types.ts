export type Role = "user" | "agent" | "system";

export type EmotionLabel =
  | "neutral"
  | "frustration"
  | "anger"
  | "sadness"
  | "distress"
  | "fear"
  | "confusion"
  | "joy"
  | "gratitude"
  | "excitement"
  | "disappointment";

export interface ConfidenceCategory {
  level: "high" | "medium" | "low";
  explanation: string;
}

export interface VAD {
  v: number;
  a: number;
  d: number;
}

export interface EmotionSignal {
  label: EmotionLabel;
  intensity: number;
  confidence: number;
  confidenceCategory?: ConfidenceCategory;
  vad: VAD;
  source: "text" | "audio" | "fused";
  at: number;
  isMixed?: boolean;
}

export interface Utterance {
  id: string;
  role: Role;
  text: string;
  sttConfidence?: number;
  emotion?: EmotionSignal;
  ts: number;
}

export interface PatternFlags {
  repeated_frustration: boolean;
  increasing_distress: boolean;
  affect_oscillation: boolean;
  chronic_negativity: boolean;
}

export interface EmotionContext {
  current: EmotionSignal;
  trajectory: { slope_v: number; slope_a: number; window: number };
  zDeviation: number;
  flags: PatternFlags;
  baseline: VAD & { sigma_v: number; sigma_a: number; sigma_d: number };
}

export type MemoryTier = "STM" | "MTM" | "LTM_user" | "LTM_client";

export interface MemoryRecord {
  id: string;
  tier: MemoryTier;
  userId: string;
  clientId: string;
  ts: number;
  text: string;
  summary: string;
  entities: string[];
  topic: string;
  emotion: EmotionLabel;
  vad: VAD;
  intensity: number;
  importance: number;
  embedding: number[];
  sourceUtteranceIds: string[];
  recurrence: number;
  resolved: boolean;
  ttl?: number;
  documentId?: string;
}

export interface PolicyDirectives {
  acknowledgeFirst: boolean;
  pace: "slow" | "normal" | "fast";
  allowUpsell: boolean;
  escalate: "none" | "tier2" | "human";
  safetyScript?: string;
  notes: string[];
}

export interface RetrievedContext {
  stm: Utterance[];
  mtm: MemoryRecord[];
  ltmUser: MemoryRecord[];
  ltmClient: MemoryRecord[];
  scores: { id: string; score: number }[];
}

export interface AcousticFeatures {
  /** Root-mean-square amplitude (0–32768 range for 16-bit PCM). */
  rmsEnergy: number;
  /** Zero-crossing rate: fraction of adjacent samples that cross zero (0–1). */
  zeroCrossingRate: number;
  /** Estimated fundamental frequency in Hz (median across frames). 0 if unvoiced. */
  pitchHz: number;
  /** Pitch coefficient of variation (stddev / mean). Higher = more dynamic. 0–1 clamped. */
  pitchVariation: number;
  /** Estimated words-per-minute based on transcript word count and audio duration. */
  speakingRateWPM: number;
  /** Total detected silence/pause duration in ms. */
  pauseDurationMs: number;
  /** Number of distinct pause segments detected. */
  pauseCount: number;
  /** Total audio duration in ms. */
  durationMs: number;
}
