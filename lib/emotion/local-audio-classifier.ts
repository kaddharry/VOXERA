import { pipeline, env, AudioClassificationPipeline } from '@xenova/transformers';
import path from 'node:path';
import { MODEL_CACHE_DIR } from '../util/model-cache';

/**
 * Local acoustic speech-emotion-recognition (ONNX), run in-process via
 * @xenova/transformers — a real trained model (Wav2Vec2ForSequenceClassification,
 * fine-tuned for 6-class SER: sad/angry/disgust/fear/happy/neutral), distinct
 * from lib/emotion/audio-emotion.ts's hand-written DSP heuristic scorer.
 *
 * Model choice: emotion2vec+ (the usual first recommendation for this) has no
 * ONNX export — an open, unresolved GitHub issue in the FunASR repo asks for
 * one. This model (onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX)
 * is a pre-converted, ready-to-run ONNX model with a permissive license,
 * verified live: ~91MB quantized download, ~56s cold load, ~330ms inference
 * once warm. Expects raw mono PCM at 16kHz (its native sampling_rate, per
 * preprocessor_config.json) as Float32 samples in [-1, 1] — see
 * local-audio-detect.ts for the conversion from Int16 PCM.
 *
 * Diagnostic-only for now: available to lib/emotion/emotion-debug.ts for
 * side-by-side comparison against the DSP heuristic engine. Not wired into
 * production fusion (fuseEmotion()) — its accuracy against real
 * telephony-quality audio (vs. clean studio recordings its training data
 * likely used) hasn't been validated yet, same reasoning that kept the local
 * text-emotion ONNX model diagnostic-only before its Phase 2 promotion.
 */
const MODEL_ID = 'onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX';
const CACHE_DIR = MODEL_CACHE_DIR;

env.allowLocalModels = true;
env.useBrowserCache = false;
env.useFSCache = true;
env.cacheDir = CACHE_DIR + path.sep;

class LocalAudioClassifier {
  static task = 'audio-classification';
  static model = MODEL_ID;
  static instance: AudioClassificationPipeline | null = null;
  static loadError: Error | null = null;

  static async getInstance(progress_callback?: (progress: any) => void): Promise<AudioClassificationPipeline> {
    if (this.loadError) throw this.loadError;
    if (this.instance === null) {
      try {
        // @ts-expect-error - transformers.js types are sometimes loose
        this.instance = (await pipeline(this.task, this.model, {
          progress_callback,
        })) as AudioClassificationPipeline;
      } catch (err) {
        this.loadError = err instanceof Error ? err : new Error(String(err));
        throw this.loadError;
      }
    }
    return this.instance;
  }
}

export default LocalAudioClassifier;
