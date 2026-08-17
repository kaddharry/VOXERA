import { pipeline, env, type FeatureExtractionPipeline } from "@xenova/transformers";
import path from "node:path";

/**
 * Local semantic embedding model (ONNX), run in-process via @xenova/transformers —
 * same pattern as lib/emotion/local-emotion-classifier.ts's singleton pipeline.
 *
 * Model: Xenova/bge-small-en-v1.5 — a 384-dim sentence embedder (BAAI's BGE-small,
 * ONNX-converted for transformers.js). Replaces both the remote OpenAI
 * text-embedding-3-small call (a network round trip on every turn) and the
 * bag-of-words hash embedder that was silently the ACTUAL embedder in production
 * whenever OPENAI_API_KEY wasn't set (it produces no real semantic signal — cosine
 * similarity is driven by literal token overlap, which is why retrieval kept
 * surfacing the same few knowledge chunks regardless of query topic). This runs
 * fully in-process, no network dependency, no per-call cost.
 */
const MODEL_ID = "Xenova/bge-small-en-v1.5";
const CACHE_DIR = path.resolve(process.cwd(), ".cache", "xenova");

env.allowLocalModels = true;
env.useBrowserCache = false;
env.useFSCache = true;
env.cacheDir = CACHE_DIR + path.sep;

class LocalEmbedder {
  static task = "feature-extraction" as const;
  static model = MODEL_ID;
  static instance: FeatureExtractionPipeline | null = null;
  static loadError: Error | null = null;

  static async getInstance(): Promise<FeatureExtractionPipeline> {
    if (this.loadError) throw this.loadError;
    if (this.instance === null) {
      try {
        this.instance = (await pipeline(this.task, this.model)) as FeatureExtractionPipeline;
      } catch (err) {
        this.loadError = err instanceof Error ? err : new Error(String(err));
        throw this.loadError;
      }
    }
    return this.instance;
  }
}

/** Output dimension of Xenova/bge-small-en-v1.5. */
export const LOCAL_EMBED_DIM = 384;

/**
 * BGE models expect a query-side instruction prefix for asymmetric
 * search (query vs. passage) — per the model card, prepending this to
 * queries (not to the passages/chunks being indexed) measurably improves
 * retrieval quality. Passages are embedded as-is.
 */
const QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: ";

export async function embedLocalOnnx(text: string, opts?: { isQuery?: boolean }): Promise<number[]> {
  const extractor = await LocalEmbedder.getInstance();
  const input = opts?.isQuery ? QUERY_INSTRUCTION + text.trim() : text.trim();
  const output = await extractor(input, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}
