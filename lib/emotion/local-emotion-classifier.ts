import { pipeline, env, TextClassificationPipeline } from '@xenova/transformers';
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_CACHE_DIR } from '../util/model-cache';

/**
 * Local 7-class emotion model (ONNX), run in-process via @xenova/transformers.
 * This is a community ONNX conversion of j-hartmann/emotion-english-distilroberta-base
 * (the same model lib/emotion/ml-detect.ts calls remotely via the HuggingFace Inference
 * API) — running it locally removes the network round-trip and the 200ms latency budget
 * risk for that engine. Unlike lib/emotion/classifier.ts (a 2-class sentiment model, kept
 * as an unused/legacy path — see its header comment), this produces the full 7-class
 * anger/disgust/fear/joy/neutral/sadness/surprise distribution.
 *
 * Diagnostic-only for now (Phase 1): available to lib/emotion/emotion-debug.ts for
 * side-by-side comparison against the remote HF and Lexicon engines. Not wired into the
 * production detectTextEmotion() router yet — that decision belongs to Phase 2, once
 * comparative accuracy data has been collected.
 *
 * Known compatibility fix: this repo's tokenizer.json was exported by a newer version of
 * the `tokenizers` library that serializes BPE `merges` as an array of [a, b] pairs, but
 * @xenova/transformers@2.17.2's tokenizer loader expects each merge as a single "a b"
 * string and calls `.split(" ")` on it — a version mismatch, not specific to this model.
 * We pre-populate the library's on-disk file cache with a patched tokenizer.json (merges
 * normalized to strings) before instantiating the pipeline, so its own cache lookup finds
 * our patched copy instead of fetching the incompatible one.
 */

const MODEL_ID = 'nicky48/emotion-english-distilroberta-base-ONNX';
const CACHE_DIR = MODEL_CACHE_DIR;

env.allowLocalModels = true;
env.useBrowserCache = false;
env.useFSCache = true;
env.cacheDir = CACHE_DIR + path.sep;

async function ensurePatchedTokenizer(): Promise<void> {
  const tokenizerPath = path.join(CACHE_DIR, MODEL_ID, 'tokenizer.json');
  if (fs.existsSync(tokenizerPath)) return;

  const res = await fetch(`https://huggingface.co/${MODEL_ID}/raw/main/tokenizer.json`);
  if (!res.ok) throw new Error(`Failed to fetch tokenizer.json for patching: ${res.status}`);
  const tokenizerJson = await res.json();

  const merges = tokenizerJson?.model?.merges;
  if (Array.isArray(merges) && merges.length > 0 && Array.isArray(merges[0])) {
    tokenizerJson.model.merges = merges.map((pair: [string, string]) => pair.join(' '));
  }

  await fs.promises.mkdir(path.dirname(tokenizerPath), { recursive: true });
  await fs.promises.writeFile(tokenizerPath, JSON.stringify(tokenizerJson));
}

class LocalEmotionClassifier {
  static task = 'text-classification';
  static model = MODEL_ID;
  static instance: TextClassificationPipeline | null = null;
  static loadError: Error | null = null;

  static async getInstance(progress_callback?: (progress: any) => void): Promise<TextClassificationPipeline> {
    if (this.loadError) throw this.loadError;
    if (this.instance === null) {
      try {
        await ensurePatchedTokenizer();
        // @ts-expect-error - transformers.js types are sometimes loose
        this.instance = (await pipeline(this.task, this.model, {
          progress_callback,
        })) as TextClassificationPipeline;
      } catch (err) {
        this.loadError = err instanceof Error ? err : new Error(String(err));
        throw this.loadError;
      }
    }
    return this.instance;
  }
}

export default LocalEmotionClassifier;
