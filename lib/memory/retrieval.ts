import { CONFIG } from "../config";
import type { EmotionContext, MemoryRecord, RetrievedContext, Utterance, VAD, RetrievalExplanation, TimelineEvent } from "../types";
import { embed } from "../util/embed";
import { clamp, cosine } from "../util/math";
import { stm } from "./stm";
import { vectorStore } from "./store";

export interface RetrievalRequest {
  sessionId: string;
  userId: string;
  clientId: string;
  queryText: string;
  emotion: EmotionContext;
}

// Background updater to persist decayed scores to database
function backgroundUpdateDecayedImportance(rec: MemoryRecord, decayed: number) {
  const currentVal = rec.importance_score ?? rec.importance;
  if (Math.abs(currentVal - decayed) > 0.01) {
    // Only update if difference is meaningful to prevent excessive DB writes
    vectorStore.update(rec.id, { importance_score: Number(decayed.toFixed(4)) }).catch(err => {
      console.error(`[Retrieval] Failed to update decayed importance for ${rec.id}:`, err);
    });
  }
}

/**
 * Calculates decayed importance score based on a 7-day half-life since last activity.
 * Critical long-term user facts are preserved with higher floors.
 */
export function calculateDecayedImportance(rec: MemoryRecord): number {
  const isCritical = rec.tier === "LTM_user" ||
                     rec.tier === "LTM_client" ||
                     rec.importance >= 0.75 ||
                     /allerg|prefer|languag|vip|permanent|billing|payment|compliance/i.test(rec.text);

  const tLast = Math.max(rec.ts, rec.last_retrieved_at ?? rec.ts);
  const dt = Date.now() - tLast;
  
  // Halflife of 7 days
  const halfLifeMs = 1000 * 60 * 60 * 24 * 7;
  const decayFactor = Math.exp(-dt * Math.LN2 / halfLifeMs);
  
  const floor = isCritical ? Math.max(0.7, rec.importance) : 0.15;
  const rawImportance = rec.importance_score ?? rec.importance;
  
  return Math.max(rawImportance * decayFactor, floor);
}

/**
 * Calculates boosted importance score when a memory is retrieved.
 */
export function calculateUpdatedImportanceOnRetrieval(rec: MemoryRecord): number {
  const current = calculateDecayedImportance(rec);
  const nextRetrievalCount = (rec.retrieval_count ?? 0) + 1;
  const retrievalBoost = 0.05 * Math.log1p(nextRetrievalCount);
  return Math.min(current + retrievalBoost, 1.0);
}

function emoMatch(a: VAD | undefined, b: VAD | undefined): number {
  if (!a || !b) return 0.5; // neutral match if VAD data is missing
  const va = [a.v, a.a, a.d];
  const vb = [b.v, b.a, b.d];
  const s = cosine(va, vb);
  return clamp((s + 1) / 2);
}

function recencyBoost(tsMs: number, importance: number): number {
  const dt = Date.now() - tsMs;
  const tauI = CONFIG.retrieval.tauFreshMs * (1 + CONFIG.memory.decayLambda * importance);
  return Math.exp(-dt / tauI);
}

function staleness(rec: MemoryRecord): number {
  if (!rec.ttl) return 0;
  if (Date.now() < rec.ttl) return 0;
  const overdueDays = (Date.now() - rec.ttl) / (1000 * 60 * 60 * 24);
  return clamp(overdueDays / 30);
}

function redundancyPenalty(rec: MemoryRecord, selected: MemoryRecord[]): number {
  if (selected.length === 0) return 0;
  if (!rec.embedding || rec.embedding.length === 0) return 0;
  let maxSim = 0;
  for (const s of selected) {
    if (!s.embedding || s.embedding.length === 0) continue;
    const sim = cosine(rec.embedding, s.embedding);
    if (sim > maxSim) maxSim = sim;
  }
  return clamp(maxSim);
}

function scoreRecord(
  rec: MemoryRecord,
  sim: number,
  emotion: EmotionContext,
  selected: MemoryRecord[],
  boostEmotion: boolean,
): number {
  const { w } = CONFIG.retrieval;
  const sem = clamp((sim + 1) / 2);
  const emo = emoMatch(emotion.current.vad, rec.vad);
  
  // Use dynamically decayed importance score
  const decayedImp = calculateDecayedImportance(rec);
  const rec_ = recencyBoost(rec.ts, decayedImp);
  
  const stale = staleness(rec);
  const redund = redundancyPenalty(rec, selected);
  const wEmo = boostEmotion ? w.emo * 1.8 : w.emo;
  return w.sem * sem + wEmo * emo + w.rec * rec_ + w.imp * decayedImp - w.stale * stale - w.redund * redund;
}

export function generateExplanation(
  rec: MemoryRecord,
  sim: number,
  emotion: EmotionContext,
  selected: MemoryRecord[],
  boostEmotion: boolean,
  rawScore: number
): RetrievalExplanation {
  const sem = clamp((sim + 1) / 2);
  const emo = emoMatch(emotion.current.vad, rec.vad);
  const imp = rec.importance_score ?? rec.importance;
  const rec_ = recencyBoost(rec.ts, imp);
  const stale = staleness(rec);
  
  const reasons: string[] = [];
  if (sem >= 0.8) {
    reasons.push(`strong semantic similarity (${Math.round(sem * 100)}%)`);
  } else if (sem >= 0.6) {
    reasons.push(`moderate semantic similarity (${Math.round(sem * 100)}%)`);
  }
  
  if (imp >= 0.7) {
    reasons.push(`critical fact preservation (importance ${Math.round(imp * 100)}%)`);
  } else if (imp >= 0.5) {
    reasons.push(`moderate importance (${Math.round(imp * 100)}%)`);
  }
  
  if (rec_ >= 0.7) {
    reasons.push("high recency");
  }
  
  if (rec.retrieval_count && rec.retrieval_count > 0) {
    reasons.push(`frequently accessed (${rec.retrieval_count} times)`);
  }
  
  if (emo >= 0.75 && boostEmotion) {
    reasons.push("emotion priority match for distress/frustration");
  }
  
  if (stale > 0.4) {
    reasons.push("penalized for staleness");
  }

  const reason = reasons.length > 0
    ? `Selected due to: ${reasons.join(", ")}.`
    : `Selected based on general relevance score (${rawScore.toFixed(2)}).`;

  return {
    memoryId: rec.id,
    reason,
    metrics: {
      similarity: Number(sem.toFixed(4)),
      importance: Number(imp.toFixed(4)),
      recency: Number(rec_.toFixed(4)),
      retrievalFrequency: rec.retrieval_count ?? 0,
      rawScore: Number(rawScore.toFixed(4)),
    }
  };
}

export function groupMemoriesIntoTimeline(memories: MemoryRecord[]): TimelineEvent[] {
  if (memories.length === 0) return [];
  
  // Group only MTM and LTM_user memories
  const userMems = memories.filter(m => m.tier === "MTM" || m.tier === "LTM_user");
  if (userMems.length === 0) return [];

  // Sort chronologically ascending
  const sorted = [...userMems].sort((a, b) => a.ts - b.ts);
  
  const events: TimelineEvent[] = [];
  const twoDaysMs = 1000 * 60 * 60 * 24 * 2; // 48 hours proximity
  
  for (const mem of sorted) {
    let matchedEvent = events.find(
      evt => evt.topic === mem.topic && Math.abs(mem.ts - evt.endDate) <= twoDaysMs
    );
    
    if (matchedEvent) {
      matchedEvent.memories.push(mem);
      matchedEvent.startDate = Math.min(matchedEvent.startDate, mem.ts);
      matchedEvent.endDate = Math.max(matchedEvent.endDate, mem.ts);
      const uniqueSummaries = Array.from(new Set(matchedEvent.memories.map(m => m.summary)));
      matchedEvent.summary = uniqueSummaries.join("; ");
    } else {
      events.push({
        id: `evt_${mem.id}`,
        topic: mem.topic,
        startDate: mem.ts,
        endDate: mem.ts,
        memories: [mem],
        summary: mem.summary,
      });
    }
  }
  
  // Return sorted events descending (most recent first)
  return events.sort((a, b) => b.startDate - a.startDate);
}

export async function retrieve(req: RetrievalRequest): Promise<RetrievedContext> {
  const queryEmb = await embed(req.queryText);
  const stmTurns = await stm.get(req.sessionId);
  const boostEmotion = req.emotion.flags.increasing_distress || req.emotion.flags.repeated_frustration;

  // Fetch candidate sets with pgvector similarity calculated in database
  const candidateK = 20;
  const [mtmResults, ltmUserResults, ltmClientResults] = await Promise.all([
    vectorStore.search({ tier: "MTM", userId: req.userId, clientId: req.clientId, query: queryEmb, topK: candidateK }),
    vectorStore.search({ tier: "LTM_user", userId: req.userId, clientId: req.clientId, query: queryEmb, topK: candidateK }),
    vectorStore.search({ tier: "LTM_client", userId: null, clientId: req.clientId, query: queryEmb, topK: candidateK }),
  ]);

  // Pre-decay candidates and update in DB asynchronously
  const preDecay = (cands: Array<{ rec: MemoryRecord; sim: number }>) => {
    for (const item of cands) {
      const decayed = calculateDecayedImportance(item.rec);
      backgroundUpdateDecayedImportance(item.rec, decayed);
      item.rec.importance_score = decayed; // Cache decayed score in memory
    }
  };
  preDecay(mtmResults);
  preDecay(ltmUserResults);
  preDecay(ltmClientResults);

  const pick = (cands: Array<{ rec: MemoryRecord; sim: number }>, topK: number, minSem: number | null) => {
    const selected: MemoryRecord[] = [];
    const scored: Array<{ rec: MemoryRecord; sim: number; score: number }> = [];
    
    for (const item of cands) {
      const sem = clamp((item.sim + 1) / 2);
      if (minSem != null && sem < minSem && item.rec.importance_score < 0.7) continue;
      scored.push({ rec: item.rec, sim: item.sim, score: 0 });
    }
    
    for (let i = 0; i < topK && scored.length > 0; i++) {
      let bestIdx = -1;
      let bestScore = -Infinity;
      for (let j = 0; j < scored.length; j++) {
        const s = scoreRecord(scored[j].rec, scored[j].sim, req.emotion, selected, boostEmotion);
        if (s > bestScore) {
          bestScore = s;
          bestIdx = j;
        }
      }
      if (bestIdx === -1) break;
      const picked = scored.splice(bestIdx, 1)[0];
      picked.score = bestScore;
      selected.push(picked.rec);
      
      // Update selected memory's retrieval metrics
      const nextImp = calculateUpdatedImportanceOnRetrieval(picked.rec);
      vectorStore.update(picked.rec.id, {
        retrieval_count: (picked.rec.retrieval_count ?? 0) + 1,
        last_retrieved_at: Date.now(),
        importance_score: Number(nextImp.toFixed(4)),
      }).catch(err => {
        console.error(`[Retrieval] Failed to update metrics on retrieval for ${picked.rec.id}:`, err);
      });
      picked.rec.retrieval_count = (picked.rec.retrieval_count ?? 0) + 1;
      picked.rec.last_retrieved_at = Date.now();
      picked.rec.importance_score = Number(nextImp.toFixed(4));
    }
    
    return selected.map((rec) => {
      const sim = cands.find((c) => c.rec.id === rec.id)?.sim ?? 0;
      return { rec, score: scoreRecord(rec, sim, req.emotion, [], boostEmotion) };
    });
  };

  const mtmPicked = pick(mtmResults, CONFIG.retrieval.topK.mtm, CONFIG.retrieval.minSemScore);
  const ltmUserPicked = pick(ltmUserResults, CONFIG.retrieval.topK.ltmUser, null);
  const ltmClientPicked = pick(ltmClientResults, CONFIG.retrieval.topK.ltmClient, null);

  const scores = [...mtmPicked, ...ltmUserPicked, ...ltmClientPicked].map((x) => ({
    id: x.rec.id,
    score: Number(x.score.toFixed(4)),
  }));

  // Generate explanations
  const explanations: Record<string, RetrievalExplanation> = {};
  const addExplanations = (picked: Array<{ rec: MemoryRecord; score: number }>, cands: Array<{ rec: MemoryRecord; sim: number }>) => {
    for (const p of picked) {
      const sim = cands.find(c => c.rec.id === p.rec.id)?.sim ?? 0;
      explanations[p.rec.id] = generateExplanation(p.rec, sim, req.emotion, [], boostEmotion, p.score);
    }
  };
  addExplanations(mtmPicked, mtmResults);
  addExplanations(ltmUserPicked, ltmUserResults);
  addExplanations(ltmClientPicked, ltmClientResults);

  // Group user memories into timeline events
  const userPickedMems = [...mtmPicked.map(x => x.rec), ...ltmUserPicked.map(x => x.rec)];
  const timeline = groupMemoriesIntoTimeline(userPickedMems);

  return {
    stm: stmTurns,
    mtm: mtmPicked.map((x) => x.rec),
    ltmUser: ltmUserPicked.map((x) => x.rec),
    ltmClient: ltmClientPicked.map((x) => x.rec),
    scores,
    explanations,
    timeline,
  };
}

export function topScore(retrieved: RetrievedContext): number {
  if (retrieved.scores.length === 0) return 0;
  return Math.max(...retrieved.scores.map((s) => s.score));
}

export function utteranceEmotion(u: Utterance) {
  return u.emotion;
}

