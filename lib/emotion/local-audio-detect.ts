import type { EmotionLabel, EmotionSignal, VAD } from "../types";
import { clamp } from "../util/math";
import { classifyConfidence } from "./confidence";
import { HF_VAD_MAP } from "./emotion-label-map";

/**
 * onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX's id2label
 * (verified against its config.json): 6-class SAD/ANGRY/DISGUST/FEAR/HAPPY/
 * NEUTRAL. Mapped onto VOXERA's EmotionLabel space using the same convention
 * as HF_LABEL_MAP (disgust -> frustration) — VAD is then synthesized from
 * HF_VAD_MAP, which already covers every label this maps onto.
 */
const WAV2VEC2_LABEL_MAP: Record<string, EmotionLabel> = {
  SAD: "sadness",
  ANGRY: "anger",
  DISGUST: "frustration",
  FEAR: "fear",
  HAPPY: "joy",
  NEUTRAL: "neutral",
};

export interface LocalAudioDetectResult {
  signal: EmotionSignal | null;
  latencyMs: number;
  /** True if the model failed to load or classify — caller should treat this the same as unavailable. */
  errored: boolean;
  rawPredictions?: Array<{ label: string; score: number }>;
}

/** Minimum audio length the model is fed — below this the classifier's output is unreliable. */
const MIN_SAMPLES_16KHZ = 8000; // 500ms at 16kHz

/**
 * Local wav2vec2-based speech-emotion-recognition — a real trained acoustic
 * model, run in-process (see local-audio-classifier.ts's header for why this
 * model and not emotion2vec+). Diagnostic-only for now.
 *
 * @param pcm16kHzFloat32 Raw mono PCM at 16kHz, Float32 samples in [-1, 1] —
 *   the model's native sampling_rate. Convert Int16 PCM via
 *   `int16ToFloat32Pcm()` below before calling.
 */
export async function detectAudioEmotionWav2Vec2(pcm16kHzFloat32: Float32Array): Promise<LocalAudioDetectResult> {
  const start = performance.now();

  if (pcm16kHzFloat32.length < MIN_SAMPLES_16KHZ) {
    return { signal: null, latencyMs: performance.now() - start, errored: false };
  }

  try {
    // Loaded on first use, not at import time (see local-onnx-detect.ts).
    const { default: LocalAudioClassifier } = await import("./local-audio-classifier");
    const classifier = await LocalAudioClassifier.getInstance();
    const results = (await classifier(pcm16kHzFloat32, { topk: 6 })) as Array<{ label: string; score: number }>;
    const latencyMs = performance.now() - start;

    if (!Array.isArray(results) || results.length === 0) {
      return { signal: null, latencyMs, errored: false };
    }

    const predictions = [...results].sort((a, b) => b.score - a.score);
    const top = predictions[0];
    const label: EmotionLabel = WAV2VEC2_LABEL_MAP[top.label.toUpperCase()] ?? "neutral";
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
      source: "audio",
      at: Date.now(),
    };

    return { signal, latencyMs, errored: false, rawPredictions: predictions };
  } catch (err) {
    console.warn("[LocalAudioDetect] classification failed:", err);
    return { signal: null, latencyMs: performance.now() - start, errored: true };
  }
}

/** Converts 16-bit signed PCM (as delivered by server.ts's browser-mic capture, already at 16kHz) to the Float32 [-1, 1] range wav2vec2 expects. */
export function int16ToFloat32Pcm(buf: Buffer): Float32Array {
  const sampleCount = Math.floor(buf.length / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = buf.readInt16LE(i * 2) / 32768;
  }
  return out;
}
