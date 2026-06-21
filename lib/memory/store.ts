import type { MemoryRecord, MemoryTier } from "../types";
import { supabase } from "../db/supabase";

/**
 * Maps a MemoryRecord to the flat Postgres row format.
 * Every field gets its own column — no JSONB metadata blob.
 */
function toRow(rec: MemoryRecord): Record<string, unknown> {
  return {
    id: rec.id,
    tier: rec.tier,
    "userId": rec.userId,
    "clientId": rec.clientId,
    ts: rec.ts,
    text: rec.text,
    summary: rec.summary,
    entities: rec.entities,
    topic: rec.topic,
    emotion: rec.emotion,
    vad_v: rec.vad.v,
    vad_a: rec.vad.a,
    vad_d: rec.vad.d,
    intensity: rec.intensity,
    importance: rec.importance,
    embedding: rec.embedding,
    "sourceUtteranceIds": rec.sourceUtteranceIds,
    recurrence: rec.recurrence,
    resolved: rec.resolved,
    ttl: rec.ttl ?? null,
    documentId: rec.documentId ?? null,
  };
}

/**
 * Maps a Postgres row back to a full MemoryRecord.
 * Handles potential null/undefined fields defensively.
 */
function fromRow(row: any): MemoryRecord {
  return {
    id: row.id,
    tier: row.tier,
    userId: row.userId,
    clientId: row.clientId,
    ts: row.ts ?? Date.now(),
    text: row.text,
    summary: row.summary ?? "",
    entities: row.entities ?? [],
    topic: row.topic ?? "general",
    emotion: row.emotion ?? "neutral",
    vad: {
      v: row.vad_v ?? 0,
      a: row.vad_a ?? 0,
      d: row.vad_d ?? 0,
    },
    intensity: row.intensity ?? 0,
    importance: row.importance ?? 0.5,
    // Postgres pgvector returns a string like "[0.1,0.2,...]" —
    // supabase-js auto-parses it, but we guard just in case.
    embedding: Array.isArray(row.embedding)
      ? row.embedding
      : typeof row.embedding === "string"
        ? JSON.parse(row.embedding)
        : [],
    sourceUtteranceIds: row.sourceUtteranceIds ?? [],
    recurrence: row.recurrence ?? 1,
    resolved: row.resolved ?? false,
    ttl: row.ttl ?? undefined,
    documentId: row.documentId ?? undefined,
  };
}

export const vectorStore = {
  async put(rec: MemoryRecord) {
    const { error } = await supabase.from("memories").upsert(toRow(rec));
    if (error) console.error("[VectorStore] Put Error:", error);
  },

  async get(id: string): Promise<MemoryRecord | undefined> {
    const { data, error } = await supabase
      .from("memories")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return undefined;
    return fromRow(data);
  },

  async update(id: string, patch: Partial<MemoryRecord>) {
    // Convert patch to row format — only include fields that are set
    const rowPatch: Record<string, unknown> = {};
    if (patch.ts !== undefined) rowPatch.ts = patch.ts;
    if (patch.importance !== undefined) rowPatch.importance = patch.importance;
    if (patch.recurrence !== undefined) rowPatch.recurrence = patch.recurrence;
    if (patch.resolved !== undefined) rowPatch.resolved = patch.resolved;
    if (patch.ttl !== undefined) rowPatch.ttl = patch.ttl;
    if (patch.summary !== undefined) rowPatch.summary = patch.summary;
    if (patch.topic !== undefined) rowPatch.topic = patch.topic;
    if (patch.tier !== undefined) rowPatch.tier = patch.tier;
    if (patch.documentId !== undefined) rowPatch.documentId = patch.documentId;
    if (patch.vad !== undefined) {
      rowPatch.vad_v = patch.vad.v;
      rowPatch.vad_a = patch.vad.a;
      rowPatch.vad_d = patch.vad.d;
    }

    const { error } = await supabase
      .from("memories")
      .update(rowPatch)
      .eq("id", id);
    if (error) console.error("[VectorStore] Update Error:", error);
  },

  async byTier(tier: MemoryTier, userId: string | null, clientId: string): Promise<MemoryRecord[]> {
    let query = supabase
      .from("memories")
      .select("*")
      .eq("tier", tier)
      .eq("clientId", clientId);

    if (userId && tier !== "LTM_client") {
      query = query.eq("userId", userId);
    }

    const { data, error } = await query;
    if (error || !data) return [];
    return data.map(fromRow);
  },

  async search(args: {
    tier: MemoryTier;
    userId: string | null;
    clientId: string;
    query: number[];
    topK: number;
  }): Promise<Array<{ rec: MemoryRecord; sim: number }>> {
    const { data, error } = await supabase.rpc("match_memories", {
      query_embedding: args.query,
      match_threshold: 0.0,
      match_count: args.topK,
      filter_tier: args.tier,
      filter_client_id: args.clientId,
      filter_user_id: args.userId,
    });

    if (error) {
      console.error("[VectorStore] Search Error:", error);
      return [];
    }

    return (data || []).map((row: any) => ({
      rec: fromRow(row),
      sim: row.similarity ?? 0,
    }));
  },

  async nearest(
    tier: MemoryTier,
    userId: string,
    clientId: string,
    query: number[]
  ): Promise<{ rec: MemoryRecord; sim: number } | null> {
    const top = await this.search({ tier, userId, clientId, query, topK: 1 });
    return top[0] ?? null;
  },

  async size(): Promise<Record<MemoryTier, number>> {
    const { data, error } = await supabase
      .from("memories")
      .select("tier");

    const counts = { STM: 0, MTM: 0, LTM_user: 0, LTM_client: 0 };
    if (!error && data) {
      for (const row of data) {
        if (row.tier in counts) counts[row.tier as MemoryTier]++;
      }
    }
    return counts;
  },
};
