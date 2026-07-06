/**
 * Embedding module with semantic API support and caching.
 *
 * Issue #7: Replaces the deterministic hash embedder with a real semantic
 * embedding model (OpenAI text-embedding-3-small). Falls back to the local
 * hash embedder when OPENAI_API_KEY is not set.
 *
 * Includes an in-memory LRU cache to avoid duplicate API calls.
 */

import OpenAI from "openai";

const DIM = 1536;

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry {
  embedding: number[];
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
const CACHE_MAX = 500;

function cacheKey(text: string): string {
  return text.trim().toLowerCase();
}

function getCached(text: string): number[] | null {
  const entry = cache.get(cacheKey(text));
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(cacheKey(text));
    return null;
  }
  return entry.embedding;
}

function setCache(text: string, embedding: number[]): void {
  // Simple eviction: delete oldest entry if at capacity
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(cacheKey(text), { embedding, ts: Date.now() });
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
  });
  return response.data[0].embedding;
}

// ─── Main Export ────────────────────────────────────────────────────────────

/**
 * Generates a semantic embedding for the given text.
 *
 * Uses OpenAI text-embedding-3-small when OPENAI_API_KEY is set,
 * otherwise falls back to the local deterministic hash embedder.
 * Results are cached in memory for 1 hour (max 500 entries).
 */
export async function embed(text: string): Promise<number[]> {
  // Check cache
  const cached = getCached(text);
  if (cached) return cached;

  let embedding: number[];

  const client = getOpenAIClient();
  if (client) {
    try {
      embedding = await embedReal(text);
    } catch (err) {
      console.warn("[Embed] API call failed, falling back to local embedder:", err);
      embedding = embedLocal(text);
    }
  } else {
    embedding = embedLocal(text);
  }

  setCache(text, embedding);
  return embedding;
}

export const EMBED_DIM = DIM;
