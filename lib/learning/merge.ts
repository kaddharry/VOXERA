import { nanoid } from "nanoid";
import { similarity } from "./grounding";
import type { Extraction, Learning, LearningStore } from "./types";

export const LEARNING_LIMITS = {
  /** Distinct calls that must support an agent/global lesson before it is applied. */
  promoteAt: 2,
  /** A lesson also becomes shared (global) when this many separate calls show it, even if only ONE agent has made
   * the calls — a hospital with a single agent would otherwise never get a shared lesson. */
  globalFromCalls: 3,
  /** Same-topic threshold for token overlap. */
  sameTopic: 0.6,
  /** Embedding cosine at/above which two differently-worded statements are the same thing. Measured with the local
   * bge-small model: paraphrases of one lesson scored 0.69-0.90, but lessons that are merely on the same TOPIC
   * ("verify availability" vs "limit options to two") also reach 0.63-0.70, so the middle band is not decidable
   * from the vector alone. */
  sameMeaning: 0.65,
  /** Lessons: >= this is the same lesson outright; below `differentBelow` they are different; in between a
   * yes/no judge decides whether they ask for the SAME behaviour. */
  sameLessonAbove: 0.80,
  differentBelow: 0.62,
  /** A re-worded fact below this overlap counts as a CHANGE, not a repeat. */
  sameValue: 0.8,
  maxPatientFacts: 40,
  maxLessonsPerScope: 25,
  maxEvidence: 3,
};

export interface MergeResult {
  patient: { added: number; reinforced: number; updated: number; retired: number };
  lessons: { added: number; reinforced: number; promoted: number; globalPromoted: number };
}

const SRC_CAP = 50;
const addUnique = (list: string[], v: string) => (list.includes(v) ? list : [...list, v].slice(-SRC_CAP));

function rank(l: Learning): number {
  return l.supportCount * Math.max(l.confidence, 0.1) + l.updatedAt / 1e13;
}

async function trim(store: LearningStore, rows: Learning[], max: number): Promise<number> {
  if (rows.length <= max) return 0;
  const drop = [...rows].sort((a, b) => rank(a) - rank(b)).slice(0, rows.length - max);
  for (const d of drop) await store.update(d.id, { status: "retired" });
  return drop.length;
}

export type Embedder = (text: string) => Promise<number[]>;
/** Do these two instructions ask an agent for the same behaviour (not merely the same topic)? */
export type LessonJudge = (a: string, b: string) => Promise<boolean>;

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export async function applyExtraction(args: {
  /** Optional semantic matcher so reworded lessons still count as the same lesson. */
  embed?: Embedder;
  /** Breaks ties in the embedding's gray band; without it the plain threshold is used. */
  judge?: LessonJudge;
  store: LearningStore;
  clientId: string;
  agentId?: string | null;
  patientId?: string | null;
  callId: string;
  extraction: Extraction;
  now?: number;
}): Promise<MergeResult> {
  const { store, clientId, agentId, patientId, callId, extraction } = args;
  const now = args.now ?? Date.now();
  const vecs = new Map<string, number[] | null>();
  const vec = async (t: string) => {
    if (!args.embed) return null;
    if (!vecs.has(t)) vecs.set(t, await args.embed(t).catch(() => null));
    return vecs.get(t)!;
  };
  /** Same TOPIC (used to find the fact a new statement updates): token overlap or close embedding. */
  const sameTopic = async (a: Learning, b: { category: string; text: string }): Promise<boolean> => {
    if (similarity(a.text, b.text) >= LEARNING_LIMITS.sameTopic) return true;
    const [va, vb] = [await vec(a.text), await vec(b.text)];
    return !!va && !!vb && cosine(va, vb) >= LEARNING_LIMITS.sameMeaning;
  };
  /** Same LESSON (agent/global): clear matches and clear misses come from the embedding; the gray band goes to the judge. */
  const sameLesson = async (a: Learning, b: { category: string; text: string }): Promise<boolean> => {
    if (similarity(a.text, b.text) >= LEARNING_LIMITS.sameTopic) return true;
    const [va, vb] = [await vec(a.text), await vec(b.text)];
    if (!va || !vb) return false;
    const c = cosine(va, vb);
    if (c >= LEARNING_LIMITS.sameLessonAbove) return true;
    if (c < LEARNING_LIMITS.differentBelow) return false;
    if (!args.judge) return c >= LEARNING_LIMITS.sameMeaning;
    return args.judge(a.text, b.text).catch(() => false);
  };
  const findSame = async (pool: Learning[], b: { category: string; text: string }) => {
    for (const e of pool) if (await sameLesson(e, b)) return e;
    return undefined;
  };
  const result: MergeResult = { patient: { added: 0, reinforced: 0, updated: 0, retired: 0 }, lessons: { added: 0, reinforced: 0, promoted: 0, globalPromoted: 0 } };

  // ── patient facts ──────────────────────────────────────────────────────────
  if (patientId) {
    const existing = await store.listPatient(clientId, patientId, ["active"]);
    for (const fact of extraction.patientFacts) {
      let match = existing.find((e) => e.key === fact.key);
      if (!match) {
        for (const e of existing) if (e.category === fact.category && (await sameTopic(e, fact))) { match = e; break; }
      }
      if (match) {
        if (match.sourceCallIds.includes(callId)) continue; // same call re-processed
        // Embeddings find the same TOPIC, but they cannot tell "has knee pain" from "knee pain is gone"
        // (opposite meaning, near-identical vector). So only near-identical wording counts as a repeat;
        // anything else is the patient's newer statement and replaces the old one.
        const sameValue = similarity(match.text, fact.text) >= LEARNING_LIMITS.sameValue;
        if (sameValue) {
          const patch = {
            supportCount: match.supportCount + 1,
            confidence: Math.max(match.confidence, fact.confidence),
            evidence: [...match.evidence, fact.evidence].slice(-LEARNING_LIMITS.maxEvidence),
            sourceCallIds: addUnique(match.sourceCallIds, callId),
            updatedAt: now,
          };
          await store.update(match.id, patch);
          Object.assign(match, patch);
          result.patient.reinforced++;
        } else {
          // The patient's situation changed: newest statement wins.
          const patch = {
            text: fact.text,
            category: fact.category,
            confidence: fact.confidence,
            supportCount: 1,
            evidence: [fact.evidence],
            sourceCallIds: addUnique(match.sourceCallIds, callId),
            updatedAt: now,
          };
          await store.update(match.id, patch);
          Object.assign(match, patch);
          result.patient.updated++;
        }
      } else {
        const row: Learning = {
          id: nanoid(12), clientId, scope: "patient", agentId: null, patientId, category: fact.category, key: fact.key, text: fact.text,
          evidence: [fact.evidence], sourceCallIds: [callId], supportCount: 1, confidence: fact.confidence, status: "active", createdAt: now, updatedAt: now,
        };
        await store.insert(row);
        existing.push(row);
        result.patient.added++;
      }
    }
    for (const key of extraction.resolvedKeys) {
      const m = existing.find((e) => e.key === key && e.status === "active" && !e.sourceCallIds.includes(callId));
      if (m) {
        await store.update(m.id, { status: "retired", updatedAt: now });
        m.status = "retired";
        result.patient.retired++;
      }
    }
    result.patient.retired += await trim(store, existing.filter((e) => e.status === "active"), LEARNING_LIMITS.maxPatientFacts);
  }

  // ── lessons: agent scope, or global when the model says it is general ─────────
  const touched: Learning[] = [];
  for (const lesson of extraction.lessons) {
    // Always stored for the agent that learned it. A lesson becomes GLOBAL only once
    // it has shown up for two different agents (see below) — the model's own
    // "general" flag is too eager to be trusted on its own.
    if (!agentId) continue;
    const pool = await store.listAgent(clientId, agentId, ["active", "pending"]);
    const match = await findSame(pool, lesson);
    if (match) {
      if (match.sourceCallIds.includes(callId)) continue;
      const support = match.supportCount + 1;
      const becomesActive = match.status === "pending" && support >= LEARNING_LIMITS.promoteAt;
      const patch = {
        supportCount: support,
        confidence: Math.max(match.confidence, lesson.confidence),
        evidence: [...match.evidence, lesson.evidence].slice(-LEARNING_LIMITS.maxEvidence),
        sourceCallIds: addUnique(match.sourceCallIds, callId),
        status: becomesActive ? ("active" as const) : match.status,
        updatedAt: now,
      };
      await store.update(match.id, patch);
      Object.assign(match, patch);
      touched.push(match);
      result.lessons.reinforced++;
      if (becomesActive) result.lessons.promoted++;
    } else {
      const row: Learning = {
        id: nanoid(12), clientId, scope: "agent", agentId, patientId: null, category: lesson.category, key: null,
        text: lesson.text, evidence: [lesson.evidence], sourceCallIds: [callId], supportCount: 1, confidence: lesson.confidence,
        status: "pending", createdAt: now, updatedAt: now,
      };
      await store.insert(row);
      touched.push(row);
      result.lessons.added++;
    }
  }

  // ── promote to GLOBAL: the same lesson showing up for 2+ different agents ─────
  if (touched.some((t) => t.scope === "agent")) {
    const allAgent = await store.listAllAgentLessons(clientId);
    const globals = await store.listGlobal(clientId, ["active", "pending"]);
    for (const t of touched.filter((x) => x.scope === "agent")) {
      const family: Learning[] = [];
      for (const o of allAgent) if (o.id === t.id || (await sameLesson(o, t))) family.push(o);
      const agentsInFamily = new Set(family.map((o) => o.agentId));
      const calls = [...new Set(family.flatMap((o) => o.sourceCallIds))];
      // shared once two different agents learned it, or once enough separate calls show it
      if (agentsInFamily.size < 2 && calls.length < LEARNING_LIMITS.globalFromCalls) continue;
      const evidence = [...new Set(family.flatMap((o) => o.evidence))].slice(0, LEARNING_LIMITS.maxEvidence);
      const existingGlobal = await findSame(globals, t);
      if (existingGlobal) {
        if (existingGlobal.sourceCallIds.length === calls.length && existingGlobal.status === "active") continue;
        const patch = { sourceCallIds: calls.slice(-SRC_CAP), supportCount: calls.length, evidence, status: "active" as const, updatedAt: now };
        await store.update(existingGlobal.id, patch);
        Object.assign(existingGlobal, patch);
      } else {
        const row: Learning = {
          id: nanoid(12), clientId, scope: "global", agentId: null, patientId: null, category: t.category, key: null, text: t.text, evidence,
          sourceCallIds: calls.slice(-SRC_CAP), supportCount: calls.length, confidence: Math.max(...family.map((o) => o.confidence)),
          status: "active", createdAt: now, updatedAt: now,
        };
        await store.insert(row);
        globals.push(row);
      }
      result.lessons.globalPromoted++;
    }
  }

  // keep each lesson pool bounded
  if (agentId) await trim(store, await store.listAgent(clientId, agentId, ["active", "pending"]), LEARNING_LIMITS.maxLessonsPerScope);
  await trim(store, await store.listGlobal(clientId, ["active", "pending"]), LEARNING_LIMITS.maxLessonsPerScope);
  return result;
}
