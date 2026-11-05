import type { EmotionLabel, EmotionSignal, VAD } from "../types";
import { CONFIG } from "../config";
import { clamp } from "../util/math";
import { classifyConfidence } from "./confidence";
import { HF_VAD_MAP } from "./emotion-label-map";
import { XLM_EMO_LABEL_MAP } from "./xlm-emo-label-map";

/**
 * Multilingual text-emotion detection for non-English calls — HuggingFace
 * remote API, MilaNLProc/xlm-emo-t (see xlm-emo-label-map.ts for the label
 * caveats). Mirrors ml-detect.ts's HF-call pattern exactly (same timeout
 * handling, same response shape) since no ONNX/transformers.js conversion
 * of this model exists to run it locally the way local-onnx-detect.ts does
 * for the English model — this is a real remote-network dependency with the
 * same HF_TOKEN requirement and failure modes the English HF path already
 * has (and already tolerates: the caller falls back to the lexicon default
 * on any failure/timeout, same as detect.ts's English router does).
 */

const XLM_EMO_API_URL = "https://api-inference.huggingface.co/models/MilaNLProc/xlm-emo-t";

export interface XlmEmoDetectResult {
  signal: EmotionSignal | null;
  latencyMs: number;
  timedOut: boolean;
  rawPredictions?: Array<{ label: string; score: number }>;
}

export async function detectTextEmotionXLMEmo(text: string): Promise<XlmEmoDetectResult> {
  const start = performance.now();
  const token = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
  const budgetMs = CONFIG.emotion.hfLatencyBudgetMs;

  if (!token || !text.trim()) {
    return { signal: null, latencyMs: performance.now() - start, timedOut: false };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), budgetMs);

  try {
    const res = await fetch(XLM_EMO_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text }),
      signal: controller.signal,
    });

    if (!res.ok) {
      clearTimeout(timeoutId);
      return { signal: null, latencyMs: performance.now() - start, timedOut: false };
    }

    const data = await res.json();
    clearTimeout(timeoutId);

    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      return { signal: null, latencyMs: performance.now() - start, timedOut: false };
    }

    const predictions = data[0] as Array<{ label: string; score: number }>;
    if (predictions.length === 0) {
      return { signal: null, latencyMs: performance.now() - start, timedOut: false };
    }

    predictions.sort((a, b) => b.score - a.score);
    const top = predictions[0];
    const label: EmotionLabel = XLM_EMO_LABEL_MAP[top.label.toLowerCase()] || "neutral";
    const confidence = clamp(top.score, 0, 1);

    const vad = HF_VAD_MAP[label];
    const scaledVad: VAD = {
      v: vad.v * confidence,
      a: vad.a * confidence,
      d: vad.d * confidence,
    };
    const intensity = clamp(
      Math.sqrt(scaledVad.v * scaledVad.v + scaledVad.a * scaledVad.a + scaledVad.d * scaledVad.d) / Math.sqrt(3)
    );

    const signal: EmotionSignal = {
      label,
      intensity,
      confidence,
      confidenceCategory: classifyConfidence(confidence),
      vad: scaledVad,
      source: "text",
      at: Date.now(),
    };

    return { signal, latencyMs: performance.now() - start, timedOut: false, rawPredictions: predictions };
  } catch {
    clearTimeout(timeoutId);
    const elapsed = performance.now() - start;
    return { signal: null, latencyMs: elapsed, timedOut: elapsed >= budgetMs * 0.9 };
  }
}
