/**
 * Embedding module with local semantic model + caching.
 *
 * Primary path is a real local ONNX embedding model (Xenova/bge-small-en-v1.5,
 * 384-dim, see local-embedder.ts) — no network round trip, no API cost, and
 * critically a REAL semantic embedder, unlike the bag-of-words hash embedder
 * this used to silently fall back to whenever OPENAI_API_KEY wasn't set (which
 * was, in practice, always — the hash embedder has no real semantic signal:
 * cosine similarity is driven by literal token overlap, which is why RAG
 * retrieval kept surfacing the same few knowledge chunks regardless of query
 * topic whenever a proper-noun/brand token was common across chunks).
 * OpenAI's text-embedding-3-small remains available as an optional override
 * (set OPENAI_API_KEY) for deployments that prefer a hosted model — its
 * `dimensions` param is pinned to match the local model's dimension so both
 * paths stay interchangeable in the vector store. The hash embedder is now
 * only the last-resort fallback if the local ONNX model itself fails to load.
 *
 * Includes an in-memory LRU cache to avoid duplicate embedding work.
 */

import OpenAI from "openai";
import { embedLocalOnnx, LOCAL_EMBED_DIM } from "./local-embedder";

const DIM = LOCAL_EMBED_DIM;

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
  // Simple eviction: delete oldest entry if at capacity
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(cacheKey(text, isQuery), { embedding, ts: Date.now() });
}

// ─── Local Hash Embedder (fallback) ─────────────────────────────────────────

function hashStr(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function embedLocal(text: string, dim: number = DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  for (const tok of tokens) {
    const i1 = hashStr(tok, 0x9e3779b1) % dim;
    const i2 = hashStr(tok, 0x85ebca6b) % dim;
    const s1 = (hashStr(tok, 0xc2b2ae35) & 1) === 0 ? 1 : -1;
    const s2 = (hashStr(tok, 0x27d4eb2f) & 1) === 0 ? 1 : -1;
    v[i1] += s1;
    v[i2] += s2;
  }
  // L2 normalize
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n === 0) return v;
  for (let i = 0; i < dim; i++) v[i] /= n;
  return v;
}

// ─── Real Semantic Embedder ─────────────────────────────────────────────────

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

async function embedReal(text: string): Promise<number[]> {
  const client = getOpenAIClient();
  if (!client) throw new Error("No OpenAI client");

  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text.trim(),
    // Pinned to LOCAL_EMBED_DIM so OpenAI's embeddings stay interchangeable
    // with the local ONNX model's vectors in the shared pgvector column —
    // text-embedding-3-small supports Matryoshka truncation via this param.
    dimensions: DIM,
  });
  return response.data[0].embedding;
}

// ─── Main Export ────────────────────────────────────────────────────────────

/**
 * Generates a semantic embedding for the given text.
 *
 * Primary path: local ONNX (Xenova/bge-small-en-v1.5, see local-embedder.ts)
 * — real semantic embeddings, no network call. Falls back to OpenAI
 * text-embedding-3-small only if the local model fails to load AND
 * OPENAI_API_KEY is set; the bag-of-words hash embedder is the last-resort
 * fallback if both of those are unavailable, purely so the app still
 * functions (with degraded retrieval quality) rather than throwing.
 *
 * `isQuery` should be true for search queries and false/omitted for content
 * being stored — BGE embeds queries with a different instruction prefix than
 * passages (asymmetric search), and the cache key includes it so the two
 * modes never collide.
 *
 * Results are cached in memory for 1 hour (max 500 entries).
 */
export async function embed(text: string, opts?: { isQuery?: boolean }): Promise<number[]> {
  const isQuery = opts?.isQuery ?? false;

  const cached = getCached(text, isQuery);
  if (cached) return cached;

  let embedding: number[];
  try {
    embedding = await embedLocalOnnx(text, { isQuery });
  } catch (err) {
    console.warn("[Embed] Local ONNX model failed, falling back:", err);
    const client = getOpenAIClient();
    if (client) {
      try {
        embedding = await embedReal(text);
      } catch (err2) {
        console.warn("[Embed] OpenAI fallback also failed, using hash embedder:", err2);
        embedding = embedLocal(text);
      }
    } else {
      embedding = embedLocal(text);
    }
  }

  setCache(text, embedding, isQuery);
  return embedding;
}

export const EMBED_DIM = DIM;
