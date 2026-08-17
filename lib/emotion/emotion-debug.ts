import type { AcousticFeatures, EmotionLabel, EmotionSignal, MemoryTier, MemoryRecord, Utterance, VAD } from "../types";
import { CONFIG } from "../config";
import type { HFDetectResult } from "./ml-detect";
import { detectTextEmotionLexicon, fuseEmotion, type TextEmotionResult } from "./detect";
import { detectTextEmotionLocalONNX, type LocalOnnxDetectResult } from "./local-onnx-detect";
import { detectAudioEmotion } from "./audio-emotion";
import { detectAudioEmotionWav2Vec2, type LocalAudioDetectResult } from "./local-audio-detect";
import { buildEmotionContext } from "./context";
import { importanceScore, taskCriticality, policyFlag } from "./importance";

/** Always-empty HF result — HF was removed from the pipeline (see detect.ts);
 * `hf`/`EngineDiagnostic["engine"] === "hf"` stay in these shapes only so
 * existing diagnostics consumers don't need type changes for a field that's
 * now permanently unavailable. */
const HF_DISABLED_RESULT: HFDetectResult = { signal: null, latencyMs: 0, timedOut: false };

/**
 * Per-engine diagnostic breakdown — Phase 1 instrumentation (see the
 * "Emotion Engine Overhaul" issue). Lets Lexicon, Local ONNX, Acoustic
 * (DSP heuristic), and Acoustic ML (wav2vec2) be compared side-by-side for
 * the same input, independent of which one production selects as primary.
 * HF is no longer run (see detect.ts) and always reports unavailable.
 */
export interface EngineDiagnostic {
  engine: "hf" | "lexicon" | "local_onnx" | "acoustic" | "acoustic_ml";
  available: boolean;
  label: EmotionLabel | null;
  confidence: number | null;
  intensity: number | null;
  vad: VAD | null;
  latencyMs: number;
  timedOut?: boolean;
  matchedKeywords?: string[];
  /** How this engine's signal alone would score for memory importance/tier, holding novelty/recurrence fixed across engines for a fair comparison. */
  importance: number | null;
  memoryClassification: MemoryTier | "discarded" | null;
  unavailableReason?: string;
  /** Acoustic-only: the raw physical DSP metrics the label was derived from
   * (Ticket 4 — expose individual metrics, not just the mapped label). */
  rawMetrics?: {
    pitchHz: number;
    rmsEnergy: number;
    zeroCrossingRate: number;
    speakingRateWPM: number;
    decibels?: number;
  } | null;
}

export interface DiagnosticEmotionResult {
  text: string;
  hf: EngineDiagnostic;
  lexicon: EngineDiagnostic;
  localOnnx: EngineDiagnostic;
  acoustic: EngineDiagnostic | null;
  /** wav2vec2-based acoustic ML engine — null whenever raw 16kHz audio wasn't supplied (e.g. telephony, which is 8kHz mulaw natively). */
  acousticMl: EngineDiagnostic | null;
  fusion: {
    /** Which engine detectTextEmotion() actually selected as primary in production. */
    textSelection: TextEmotionResult["selection"];
    final: EmotionSignal & { textSignal?: EmotionSignal; audioSignal?: EmotionSignal | null };
  };
  totalLatencyMs: number;
}

/** Fixed placeholders so importance is comparable *across engines* for the same input, without the cost of a real embedding/retrieval call per engine. */
const DIAGNOSTIC_NOVELTY = 1;
const DIAGNOSTIC_RECURRENCE = 1;

function classifyTier(importance: number): MemoryTier | "discarded" {
  const { mtm, ltm } = CONFIG.memory.tierThresholds;
  if (importance < mtm) return "discarded";
  if (importance < ltm) return "MTM";
  return "LTM_user";
}

function scoreSignal(
  text: string,
  signal: EmotionSignal | null,
  history: { stm: Utterance[]; ltmUser: MemoryRecord[] }
): { importance: number | null; memoryClassification: MemoryTier | "discarded" | null } {
  if (!signal) return { importance: null, memoryClassification: null };
  const ctx = buildEmotionContext({ current: signal, stm: history.stm, ltmUser: history.ltmUser });
  const importance = importanceScore({
    text,
    emotion: ctx,
    novelty: DIAGNOSTIC_NOVELTY,
    recurrence: DIAGNOSTIC_RECURRENCE,
    taskCriticality: taskCriticality(text),
    policyFlag: policyFlag(ctx),
  });
  return { importance, memoryClassification: classifyTier(importance) };
}

/**
 * Runs HF, Lexicon, Local ONNX, and (if features provided) Acoustic
 * concurrently and returns a full side-by-side comparison, plus the same
 * fusion result production would have selected. Diagnostic-only — does not
 * affect the production detectTextEmotion()/fuseEmotion() behavior, it just
 * runs alongside it. Callers should gate this behind CONFIG.emotion.diagnosticMode.
 *
 * `precomputed` lets a caller that already ran detectTextEmotion() (HF +
 * Lexicon), detectAudioEmotion(), and/or detectTextEmotionLocalONNX() pass
 * those results straight through instead of this function re-running them
 * from scratch — a real-time caller doing both the production turn and a
 * diagnostics breakdown on every turn would otherwise pay for a second HF
 * API round trip it doesn't need.
 *
 * `rawAudio16kHz` (raw mono PCM, Float32 in [-1, 1], the browser-mic
 * capture's native rate) runs the wav2vec2 acoustic ML engine (see
 * local-audio-detect.ts) alongside everything else. Omit it (e.g. for
 * telephony, which is 8kHz mulaw) and `acousticMl` comes back null — no
 * attempt to resample, that's a separate, unvalidated step.
 */
export async function runDiagnosticEmotion(
  text: string,
  acousticFeatures?: AcousticFeatures,
  history: { stm: Utterance[]; ltmUser: MemoryRecord[] } = { stm: [], ltmUser: [] },
  precomputed?: {
    textEmoResult: TextEmotionResult;
    audioSignal: EmotionSignal | null;
    localOnnxResult: LocalOnnxDetectResult;
  },
  rawAudio16kHz?: Float32Array
): Promise<DiagnosticEmotionResult> {
  const start = performance.now();

  const hfResult: HFDetectResult = HF_DISABLED_RESULT;
  let lexiconResult: ReturnType<typeof detectTextEmotionLexicon>;
  let localOnnxResult: LocalOnnxDetectResult;

  // Kick off the (potentially slow, cold-start-loaded — verified live: ~56s
  // cold, ~330ms warm) wav2vec2 classifier concurrently with everything else
  // rather than after it, so its latency overlaps instead of stacking on
  // top. Unlike the text ONNX engine, this call previously had no timeout at
  // all, so a cold load could single-handedly stall an entire live turn —
  // raced against a budget the same way localOnnxLatencyBudgetMs already
  // bounds the text engine.
  const audioMlBudgetMs = CONFIG.emotion.localAudioMlLatencyBudgetMs;
  const acousticMlPromise: Promise<LocalAudioDetectResult | null> = rawAudio16kHz
    ? Promise.race([
        detectAudioEmotionWav2Vec2(rawAudio16kHz).catch((err): LocalAudioDetectResult => {
          console.warn("[EmotionDiagnostic] wav2vec2 threw:", err);
          return { signal: null, latencyMs: 0, errored: true };
        }),
        new Promise<LocalAudioDetectResult>((resolve) =>
          setTimeout(() => resolve({ signal: null, latencyMs: audioMlBudgetMs, errored: false }), audioMlBudgetMs)
        ),
      ])
    : Promise.resolve(null);

  if (precomputed) {
    lexiconResult = precomputed.textEmoResult.lexicon;
    localOnnxResult = precomputed.localOnnxResult;
  } else {
    // No precomputed results — run Lexicon + Local ONNX concurrently.
    [lexiconResult, localOnnxResult] = await Promise.all([
      Promise.resolve(detectTextEmotionLexicon(text)),
      detectTextEmotionLocalONNX(text),
    ]);
  }

  const audioSignal = precomputed
    ? precomputed.audioSignal
    : (acousticFeatures ? detectAudioEmotion(acousticFeatures) : null);

  const acousticMlResult = await acousticMlPromise;

  const hfScore = scoreSignal(text, hfResult.signal, history);
  const lexiconScore = scoreSignal(text, lexiconResult, history);
  const localOnnxScore = scoreSignal(text, localOnnxResult.signal, history);
  const acousticScore = scoreSignal(text, audioSignal, history);
  const acousticMlScore = scoreSignal(text, acousticMlResult?.signal ?? null, history);

  const hf: EngineDiagnostic = {
    engine: "hf",
    available: !!hfResult.signal,
    label: hfResult.signal?.label ?? null,
    confidence: hfResult.signal?.confidence ?? null,
    intensity: hfResult.signal?.intensity ?? null,
    vad: hfResult.signal?.vad ?? null,
    latencyMs: hfResult.latencyMs,
    timedOut: hfResult.timedOut,
    importance: hfScore.importance,
    memoryClassification: hfScore.memoryClassification,
    unavailableReason: "removed — same model as Local ONNX, scrapped after eval showed zero accuracy benefit",
  };

  const lexicon: EngineDiagnostic = {
    engine: "lexicon",
    available: true,
    label: lexiconResult.label,
    confidence: lexiconResult.confidence,
    intensity: lexiconResult.intensity,
    vad: lexiconResult.vad,
    latencyMs: 0,
    matchedKeywords: lexiconResult.matchedKeywords,
    importance: lexiconScore.importance,
    memoryClassification: lexiconScore.memoryClassification,
  };

  const localOnnx: EngineDiagnostic = {
    engine: "local_onnx",
    available: !!localOnnxResult.signal,
    label: localOnnxResult.signal?.label ?? null,
    confidence: localOnnxResult.signal?.confidence ?? null,
    intensity: localOnnxResult.signal?.intensity ?? null,
    vad: localOnnxResult.signal?.vad ?? null,
    latencyMs: localOnnxResult.latencyMs,
    importance: localOnnxScore.importance,
    memoryClassification: localOnnxScore.memoryClassification,
    unavailableReason: localOnnxResult.signal ? undefined : localOnnxResult.errored ? "model failed to load/classify" : "no signal",
  };

  const acoustic: EngineDiagnostic | null = acousticFeatures
    ? {
        engine: "acoustic",
        available: !!audioSignal,
        label: audioSignal?.label ?? null,
        confidence: audioSignal?.confidence ?? null,
        intensity: audioSignal?.intensity ?? null,
        vad: audioSignal?.vad ?? null,
        latencyMs: 0,
        importance: acousticScore.importance,
        memoryClassification: acousticScore.memoryClassification,
        unavailableReason: audioSignal ? undefined : "audio too short (<500ms)",
        rawMetrics: {
          pitchHz: acousticFeatures.pitchHz,
          rmsEnergy: acousticFeatures.rmsEnergy,
          zeroCrossingRate: acousticFeatures.zeroCrossingRate,
          speakingRateWPM: acousticFeatures.speakingRateWPM,
          decibels: acousticFeatures.decibels,
        },
      }
    : null;

  const acousticMl: EngineDiagnostic | null = rawAudio16kHz
    ? {
        engine: "acoustic_ml",
        available: !!acousticMlResult?.signal,
        label: acousticMlResult?.signal?.label ?? null,
        confidence: acousticMlResult?.signal?.confidence ?? null,
        intensity: acousticMlResult?.signal?.intensity ?? null,
        vad: acousticMlResult?.signal?.vad ?? null,
        latencyMs: acousticMlResult?.latencyMs ?? 0,
        importance: acousticMlScore.importance,
        memoryClassification: acousticMlScore.memoryClassification,
        unavailableReason: acousticMlResult?.signal
          ? undefined
          : acousticMlResult?.errored
            ? "model failed to load/classify"
            : "audio too short (<500ms)",
      }
    : null;

  // Mirror the production selection logic in detect.ts:detectTextEmotion()
  // exactly — lexicon wins outright on any real keyword match (deliberate,
  // hand-tuned, and the only way to reach the 5 labels the ML model's
  // 7-class output space can't express at all); the ML model only decides
  // when the lexicon found nothing — so `fusion.textSelection` reflects what
  // the live pipeline actually chose.
  const textSelection: TextEmotionResult["selection"] =
    lexiconResult.matchedKeywords.length > 0
      ? {
          engine: "lexicon",
          reason: `Lexicon matched keyword(s) [${lexiconResult.matchedKeywords.join(", ")}] → label=${lexiconResult.label}`,
        }
      : localOnnxResult.signal
        ? {
            engine: "local_onnx",
            reason: `Lexicon found no keyword match; Local ONNX returned in ${localOnnxResult.latencyMs.toFixed(1)}ms with label=${localOnnxResult.signal.label} conf=${localOnnxResult.signal.confidence.toFixed(3)}`,
          }
        : {
            engine: "lexicon",
            reason: localOnnxResult.errored
              ? "Lexicon found no keyword match; Local ONNX errored, using lexicon default"
              : "Lexicon found no keyword match; Local ONNX unavailable/timed out, using lexicon default",
          };
  const textPrimary =
    textSelection.engine === "local_onnx" && localOnnxResult.signal ? localOnnxResult.signal : lexiconResult;
  const final = fuseEmotion(textPrimary, audioSignal);

  return {
    text,
    hf,
    lexicon,
    localOnnx,
    acoustic,
    acousticMl,
    fusion: { textSelection, final },
    totalLatencyMs: performance.now() - start,
  };
}
