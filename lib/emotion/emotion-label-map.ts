import type { EmotionLabel, VAD } from "../types";

/**
 * Shared 7-class -> VOXERA 11-label mapping for j-hartmann/emotion-english-distilroberta-base,
 * used by both the remote HF Inference API path (ml-detect.ts) and the local ONNX path
 * (local-emotion-classifier.ts) — same underlying model, same output label space.
 */
export const HF_LABEL_MAP: Record<string, EmotionLabel> = {
  anger: "anger",
  disgust: "frustration",
  fear: "fear",
  joy: "joy",
  neutral: "neutral",
  sadness: "sadness",
  surprise: "excitement",
};

/** Synthetic VAD values for HF/ONNX-detected emotions. */
export const HF_VAD_MAP: Record<EmotionLabel, VAD> = {
  calm: { v: 0.15, a: -0.5, d: 0.1 },
  anger: { v: -0.8, a: 0.8, d: 0.5 },
  frustration: { v: -0.6, a: 0.4, d: 0.2 },
  sadness: { v: -0.7, a: -0.4, d: -0.3 },
  distress: { v: -0.8, a: 0.6, d: -0.4 },
  fear: { v: -0.6, a: 0.7, d: -0.6 },
  confusion: { v: -0.2, a: 0.2, d: -0.2 },
  joy: { v: 0.8, a: 0.5, d: 0.3 },
  gratitude: { v: 0.7, a: 0.2, d: 0.1 },
  excitement: { v: 0.9, a: 0.8, d: 0.5 },
  disappointment: { v: -0.5, a: -0.1, d: -0.2 },
  neutral: { v: 0, a: 0, d: 0 },
  relief: { v: 0.5, a: -0.3, d: 0.2 },
  surprise: { v: 0.2, a: 0.7, d: 0 },
  worry: { v: -0.4, a: 0.4, d: -0.4 },
  pain: { v: -0.8, a: 0.5, d: -0.6 },
};
