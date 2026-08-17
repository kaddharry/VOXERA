import type { EmotionLabel, EmotionSignal, VAD } from "../types";
import { CONFIG } from "../config";
import { clamp } from "../util/math";
import { classifyConfidence } from "./confidence";
import { LEXICON } from "./lexicon";
import type { HFDetectResult } from "./ml-detect";
import { detectTextEmotionLocalONNX, type LocalOnnxDetectResult } from "./local-onnx-detect";

// HF (HuggingFace Inference API) engine was removed from the live pipeline —
// see the eval writeup in VOXERA_IMPLEMENTATION.md. It runs the exact same
// model as Local ONNX (j-hartmann/emotion-english-distilroberta-base) over
// the network instead of in-process, so it was never an independent second
// opinion, only a fallback for when Local ONNX failed to load. A 24-case
// scripted accuracy eval showed it never once changed the selected label —
// Local ONNX's in-process timeout/catch already degrades gracefully to the
// same "no signal" state HF would have. Keeping the network round trip in
// the hot path bought nothing but latency and an external dependency, so
// `detectTextEmotion` now stubs it to an always-unavailable result instead
// of calling it. `HFDetectResult`/`hf` stay in the return shape unchanged
// so existing diagnostics consumers (EngineDashboard, emotion-debug.ts)
// don't need to change their types — the field is just always empty now.
const HF_DISABLED_RESULT: HFDetectResult = { signal: null, latencyMs: 0, timedOut: false };

import MLClassifier from "./classifier";

// ─── Lexicon Engine ──────────────────────────────────────────────────────────

/**
 * Deterministic text emotion detector using keyword lexicon + punctuation cues.
 * Always returns synchronously (zero-latency).
 * Returns a calibrated EmotionSignal.
 */
export function detectTextEmotionLexicon(text: string): EmotionSignal & { matchedKeywords: string[] } {
  const labelScores: Partial<Record<EmotionLabel, number>> = {};
  const vadAcc: VAD = { v: 0, a: 0, d: 0 };
  let totalW = 0;
  const matchedKeywords: string[] = [];

  const negLabels = new Set<EmotionLabel>(["frustration", "anger", "distress", "sadness", "fear", "disappointment"]);
  const posLabels = new Set<EmotionLabel>(["joy", "gratitude", "excitement"]);
  let hasNegMatch = false;
  let hasPosMatch = false;

  // A negation cue ("not", "n't", "never", "no", "hardly", "barely") in the
  // ~20 chars right before a match flips the read entirely — the lexicon had
  // no negation handling at all, so "I'm not feeling good" matched the
  // "good" keyword and scored as pure JOY. Flip positive labels to their
  // negative counterpart on negation; drop negated negative-label matches
  // ("not angry") rather than guess a specific replacement label.
  const NEGATION_RE = /\b(?:not|n't|never|no|hardly|barely)\s+(?:\w+\s+){0,2}$/i;
  const POS_TO_NEG: Partial<Record<EmotionLabel, EmotionLabel>> = {
    joy: "sadness",
    gratitude: "disappointment",
    excitement: "disappointment",
  };

  for (const entry of LEXICON) {
    const flags = entry.kw.flags.includes("g") ? entry.kw.flags : entry.kw.flags + "g";
    const re = new RegExp(entry.kw.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const preceding = text.slice(Math.max(0, m.index - 20), m.index);
      const negated = NEGATION_RE.test(preceding);

      let label = entry.label;
      let vad = entry.vad;
      if (negated) {
        const flipped = POS_TO_NEG[label];
        if (flipped) {
          label = flipped;
          vad = { v: -vad.v, a: vad.a, d: -Math.abs(vad.d) };
        } else {
          // Negating an already-negative word ("not angry") — no confident
          // replacement label, so just skip this match instead of guessing.
          if (re.lastIndex === m.index) re.lastIndex++;
          continue;
        }
      }

      const w = entry.w;
      labelScores[label] = (labelScores[label] ?? 0) + w;
      vadAcc.v += vad.v * w;
      vadAcc.a += vad.a * w;
      vadAcc.d += vad.d * w;
      totalW += w;
      matchedKeywords.push(m[0]);
      if (negLabels.has(label)) hasNegMatch = true;
      if (posLabels.has(label)) hasPosMatch = true;
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }

  // Context-aware punctuation: !! and ??? boost arousal in the direction
  // of the already-detected valence, instead of blindly assuming frustration.
  const exclamCount = (text.match(/!{2,}/g) || []).length;
  const questionCount = (text.match(/\?{2,}/g) || []).length;
  if (exclamCount > 0) {
    const arousalBoost = 0.3 * exclamCount;
    vadAcc.a += arousalBoost;
    // If no negative keywords matched, treat !! as positive intensity amplifier
    if (!hasNegMatch) {
      vadAcc.v += 0.2 * exclamCount;
      labelScores["excitement"] = (labelScores["excitement"] ?? 0) + 0.4 * exclamCount;
    }
    totalW += arousalBoost;
  }
  if (questionCount > 0) {
    vadAcc.a += 0.1 * questionCount;
    labelScores["confusion"] = (labelScores["confusion"] ?? 0) + 0.3 * questionCount;
    totalW += 0.1 * questionCount;
  }

  // Caps boost arousal.
  const letters = text.replace(/[^A-Za-z]/g, "");
  const capsRatio = letters.length > 0 ? (text.match(/[A-Z]/g)?.length ?? 0) / letters.length : 0;
  if (capsRatio > 0.5 && letters.length > 6) {
    vadAcc.a += 0.4;
    totalW += 0.4;
  }

  let label: EmotionLabel = "neutral";
  let topScore = 0;
  for (const [k, v] of Object.entries(labelScores)) {
    if ((v ?? 0) > topScore) {
      topScore = v ?? 0;
      label = k as EmotionLabel;
    }
  }

  const vad: VAD =
    totalW === 0
      ? { v: 0, a: 0, d: 0 }
      : { v: clamp(vadAcc.v / totalW, -1, 1), a: clamp(vadAcc.a / totalW, -1, 1), d: clamp(vadAcc.d / totalW, -1, 1) };

  // Positivity safety net: if accumulated valence is clearly positive and arousal
  // is high, but the label ended up negative (e.g. due to thin lexicon overlap),
  // correct the label to excitement.
  if (vad.v > 0.2 && vad.a > 0.3 && negLabels.has(label) && hasPosMatch) {
    label = "excitement";
  }

  const intensity = clamp(Math.sqrt(vad.v * vad.v + vad.a * vad.a + vad.d * vad.d) / Math.sqrt(3));
  const confidence = clamp(totalW === 0 ? 0.5 : Math.min(1, 0.45 + 0.15 * totalW));

  // Mixed emotions safety net: if both positive and negative strong keywords hit,
  // we flag it as mixed so the persona engine can adapt and not just blindly celebrate.
  const isMixed = hasNegMatch && hasPosMatch;

  return {
    label,
    intensity,
    confidence,
    confidenceCategory: classifyConfidence(confidence),
    vad,
    source: "text",
    at: Date.now(),
    isMixed,
    matchedKeywords,
  };
}

// ─── Local ML Engine (SST-2 Sentiment — binary POSITIVE/NEGATIVE) ───────────

/**
 * Local ML classification using @xenova/transformers with DistilBERT-SST2.
 * NOTE: This is a 2-class sentiment model (POSITIVE/NEGATIVE), NOT a
 * multi-class emotion model. It can validate sentiment direction but cannot
 * distinguish between specific emotions (anger vs sadness vs fear).
 *
 * Used as a secondary check to validate lexicon direction, not as a primary
 * emotion classifier.
 */
export async function detectTextEmotionLocal(text: string): Promise<EmotionSignal> {
  const classifier = await MLClassifier.getInstance();

  // Predict POSITIVE/NEGATIVE using Deep Learning
  const results = await classifier(text) as { label: string; score: number }[];
  const sentiment = results[0]; // e.g., { label: "POSITIVE", score: 0.99 }

  // Get specific emotional nuance from lexicon
  const lexSignal = detectTextEmotionLexicon(text);

  // Hybrid Fusion Logic
  let label: EmotionLabel = lexSignal.label;
  let isOverride = false;

  // Only override neutral if ML is incredibly confident it's NEGATIVE
  if (lexSignal.label === "neutral" && lexSignal.confidence <= 0.5) {
    if (sentiment.score > 0.98 && sentiment.label === "NEGATIVE") {
      label = "frustration";
      isOverride = true;
    }
  } else {
    // If Lexicon found something, ensure it matches ML sentiment direction!
    const negativeLabels = ["anger", "frustration", "sadness", "distress", "fear", "disappointment"];
    const positiveLabels = ["joy", "gratitude", "excitement"];

    if (sentiment.label === "POSITIVE" && negativeLabels.includes(lexSignal.label) && sentiment.score > 0.9) {
      label = "joy";
      isOverride = true;
    } else if (sentiment.label === "NEGATIVE" && positiveLabels.includes(lexSignal.label) && sentiment.score > 0.9) {
      label = "frustration";
      isOverride = true;
    }
  }

  // Synthetic VAD map for when ML overrides the Lexicon
  const syntheticVadMap: Record<EmotionLabel, VAD> = {
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
    neutral: { v: 0, a: 0, d: 0 }
  };

  let vad = lexSignal.vad;
  let intensity = lexSignal.intensity;

  if (isOverride) {
    // Inject synthetic VAD scaled by ML confidence
    const base = syntheticVadMap[label];
    vad = {
      v: base.v * sentiment.score,
      a: base.a * sentiment.score,
      d: base.d * sentiment.score
    };
    intensity = clamp(Math.sqrt(vad.v*vad.v + vad.a*vad.a + vad.d*vad.d) / Math.sqrt(3));
  } else {
    // Boost Lexicon intensity by ML agreement
    intensity = clamp(lexSignal.intensity * (sentiment.score + 0.5));
  }

  // Probabilistic OR for confidence: 1 - (1 - P_lex) * (1 - P_ml)
  let confidence = clamp(1 - (1 - lexSignal.confidence) * (1 - sentiment.score));

  if (label === "neutral") {
    confidence = 0.5;
    intensity = 0;
    vad = { v: 0, a: 0, d: 0 };
  }

  return {
    label,
    intensity,
    confidence,
    confidenceCategory: classifyConfidence(confidence),
    vad,
    source: "text",
    at: Date.now(),
    isMixed: false,
  };
}

// ─── Small-talk guard ────────────────────────────────────────────────────────

/**
 * Both HF and the lexicon can misfire on short, content-free utterances —
 * e.g. HF has labeled a bare "How are you?" as confusion, which then forces
 * the confusion persona's "confirm understanding" language onto a reply to a
 * simple greeting. Guards ONLY against the whole utterance being one of these
 * near-universally neutral small-talk phrases (not merely containing one),
 * so genuine distress phrased as a question — "How am I supposed to deal
 * with this?" — is untouched.
 */
const SMALL_TALK_RE =
  /^(hi|hello|hey|yo|good\s*(morning|afternoon|evening))[.,!?\s]*$|^how(?:'s|s| is| are)\s+(you|it going|things|your day)\??$|^what'?s up\??$|^how'?s it going\??$/i;

function isSmallTalkGreeting(text: string): boolean {
  return SMALL_TALK_RE.test(text.trim());
}

function neutralSignal(): EmotionSignal {
  return {
    label: "neutral",
    intensity: 0,
    confidence: 0.9,
    confidenceCategory: classifyConfidence(0.9),
    vad: { v: 0, a: 0, d: 0 },
    source: "text",
    at: Date.now(),
    isMixed: false,
  };
}

// ─── Concurrent Universal Router ────────────────────────────────────────────

/**
 * Result from the concurrent text emotion detection pipeline.
 * Exposes both individual engine results for diagnostics.
 */
export interface TextEmotionResult {
  /** The selected primary signal used for downstream processing. */
  primary: EmotionSignal;
  /** Lexicon engine result (always available, zero-latency). */
  lexicon: EmotionSignal & { matchedKeywords: string[] };
  /** HuggingFace remote-API engine result (null if timed out or unavailable — usually just means no HF_TOKEN is set). */
  hf: HFDetectResult;
  /** Local ONNX engine result — the SAME underlying model as `hf` (j-hartmann/emotion-english-distilroberta-base), run in-process instead of over the network. No token, no network dependency. */
  localOnnx: LocalOnnxDetectResult;
  /** Which engine was selected as primary and why. */
  selection: { engine: "local_onnx" | "hf" | "lexicon"; reason: string };
}

/**
 * Universal text emotion router. Runs Local ONNX, HF, and Lexicon CONCURRENTLY.
 *
 * Local ONNX and HF are the same model (see local-onnx-detect.ts's header) —
 * Local ONNX just runs it in-process instead of over the network, so it has
 * no HF_TOKEN dependency and no network round trip. Preferred over HF
 * whenever it returns a signal within budget; HF (remote) is a fallback for
 * environments where the local model failed to load, not a genuinely
 * independent second opinion.
 *
 * Selection priority is NOT "ML wins whenever available" — the lexicon wins
 * outright whenever it produced a real keyword match (deliberately hand-
 * tuned, including negation handling the ML model has no equivalent for).
 * This matters structurally, not just stylistically: VOXERA's lexicon
 * expresses 12 emotion labels, but the 7-class model behind Local ONNX/HF
 * (j-hartmann/emotion-english-distilroberta-base) maps to only 6 of them via
 * HF_LABEL_MAP (anger, frustration, fear, joy, neutral, excitement) — it has
 * no output class for distress, gratitude, confusion, disappointment, or
 * calm. A confident ML prediction on one of those is worthless evidence
 * against a lexicon match: the model isn't disagreeing, it's structurally
 * incapable of naming the thing. This matters most for `distress`, which
 * drives safety/escalation handling elsewhere — collapsing "I'm scared and
 * desperate" to the model's closest bucket (`fear`) would be a real
 * regression, not just a labeling nuance. The ML model (Local ONNX, else HF)
 * only gets to decide when the lexicon found nothing and is sitting on its
 * bare default.
 *
 * Design:
 *   Local ONNX ──→ result (races against its latency budget)
 *   HF ─────────→ result (races against its latency budget)
 *   Lexicon ────→ result (instant, always ready)
 *
 * All three results are always returned for diagnostic comparison.
 */
export async function detectTextEmotion(text: string): Promise<TextEmotionResult> {
  // Lexicon is synchronous/instant — run it first. Its two early-exit cases
  // below (small-talk guard, real keyword match) are both deterministic and
  // already ignore whatever Local ONNX would say, so there is nothing to
  // gain by waiting on Local ONNX's up-to-500ms budget in either case. Only
  // fall through to actually awaiting Local ONNX when the lexicon is sitting
  // on its bare default and its answer would actually be used.
  const lexiconResult = detectTextEmotionLexicon(text);

  // Small-talk guard: overrides all engines when the whole utterance is a
  // bare greeting/small-talk phrase and the lexicon found no real keyword
  // hit — cheap ML models routinely mislabel these ("How are you?" → confusion).
  if (isSmallTalkGreeting(text) && lexiconResult.confidence <= 0.5) {
    const neutral = neutralSignal();
    return {
      primary: neutral,
      lexicon: lexiconResult,
      hf: HF_DISABLED_RESULT,
      localOnnx: { signal: null, latencyMs: 0, errored: false },
      selection: { engine: "lexicon", reason: "Small-talk guard: bare greeting, forced neutral" },
    };
  }

  // Lexicon wins outright on a real keyword match — deliberate, hand-tuned
  // evidence beats a generic classifier's guess, and is the ONLY way to
  // reach the 5 labels the ML model structurally can't express.
  if (lexiconResult.matchedKeywords.length > 0) {
    return {
      primary: lexiconResult,
      lexicon: lexiconResult,
      hf: HF_DISABLED_RESULT,
      localOnnx: { signal: null, latencyMs: 0, errored: false },
      selection: {
        engine: "lexicon",
        reason: `Lexicon matched keyword(s) [${lexiconResult.matchedKeywords.join(", ")}] → label=${lexiconResult.label}`,
      },
    };
  }

  // Lexicon found nothing (bare default) — only now is it worth paying for
  // Local ONNX's latency budget, since its answer will actually be used.
  const localOnnxBudgetMs = CONFIG.emotion.localOnnxLatencyBudgetMs;
  const localOnnxResult = await Promise.race([
    detectTextEmotionLocalONNX(text).catch((err): LocalOnnxDetectResult => {
      console.warn("[EmotionRouter] Local ONNX detection threw:", err);
      return { signal: null, latencyMs: 0, errored: true };
    }),
    new Promise<LocalOnnxDetectResult>((resolve) =>
      setTimeout(() => resolve({ signal: null, latencyMs: localOnnxBudgetMs, errored: false }), localOnnxBudgetMs)
    ),
  ]);

  if (localOnnxResult.signal) {
    return {
      primary: localOnnxResult.signal,
      lexicon: lexiconResult,
      hf: HF_DISABLED_RESULT,
      localOnnx: localOnnxResult,
      selection: {
        engine: "local_onnx",
        reason: `Lexicon found no keyword match; Local ONNX returned in ${localOnnxResult.latencyMs.toFixed(1)}ms with label=${localOnnxResult.signal.label} conf=${localOnnxResult.signal.confidence.toFixed(3)}`,
      },
    };
  }

  // Fallback: use lexicon's bare default. (HF used to be tried here as a
  // second fallback — removed, see note above; it was never independently
  // more likely to succeed than Local ONNX, just slower.)
  const reason = localOnnxResult.errored
    ? "Lexicon found no keyword match; Local ONNX errored, using lexicon default"
    : "Lexicon found no keyword match; Local ONNX unavailable/timed out, using lexicon default";

  return {
    primary: lexiconResult,
    lexicon: lexiconResult,
    hf: HF_DISABLED_RESULT,
    localOnnx: localOnnxResult,
    selection: { engine: "lexicon", reason },
  };
}

// ─── Emotion Fusion ─────────────────────────────────────────────────────────

/**
 * Late fusion per §3.1: confidence-weighted mix of VAD and label distributions
 * between text and audio emotion signals.
 *
 * Improvements over original:
 * - Minimum confidence threshold: if both < fusionMinConfidence, return neutral
 * - Confidence margin: winner must have at least fusionConfidenceMargin higher
 *   confidence than loser, otherwise text wins (tie-breaking toward semantic)
 * - Preserves isMixed flag from text signal
 * - Attaches individual signals for diagnostics
 * - Multi-class weighted fusion (Ticket 4): text and audio aren't blended in
 *   raw-confidence proportion alone — a fixed priority weight is applied on
 *   top, text-heavy (70/30) when text is confident and specific, acoustic-
 *   heavy (40/60) when text is vague/low-confidence (e.g. a flat "okay" said
 *   in a shaky, high-arousal voice — the tone carries more signal than the
 *   word there). Both the VAD blend and the label-selection margin check use
 *   these weighted confidences, so the priority actually changes outcomes,
 *   not just the reported number.
 */
export function fuseEmotion(
  text: EmotionSignal,
  audio: EmotionSignal | null
): EmotionSignal & { textSignal?: EmotionSignal; audioSignal?: EmotionSignal | null } {
  if (!audio) {
    return { ...text, source: "fused", textSignal: text, audioSignal: null };
  }

  const { fusionConfidenceMargin, fusionMinConfidence } = CONFIG.emotion;

  // If both engines have very low confidence, default to neutral
  if (text.confidence < fusionMinConfidence && audio.confidence < fusionMinConfidence) {
    return {
      label: "neutral",
      intensity: 0,
      confidence: Math.max(text.confidence, audio.confidence),
      confidenceCategory: classifyConfidence(Math.max(text.confidence, audio.confidence)),
      vad: { v: 0, a: 0, d: 0 },
      source: "fused",
      at: Date.now(),
      textSignal: text,
      audioSignal: audio,
    };
  }

  // Text-heavy 70/30 when text is confident and specific (>0.7); otherwise
  // acoustic-heavy 40/60 — text is vague/conversational, so acoustic tone
  // is given more say than its raw confidence alone would earn it.
  const textWeight = text.confidence > 0.7 ? 0.7 : 0.4;
  const audioWeight = 1 - textWeight;

  // Weighted VAD blending
  const vad: VAD = {
    v: audio.vad.v * audioWeight + text.vad.v * textWeight,
    a: audio.vad.a * audioWeight + text.vad.a * textWeight,
    d: audio.vad.d * audioWeight + text.vad.d * textWeight,
  };

  // Label selection: apply the same priority weight to each engine's
  // confidence, then require the usual margin to override — so a low-
  // confidence text read doesn't get to override a strong acoustic signal
  // just by having a numerically higher raw confidence.
  const weightedText = text.confidence * textWeight;
  const weightedAudio = audio.confidence * audioWeight;
  let label: EmotionLabel;
  if (weightedAudio > weightedText + fusionConfidenceMargin) {
    label = audio.label;
  } else if (weightedText > weightedAudio + fusionConfidenceMargin) {
    label = text.label;
  } else {
    // Within margin: prefer text (semantic meaning is generally more reliable)
    label = text.label;
  }

  const intensity = clamp(Math.sqrt(vad.v * vad.v + vad.a * vad.a + vad.d * vad.d) / Math.sqrt(3));
  const confidence = clamp((audio.confidence + text.confidence) / 2 + 0.05);

  return {
    label,
    intensity,
    confidence,
    confidenceCategory: classifyConfidence(confidence),
    vad,
    source: "fused",
    at: Date.now(),
    isMixed: text.isMixed,
    textSignal: text,
    audioSignal: audio,
  };
}
