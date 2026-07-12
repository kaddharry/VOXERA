import { nanoid } from "nanoid";
import { CONFIG } from "../config";
import type { EmotionContext, MemoryRecord, Utterance } from "../types";
import { embed } from "../util/embed";
import { cosine } from "../util/math";
import { vectorStore } from "./store";

function inferTopic(text: string): string {
  const t = text.toLowerCase();
  if (/signal|coverage|dropped|outage|network/.test(t)) return "connectivity";
  if (/bill|charge|refund|payment|invoice/.test(t)) return "billing";
  if (/password|login|account|access/.test(t)) return "account";
  if (/cancel|terminate|close/.test(t)) return "cancellation";
  if (/ship|deliver|order|tracking/.test(t)) return "shipping";
  return "general";
}

function inferEntities(text: string): string[] {
  const ents: string[] = [];
  const ticket = text.match(/\b[A-Z]{2,}-?\d{3,}\b/g);
  if (ticket) ents.push(...ticket);
  const pin = text.match(/\bpin\s*code\s*\d{5,6}\b/gi);
  if (pin) ents.push(...pin.map((s) => s.toUpperCase()));
  return ents;
}

function summarize(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 180 ? clean : clean.slice(0, 177) + "…";
}

export interface WriteInput {
  utterance: Utterance;
  userId: string;
  clientId: string;
  emotion: EmotionContext;
  importance: number;
}

export async function writeMemory(input: WriteInput): Promise<{
  tier: "STM" | "MTM" | "LTM_user" | "discarded";
  recordId?: string;
  merged?: boolean;
}> {
  const { utterance, userId, clientId, emotion, importance } = input;
  const { tierThresholds, mergeSimilarity } = CONFIG.memory;

  if (importance < tierThresholds.mtm) {
    return { tier: "STM" };
  }

  const embedding = await embed(utterance.text);
  const topic = inferTopic(utterance.text);

  const mtmCandidates = await vectorStore.byTier("MTM", userId, clientId);
  const sameTopic = mtmCandidates.filter((m) => m.topic === topic);
  for (const cand of sameTopic) {
    if (!cand.embedding || cand.embedding.length === 0) continue;
    const sim = cosine(embedding, cand.embedding);
    if (sim >= mergeSimilarity && cand.emotion === emotion.current.label) {
      const nextRecurrence = cand.recurrence + 1;
      const baseImp = Math.max(cand.importance, importance);
      const recurrenceBoost = 0.1 * Math.log1p(nextRecurrence);
      const nextScore = Math.min(baseImp + recurrenceBoost, 1.0);
      
      await vectorStore.update(cand.id, {
        recurrence: nextRecurrence,
        ts: utterance.ts,
        importance: baseImp,
        importance_score: nextScore,
      });
      await maybePromote(cand.id, userId, clientId);
      return { tier: "MTM", recordId: cand.id, merged: true };
    }
  }

  const rec: MemoryRecord = {
    id: nanoid(10),
    tier: "MTM",
    userId,
    clientId,
    ts: utterance.ts,
    text: utterance.text,
    summary: summarize(utterance.text),
    entities: inferEntities(utterance.text),
    topic,
    emotion: emotion.current.label,
    vad: emotion.current.vad,
    intensity: emotion.current.intensity,
    importance,
    importance_score: importance,
    retrieval_count: 0,
    embedding,
    sourceUtteranceIds: [utterance.id],
    recurrence: 1,
    resolved: false,
    ttl: Date.now() + (importance >= tierThresholds.ltm ? 1000 * 60 * 60 * 24 * 90 : 1000 * 60 * 60 * 24 * 30),
  };
  await vectorStore.put(rec);

  if (importance >= tierThresholds.ltm) {
    await maybePromote(rec.id, userId, clientId);
  }

  return { tier: "MTM", recordId: rec.id, merged: false };
}

async function maybePromote(mtmId: string, userId: string, clientId: string) {
  const src = await vectorStore.get(mtmId);
  if (!src) return;
  if (src.recurrence < CONFIG.memory.ltmRecurrenceK) return;

  const promotedId = nanoid(10);
  const ltmRec: MemoryRecord = {
    ...src,
    id: promotedId,
    tier: "LTM_user",
    summary: `[chronic] ${src.summary}`,
    topic: src.topic === "connectivity" ? "chronic_issue" : src.topic,
    ttl: undefined,
    sourceUtteranceIds: [...src.sourceUtteranceIds],
  };
  await vectorStore.put(ltmRec);
  void userId;
  void clientId;
}

// Seed a client-level memory (brand voice, escalation rules, compliance).
export async function seedClientMemory(args: {
  clientId: string;
  text: string;
  topic: string;
  importance?: number;
  documentId?: string;
}) {
  const embedding = await embed(args.text);
  const rec: MemoryRecord = {
    id: nanoid(10),
    tier: "LTM_client",
    userId: "client",
    clientId: args.clientId,
    ts: Date.now(),
    text: args.text,
    summary: summarize(args.text),
    entities: [],
    topic: args.topic,
    emotion: "neutral",
    vad: { v: 0, a: 0, d: 0 },
    intensity: 0,
    importance: args.importance ?? 0.9,
    importance_score: args.importance ?? 0.9,
    retrieval_count: 0,
    embedding,
    sourceUtteranceIds: [],
    recurrence: 1,
    resolved: true,
    documentId: args.documentId,
  };
  await vectorStore.put(rec);
  return rec.id;
}
