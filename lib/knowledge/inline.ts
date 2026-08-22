import { supabase } from "../db/supabase";
import { CONFIG } from "../config";

/**
 * For a client whose LTM_client knowledge base is small enough, returns the
 * full concatenated KB text so the caller can splice it directly into the
 * system prompt and skip the per-turn LTM_client pgvector search entirely —
 * one fewer embedding call + one fewer DB round trip per turn, which matters
 * for a demo-stage tenant whose whole KB is a single 1-page document (the
 * common case). Returns null when the KB is empty or larger than
 * CONFIG.knowledge.stackThresholdChunks (same boundary ingest.ts already
 * uses to decide whether a document needs stack-summarization) — in that
 * case the caller should fall back to normal per-turn retrieval, since
 * inlining a large KB would blow the prompt budget and doesn't scale.
 *
 * Cached per clientId for the life of the process; call
 * invalidateInlineKnowledgeBase() whenever that client's KB changes
 * (upload/delete/reprocess) so stale text doesn't linger. A TTL is kept as a
 * backstop in case an invalidation call site is ever missed.
 */

interface CacheEntry {
  text: string | null;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 10;

export async function getInlineKnowledgeBase(clientId: string): Promise<string | null> {
  const cached = cache.get(clientId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.text;
  }

  const { data, error } = await supabase
    .from("memories")
    .select("text, topic")
    .eq("clientId", clientId)
    .eq("tier", "LTM_client")
    .order("ts", { ascending: true });

  if (error || !data || data.length === 0) {
    cache.set(clientId, { text: null, fetchedAt: Date.now() });
    return null;
  }

  // Stack-summary records (topic ending ":overview") only ever get written
  // above the same stackThresholdChunks boundary this function checks below
  // — so in practice a KB small enough to inline never has any — but filter
  // them out defensively rather than assume that invariant never changes.
  const detailChunks = data.filter((r) => !r.topic?.endsWith(":overview"));

  if (detailChunks.length === 0 || detailChunks.length > CONFIG.knowledge.stackThresholdChunks) {
    cache.set(clientId, { text: null, fetchedAt: Date.now() });
    return null;
  }

  const text = detailChunks.map((r) => r.text).join("\n\n");
  cache.set(clientId, { text, fetchedAt: Date.now() });
  return text;
}

export function invalidateInlineKnowledgeBase(clientId: string): void {
  cache.delete(clientId);
}
