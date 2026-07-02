import { nanoid } from "nanoid";
import { CONFIG } from "../config";
import { buildEmotionContext } from "../emotion/context";
import { detectTextEmotion, fuseEmotion } from "../emotion/detect";
import { importanceScore, novelty, policyFlag, taskCriticality } from "../emotion/importance";
import { calculateCAI, type CAIResult } from "../emotion/cai";
import { logSessionEvent, makeEvent } from "../logging/session-logger";
import { retrieve, topScore } from "../memory/retrieval";
import { stm } from "../memory/stm";
import { vectorStore } from "../memory/store";
import { writeMemory } from "../memory/writer";
import type { Utterance, EmotionSignal } from "../types";
import { embed } from "../util/embed";
import { buildLLMContext } from "./context";
import { guardOutput } from "./guard";
import { generateReply } from "./llm";
import { decidePolicy } from "./policy";

export interface TurnInput {
  sessionId: string;
  userId: string;
  clientId: string;
  transcript: string;
  sttConfidence?: number;
  audioEmotion?: EmotionSignal | null;
}

export interface TurnTrace {
  utterance: Utterance;
  emotion: ReturnType<typeof buildEmotionContext>;
  importance: number;
  memoryWrite: Awaited<ReturnType<typeof writeMemory>>;
  retrieved: { mtmIds: string[]; ltmUserIds: string[]; ltmClientIds: string[]; scores: { id: string; score: number }[] };
  policy: ReturnType<typeof decidePolicy>;
  guardReasons: string[];
  llmModel: string;
  usedLiveLlm: boolean;
  cai?: CAIResult;
}

export interface TurnOutput {
  reply: string;
  trace: TurnTrace;
}

export async function handleTurn(input: TurnInput): Promise<TurnOutput> {
  const ts = Date.now();
  const sttConf = input.sttConfidence ?? 1;

  const textEmo = detectTextEmotion(input.transcript);
  const fused = fuseEmotion(textEmo, input.audioEmotion ?? null);

  const userTurn: Utterance = {
    id: nanoid(8),
    role: "user",
    text: input.transcript,
    sttConfidence: sttConf,
    emotion: fused,
    ts,
  };
  stm.push(input.sessionId, userTurn);

  const evBase = { sessionId: input.sessionId, userId: input.userId, clientId: input.clientId };

  // ── Phase 1: Parallel DB fetches ──────────────────────────────────────────
  // LTM_user and MTM are independent — fetch them concurrently.
  const queryEmbedding = embed(input.transcript);
  const [ltmUserAll, mtmExisting] = await Promise.all([
    vectorStore.byTier("LTM_user", input.userId, input.clientId),
    vectorStore.byTier("MTM", input.userId, input.clientId),
  ]);

  const emotionCtx = buildEmotionContext({
    current: fused,
    stm: stm.get(input.sessionId),
    ltmUser: ltmUserAll,
  });

  // ── Fire-and-forget logging (never blocks the response path) ──────────────
  void logSessionEvent(makeEvent(evBase, "utterance", {
    utteranceId: userTurn.id,
    role: userTurn.role,
    text: userTurn.text,
    sttConfidence: sttConf,
  }));

  void logSessionEvent(makeEvent(evBase, "emotion", {
    label: fused.label,
    intensity: fused.intensity,
    confidence: fused.confidence,
    confidenceCategory: fused.confidenceCategory,
    vad: fused.vad,
    trajectory: emotionCtx.trajectory,
    zDeviation: emotionCtx.zDeviation,
    flags: emotionCtx.flags,
  }));

  // FR-20: Calculate Commitment Acoustic Index (CAI)
  const responseLength = input.transcript.split(/\s+/).length;
  // Approximations since we don't have true acoustic feature extractors yet
  const cai = calculateCAI({
    pitchVariation: fused.vad.a > 0.3 ? 0.8 : 0.4,
    speakingRate: 140, // assume normal
    interruptions: 0,
    pauseDurationMs: 500,
    responseLength,
  });

  void logSessionEvent(makeEvent(evBase, "cai", {
    score: cai.score,
    category: cai.category,
    explanation: cai.explanation
  }));

  // ── Phase 2: Importance scoring (uses mtmExisting from Phase 1) ───────────
  const I = importanceScore({
    text: input.transcript,
    emotion: emotionCtx,
    novelty: novelty(queryEmbedding, mtmExisting),
    recurrence: mtmExisting.filter((m) => m.topic && input.transcript.toLowerCase().includes(m.topic)).length,
    taskCriticality: taskCriticality(input.transcript),
    policyFlag: policyFlag(emotionCtx),
  });

  // ── Phase 3: Memory write + retrieval in parallel ─────────────────────────
  // These are independent: writeMemory writes a new record, retrieve reads existing ones.
  const [memoryWrite, retrieved] = await Promise.all([
    writeMemory({
      utterance: userTurn,
      userId: input.userId,
      clientId: input.clientId,
      emotion: emotionCtx,
      importance: I,
    }),
    retrieve({
      sessionId: input.sessionId,
      userId: input.userId,
      clientId: input.clientId,
      queryText: input.transcript,
      emotion: emotionCtx,
    }),
  ]);

  const policy = decidePolicy(emotionCtx);

  // Fire-and-forget logging for memory, retrieval, and policy events
  void logSessionEvent(makeEvent(evBase, "memory_write", {
    tier: memoryWrite.tier,
    recordId: memoryWrite.recordId,
    merged: memoryWrite.merged,
    importance: I,
  }));

  void logSessionEvent(makeEvent(evBase, "retrieval", {
    mtmIds: retrieved.mtm.map((m) => m.id),
    ltmUserIds: retrieved.ltmUser.map((m) => m.id),
    ltmClientIds: retrieved.ltmClient.map((m) => m.id),
    scores: retrieved.scores,
  }));

  void logSessionEvent(makeEvent(evBase, "policy", {
    acknowledgeFirst: policy.acknowledgeFirst,
    pace: policy.pace,
    allowUpsell: policy.allowUpsell,
    escalate: policy.escalate,
    notes: policy.notes,
  }));

  if (policy.escalate !== "none") {
    void logSessionEvent(makeEvent(evBase, "escalation", {
      type: policy.escalate,
      reason: policy.notes.join(", ")
    }));
  }

  // ── Phase 4: LLM call (the only truly blocking external call) ─────────────
  const llmContext = buildLLMContext({
    userId: input.userId,
    clientId: input.clientId,
    userTurn,
    retrieved,
    emotion: emotionCtx,
    policy,
  });

  const llmReply = await generateReply({
    system: llmContext.system,
    user: llmContext.user,
    clientId: input.clientId,
    sessionId: input.sessionId,
    userId: input.userId,
  });

  const guarded = guardOutput({
    reply: llmReply.text,
    allowedCitations: llmContext.citations,
    policy,
    sttConfidence: sttConf,
    topRetrievalScore: topScore(retrieved),
    minStt: CONFIG.gates.minSttConfidence,
    minRetrieval: CONFIG.gates.minRetrievalScore,
  });

  const agentTurn: Utterance = {
    id: nanoid(8),
    role: "agent",
    text: guarded.cleaned,
    ts: Date.now(),
  };
  stm.push(input.sessionId, agentTurn);

  // Fire-and-forget final logging
  void logSessionEvent(makeEvent(evBase, "guard", {
    ok: guarded.ok,
    reasons: guarded.reasons,
  }));

  void logSessionEvent(makeEvent(evBase, "llm_reply", {
    model: llmReply.model,
    usedLive: llmReply.usedLive,
    replyLength: guarded.cleaned.length,
  }));

  return {
    reply: guarded.cleaned,
    trace: {
      utterance: userTurn,
      emotion: emotionCtx,
      importance: I,
      memoryWrite,
      retrieved: {
        mtmIds: retrieved.mtm.map((m) => m.id),
        ltmUserIds: retrieved.ltmUser.map((m) => m.id),
        ltmClientIds: retrieved.ltmClient.map((m) => m.id),
        scores: retrieved.scores,
      },
      policy,
      guardReasons: guarded.reasons,
      llmModel: llmReply.model,
      usedLiveLlm: llmReply.usedLive,
      cai,
    },
  };
}
