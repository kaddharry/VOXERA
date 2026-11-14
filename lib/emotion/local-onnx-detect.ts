import type { EmotionLabel, EmotionSignal, VAD } from "../types";
import { clamp } from "../util/math";
import { classifyConfidence } from "./confidence";
import { HF_LABEL_MAP, HF_VAD_MAP } from "./emotion-label-map";

export interface LocalOnnxDetectResult {
  signal: EmotionSignal | null;
  latencyMs: number;
  /** True if the model failed to load or classify — caller should treat this the same as unavailable. */
  errored: boolean;
  rawPredictions?: Array<{ label: string; score: number }>;
}

/**
 * Local 7-class emotion detection via the in-process ONNX model
 * (lib/emotion/local-emotion-classifier.ts). Diagnostic-only for now (see that
 * file's header) — not part of the production detectTextEmotion() router.
 *
 * Does not depend on the lexicon or the remote HF path; independent engine,
 * same label/VAD mapping as ml-detect.ts since it's the same underlying model.
 */
export async function detectTextEmotionLocalONNX(text: string): Promise<LocalOnnxDetectResult> {
  const start = performance.now();

  if (!text.trim()) {
    return { signal: null, latencyMs: performance.now() - start, errored: false };
  }

  try {
    // Loaded on first use, not at import time: @xenova/transformers loads the
    // native ONNX runtime when imported, and a failure there must not stop
    // the phone-call route itself from loading (it would refuse every call).
    const { default: LocalEmotionClassifier } = await import("./local-emotion-classifier");
    const classifier = await LocalEmotionClassifier.getInstance();
    const results = (await classifier(text, { topk: 7 })) as Array<{ label: string; score: number }>;
    const latencyMs = performance.now() - start;

    if (!Array.isArray(results) || results.length === 0) {
      return { signal: null, latencyMs, errored: false };
    }

    const predictions = [...results].sort((a, b) => b.score - a.score);
    const top = predictions[0];
    const label: EmotionLabel = HF_LABEL_MAP[top.label.toLowerCase()] || "neutral";
    const confidence = clamp(top.score, 0, 1);

    const base = HF_VAD_MAP[label];
    const vad: VAD = { v: base.v * confidence, a: base.a * confidence, d: base.d * confidence };
    const intensity = clamp(Math.sqrt(vad.v * vad.v + vad.a * vad.a + vad.d * vad.d) / Math.sqrt(3));

    const signal: EmotionSignal = {
      label,
      intensity,
      confidence,
      confidenceCategory: classifyConfidence(confidence),
      vad,
      source: "text",
      at: Date.now(),
    };

    return { signal, latencyMs, errored: false, rawPredictions: predictions };
  } catch (err) {
    console.warn("[LocalOnnxDetect] classification failed:", err);
    return { signal: null, latencyMs: performance.now() - start, errored: true };
  }
}
