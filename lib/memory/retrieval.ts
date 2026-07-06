import { CONFIG } from "../config";
import type { EmotionContext, MemoryRecord, RetrievedContext, Utterance, VAD } from "../types";
import { embed } from "../util/embed";
import { clamp, cosine } from "../util/math";
import { stm } from "./stm";
import { vectorStore } from "./store";

// Equation R: score = w1·cos(q,m) + w2·EmoMatch + w3·e^(-Δt/τ_I)
//                    + w4·I(m) − w5·Staleness − w6·Redundancy
export interface RetrievalRequest {
  sessionId: string;
  userId: string;
  clientId: string;
  queryText: string;
  emotion: EmotionContext;
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
  queryEmb: number[],
  emotion: EmotionContext,
  selected: MemoryRecord[],
  boostEmotion: boolean,
): number {
  const { w } = CONFIG.retrieval;
  const sem = (rec.embedding && rec.embedding.length > 0) ? clamp((cosine(queryEmb, rec.embedding) + 1) / 2) : 0.5;
  const emo = emoMatch(emotion.current.vad, rec.vad);
  const rec_ = recencyBoost(rec.ts, rec.importance);
  const imp = rec.importance;
  const stale = staleness(rec);
  const redund = redundancyPenalty(rec, selected);
  const wEmo = boostEmotion ? w.emo * 1.8 : w.emo;
  return w.sem * sem + wEmo * emo + w.rec * rec_ + w.imp * imp - w.stale * stale - w.redund * redund;
}

export async function retrieve(req: RetrievalRequest): Promise<RetrievedContext> {
  const queryEmb = await embed(req.queryText);
  const stmTurns = await stm.get(req.sessionId);
  const boostEmotion = req.emotion.flags.increasing_distress || req.emotion.flags.repeated_frustration;

  // Issue #6: Use pgvector search instead of loading all records with byTier()
  // Fetch a generous candidate set from the database, then re-rank with emotion/recency/importance in JS
  const candidateK = 20;
  const [mtmResults, ltmUserResults, ltmClientResults] = await Promise.all([
    vectorStore.search({ tier: "MTM", userId: req.userId, clientId: req.clientId, query: queryEmb, topK: candidateK }),
    vectorStore.search({ tier: "LTM_user", userId: req.userId, clientId: req.clientId, query: queryEmb, topK: candidateK }),
    vectorStore.search({ tier: "LTM_client", userId: null, clientId: req.clientId, query: queryEmb, topK: candidateK }),
  ]);
  const mtmCandidates = mtmResults.map((r) => r.rec);
  const ltmUserCands = ltmUserResults.map((r) => r.rec);
  const ltmClientCands = ltmClientResults.map((r) => r.rec);

  const pick = (cands: MemoryRecord[], topK: number, minSem: number | null) => {
    const selected: MemoryRecord[] = [];
    const scored: Array<{ rec: MemoryRecord; score: number }> = [];
    for (const rec of cands) {
      if (minSem != null && rec.embedding && rec.embedding.length > 0) {
        const sem = clamp((cosine(queryEmb, rec.embedding) + 1) / 2);
        if (sem < minSem && rec.importance < 0.7) continue;
      }
      scored.push({ rec, score: 0 });
    }
    for (let i = 0; i < topK && scored.length > 0; i++) {
      let bestIdx = -1;
      let bestScore = -Infinity;
      for (let j = 0; j < scored.length; j++) {
        const s = scoreRecord(scored[j].rec, queryEmb, req.emotion, selected, boostEmotion);
        if (s > bestScore) {
          bestScore = s;
          bestIdx = j;
        }
      }
      if (bestIdx === -1) break;
      const picked = scored.splice(bestIdx, 1)[0];
      picked.score = bestScore;
      selected.push(picked.rec);
    }
    return selected.map((rec) => ({ rec, score: scoreRecord(rec, queryEmb, req.emotion, [], boostEmotion) }));
  };

  const mtmPicked = pick(mtmCandidates, CONFIG.retrieval.topK.mtm, CONFIG.retrieval.minSemScore);
  const ltmUserPicked = pick(ltmUserCands, CONFIG.retrieval.topK.ltmUser, null);
  const ltmClientPicked = pick(ltmClientCands, CONFIG.retrieval.topK.ltmClient, null);

  const scores = [...mtmPicked, ...ltmUserPicked, ...ltmClientPicked].map((x) => ({
    id: x.rec.id,
    score: Number(x.score.toFixed(4)),
  }));

  return {
    stm: stmTurns,
    mtm: mtmPicked.map((x) => x.rec),
    ltmUser: ltmUserPicked.map((x) => x.rec),
    ltmClient: ltmClientPicked.map((x) => x.rec),
    scores,
  };
}

export function topScore(retrieved: RetrievedContext): number {
  if (retrieved.scores.length === 0) return 0;
  return Math.max(...retrieved.scores.map((s) => s.score));
}

export function utteranceEmotion(u: Utterance) {
  return u.emotion;
}
