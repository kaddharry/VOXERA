/**
 * Semantic embeddings for memory and knowledge retrieval.
 *
 * One model only: the local ONNX bge-small-en-v1.5 embedder
 * (local-embedder.ts, 384 dimensions), which every vector already stored in
 * pgvector (memories.embedding) was made with. There is deliberately no
 * fallback model:
 *  - Vectors from a different model live in a different space; mixing them
 *    into the same column silently breaks retrieval even when the length
 *    matches.
 *  - The bag-of-words hash "embedder" that used to be the last resort has
 *    the right length but no semantic meaning.
 *  - Direct OpenAI embeddings were removed (VOXERA doesn't use an OpenAI key).
 *
 * If the local model can't run, embed() throws EmbeddingUnavailableError and
 * logs `embedding_unavailable`. Callers treat that as "retrieval degraded":
 * a call carries on without vector memory (small knowledge bases are still
 * inlined into the prompt), nothing is written to the vector column, and a
 * knowledge upload fails with a clear message instead of storing bad vectors.
 *
 * Includes an in-memory LRU cache to avoid duplicate embedding work.
 */

import { LOCAL_EMBED_DIM } from "./embed-dim";

const DIM = LOCAL_EMBED_DIM;

export class EmbeddingUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Embedding model unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "EmbeddingUnavailableError";
  }
}

export function isEmbeddingUnavailable(err: unknown): err is EmbeddingUnavailableError {
  return err instanceof Error && err.name === "EmbeddingUnavailableError";
}

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry {
  embedding: number[];
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
const CACHE_MAX = 500;

function cacheKey(text: string, isQuery?: boolean): string {
  // BGE embeds queries with an instruction prefix distinct from passages, so
  // the same text can legitimately produce two different embeddings — key on
  // both to avoid ever serving a passage-mode vector for a query lookup.
  return `${isQuery ? "q:" : "p:"}${text.trim().toLowerCase()}`;
}

function getCached(text: string, isQuery?: boolean): number[] | null {
  const key = cacheKey(text, isQuery);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.embedding;
}

function setCache(text: string, embedding: number[], isQuery?: boolean): void {
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(cacheKey(text, isQuery), { embedding, ts: Date.now() });
}

// ─── Main Export ────────────────────────────────────────────────────────────

/**
 * Embeds `text` with the local bge-small model. `isQuery` should be true for
 * search queries and false/omitted for content being stored (BGE uses an
 * instruction prefix for queries). Throws EmbeddingUnavailableError if the
 * model can't load or run.
 */
export async function embed(text: string, opts?: { isQuery?: boolean }): Promise<number[]> {
  const isQuery = opts?.isQuery ?? false;

  const cached = getCached(text, isQuery);
  if (cached) return cached;

  let embedding: number[];
  try {
    // Loaded on first use, not at import time: @xenova/transformers loads the
    // native ONNX runtime when imported, and a failure there must not stop
    // the routes that embed (the phone call among them) from loading at all.
    const { embedLocalOnnx } = await import("./local-embedder");
    embedding = await embedLocalOnnx(text, { isQuery });
  } catch (err) {
    console.error(JSON.stringify({ service: "embeddings", event: "embedding_unavailable", error: err instanceof Error ? err.message : String(err) }));
    throw new EmbeddingUnavailableError(err);
  }
  if (embedding.length !== DIM) {
    throw new EmbeddingUnavailableError(new Error(`model returned ${embedding.length} dimensions, expected ${DIM}`));
  }

  setCache(text, embedding, isQuery);
  return embedding;
}

export const EMBED_DIM = DIM;
