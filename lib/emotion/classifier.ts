/**
 * NOT PART OF THE PRODUCTION EMOTION PATH.
 *
 * This is a local 2-class sentiment model (POSITIVE/NEGATIVE only — it cannot
 * distinguish anger from sadness from fear). It backs `detectTextEmotionLocal()`
 * in lib/emotion/detect.ts, which nothing in the production orchestrator calls
 * (the router in detect.ts only runs the remote HF 7-class model and the
 * Lexicon engine — see detectTextEmotion()).
 *
 * Kept in place as a possible future tertiary fallback / sentiment sanity-check,
 * not removed. For real local emotion classification, see
 * lib/emotion/local-emotion-classifier.ts (7-class ONNX model).
 */
import { pipeline, env, TextClassificationPipeline } from '@xenova/transformers';
import path from 'node:path';
import { MODEL_CACHE_DIR } from '../util/model-cache';

// Configure environment for Node.js
env.allowLocalModels = true;
env.useBrowserCache = false;
env.cacheDir = MODEL_CACHE_DIR + path.sep;

class MLClassifier {
  static task = 'text-classification';
  static model = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
  static instance: TextClassificationPipeline | null = null;

  static async getInstance(progress_callback?: (progress: any) => void): Promise<TextClassificationPipeline> {
    if (this.instance === null) {
      // @ts-expect-error - transformers.js types are sometimes loose
      this.instance = (await pipeline(this.task, this.model, { 
        progress_callback 
      })) as TextClassificationPipeline;
    }
    return this.instance;
  }
}

export default MLClassifier;
