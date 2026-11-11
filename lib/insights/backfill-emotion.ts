/**
 * Reprocesses a historical "emotion" session-log row's TEXT classification
 * through the current (fixed) engine, for the one-time backfill script
 * (scripts/backfill-emotion-labels.ts). See that script's header for why
 * this exists and what it does and doesn't touch.
 *
 * Text-only by design: the original acoustic reading's full VAD was never
 * stored (session_logs only kept `audioSignal: { label, confidence }`), so
 * there's no way to exactly replay the original fusion. Re-blending the new
 * text signal against a VAD reconstructed from the stored label/confidence
 * (via HF_VAD_MAP, the same approximation local-onnx-detect.ts and
 * local-audio-detect.ts already use when they only have a label+score) is
 * the closest honest approximation available — never fabricated from
 * nothing, and the original audioSignal field itself is left untouched.
 */
import type { EmotionLabel, EmotionSignal, VAD } from "../types";
import { detectTextEmotion, fuseEmotion } from "../emotion/detect";
import { classifyConfidence } from "../emotion/confidence";
import { HF_VAD_MAP } from "../emotion/emotion-label-map";
import { clamp } from "../util/math";

export interface StoredEmotionPayload {
  label: string;
  intensity: number;
  confidence: number;
  vad: VAD;
  textSignal?: { label: string; confidence: number; engine: string };
  audioSignal?: { label: string; confidence: number } | null;
  isMixed?: boolean;
}

export interface RecomputedEmotion {
  /** False when the new read doesn't meaningfully differ — caller should skip the write. */
  changed: boolean;
  label: EmotionLabel;
  intensity: number;
  confidence: number;
  confidenceCategory: ReturnType<typeof classifyConfidence>;
  vad: VAD;
  textSignal: { label: EmotionLabel; confidence: number; engine: string };
  isMixed: boolean;
}

/** ValenceTimeline.tsx's own gate: below this, a point renders as "Unclear"
 * regardless of label. A confidence move that doesn't cross this line looks
 * identical in the UI, so it isn't worth a write on its own. */
const VISIBILITY_THRESHOLD = 0.5;

/** Reconstructs an approximate EmotionSignal from a stored {label, confidence}
 * pair — the same approximation already used elsewhere in this codebase
 * (local-onnx-detect.ts, local-audio-detect.ts) when only a label/score is
 * available, not a full VAD reading. */
function reconstructSignal(stored: { label: string; confidence: number }): EmotionSignal {
  const label = (stored.label in HF_VAD_MAP ? stored.label : "neutral") as EmotionLabel;
  const base = HF_VAD_MAP[label];
  const confidence = clamp(stored.confidence, 0, 1);
  const vad: VAD = { v: base.v * confidence, a: base.a * confidence, d: base.d * confidence };
  const intensity = clamp(Math.sqrt(vad.v * vad.v + vad.a * vad.a + vad.d * vad.d) / Math.sqrt(3));
  return {
    label,
    intensity,
    confidence,
    confidenceCategory: classifyConfidence(confidence),
    vad,
    source: "audio",
    at: Date.now(),
  };
}

export async function recomputeEmotionForText(
  text: string,
  old: StoredEmotionPayload
): Promise<RecomputedEmotion> {
  const textResult = await detectTextEmotion(text);
  const audioSignal = old.audioSignal ? reconstructSignal(old.audioSignal) : null;
  const fused = fuseEmotion(textResult.primary, audioSignal);

  // A write is only worth making when something a viewer would actually SEE
  // changes: the label itself, or crossing the 0.5 "Unclear" gate
  // ValenceTimeline.tsx applies regardless of label. Pure confidence drift
  // that stays on the same side of that line (e.g. 0.65 → 0.60, both
  // clearly "confident") is real but invisible — not worth a write, and
  // writing it anyway would make every backfill run look noisier than the
  // changes that actually matter.
  const labelChanged = fused.label !== old.label;
  const crossedVisibilityGate = (old.confidence >= VISIBILITY_THRESHOLD) !== (fused.confidence >= VISIBILITY_THRESHOLD);

  return {
    changed: labelChanged || crossedVisibilityGate,
    label: fused.label,
    intensity: fused.intensity,
    confidence: fused.confidence,
    confidenceCategory: fused.confidenceCategory ?? classifyConfidence(fused.confidence),
    vad: fused.vad,
    textSignal: {
      label: textResult.primary.label,
      confidence: textResult.primary.confidence,
      engine: textResult.selection.engine,
    },
    isMixed: fused.isMixed ?? false,
  };
}
