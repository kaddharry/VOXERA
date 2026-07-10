import { nanoid } from "nanoid";
import { CONFIG } from "../config";
import { buildEmotionContext } from "../emotion/context";
import { detectTextEmotion, fuseEmotion } from "../emotion/detect";
import { detectAudioEmotion } from "../emotion/audio-emotion";
import { importanceScore, novelty, policyFlag, taskCriticality } from "../emotion/importance";
import { calculateCAI, type CAIResult } from "../emotion/cai";
import { logSessionEvent, makeEvent } from "../logging/session-logger";
import { retrieve, topScore } from "../memory/retrieval";
import { stm } from "../memory/stm";
import { vectorStore } from "../memory/store";
import { writeMemory } from "../memory/writer";
import type { Utterance, EmotionSignal, AcousticFeatures } from "../types";
import { embed } from "../util/embed";
import { buildLLMContext } from "./context";
import { guardOutput } from "./guard";
import { guardInput, type InputGuardResult } from "./input-guard";
import { generateReply } from "./llm";
import { decidePolicy } from "./policy";

export interface TurnInput {
  sessionId: string;
  userId: string;
  clientId: string;
  transcript: string;
  sttConfidence?: number;
  audioEmotion?: EmotionSignal | null;
  /** Issue #14: Acoustic features extracted from the caller's PCM audio for this turn. */
  acousticFeatures?: AcousticFeatures;
  /** Issue #14: Number of barge-in interruptions detected during this turn. */
  bargeInCount?: number;
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
  inputGuardResult?: InputGuardResult;
  acousticFeatures?: AcousticFeatures;
}

export interface TurnOutput {
  reply: string;
  trace: TurnTrace;
}

export async function handleTurn(input: TurnInput): Promise<TurnOutput> {
  const ts = Date.now();
  const sttConf = input.sttConfidence ?? 1;
  const evBase = { sessionId: input.sessionId, userId: input.userId, clientId: input.clientId };

  // ── Issue #14: Pre-LLM Input Guard ─────────────────────────────────────
  const inputGuard = guardInput(input.transcript);
  if (!inputGuard.safe) {
    console.warn(
      `[Orchestrator] Input guard BLOCKED (score=${inputGuard.threatScore.toFixed(2)}, ` +
      `patterns=[${inputGuard.patterns.join(", ")}]): "${input.transcript.slice(0, 80)}..."`
    );

    void logSessionEvent(makeEvent(evBase, "input_guard", {
      safe: false,
      threatScore: inputGuard.threatScore,
      patterns: inputGuard.patterns,
    }));

    const deflection = inputGuard.deflection ?? "I'm sorry, could you rephrase that?";
    const agentTurn: Utterance = {
      id: nanoid(8),
      role: "agent",
      text: deflection,
      ts: Date.now(),
    };
    await stm.push(input.sessionId, agentTurn, input.clientId);

    return {
      reply: deflection,
      trace: {
        utterance: { id: nanoid(8), role: "user", text: input.transcript, sttConfidence: sttConf, ts },
        emotion: { current: { label: "neutral", intensity: 0, confidence: 0.5, vad: { v: 0, a: 0, d: 0 }, source: "text", at: ts }, trajectory: { slope_v: 0, slope_a: 0, window: 0 }, zDeviation: 0, flags: { repeated_frustration: false, increasing_distress: false, affect_oscillation: false, chronic_negativity: false }, baseline: { v: 0, a: 0, d: 0, sigma_v: 0.3, sigma_a: 0.3, sigma_d: 0.3 } },
        importance: 0,
        memoryWrite: { tier: "STM" as const, recordId: "", merged: false },
        retrieved: { mtmIds: [], ltmUserIds: [], ltmClientIds: [], scores: [] },
        policy: { acknowledgeFirst: false, pace: "normal" as const, allowUpsell: false, escalate: "none" as const, notes: ["Input blocked by guardrail"] },
        guardReasons: ["input_guard_blocked"],
        llmModel: "none",
        usedLiveLlm: false,
        inputGuardResult: inputGuard,
      },
    };
  }

  // ── Issue #14: Acoustic Emotion Analysis ────────────────────────────────
  const textEmo = detectTextEmotion(input.transcript);
  const audioEmo = input.acousticFeatures
    ? detectAudioEmotion(input.acousticFeatures)
    : (input.audioEmotion ?? null);
  const fused = fuseEmotion(textEmo, audioEmo);

  const userTurn: Utterance = {
    id: nanoid(8),
    role: "user",
    text: input.transcript,
    sttConfidence: sttConf,
    emotion: fused,
    ts,
  };
  await stm.push(input.sessionId, userTurn, input.clientId);


  const queryEmbedding = await embed(input.transcript);
  const [ltmUserResults, mtmSearchResults] = await Promise.all([
    vectorStore.search({
      tier: "LTM_user",
      userId: input.userId,
      clientId: input.clientId,
      query: queryEmbedding,
      topK: 10,
    }),
    vectorStore.search({
      tier: "MTM",
      userId: input.userId,
      clientId: input.clientId,
      query: queryEmbedding,
      topK: 20,
    }),
  ]);
  const ltmUserAll = ltmUserResults.map((r) => r.rec);
  const mtmExisting = mtmSearchResults.map((r) => r.rec);

  const emotionCtx = buildEmotionContext({
    current: fused,
    stm: await stm.get(input.sessionId),
    ltmUser: ltmUserAll,
  });

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

  // Issue #14: Use real acoustic metrics for CAI when available, fall back to heuristics
  const responseLength = input.transcript.split(/\s+/).length;
  const cai = calculateCAI({
    pitchVariation: input.acousticFeatures?.pitchVariation ?? (fused.vad.a > 0.3 ? 0.8 : 0.4),
    speakingRate: input.acousticFeatures?.speakingRateWPM ?? 140,
    interruptions: input.bargeInCount ?? 0,
    pauseDurationMs: input.acousticFeatures?.pauseDurationMs ?? 500,
    responseLength,
  });

  // Issue #14: Log acoustic features if available
  if (input.acousticFeatures) {
    void logSessionEvent(makeEvent(evBase, "acoustic", {
      rmsEnergy: input.acousticFeatures.rmsEnergy,
      pitchHz: input.acousticFeatures.pitchHz,
      pitchVariation: input.acousticFeatures.pitchVariation,
      speakingRateWPM: input.acousticFeatures.speakingRateWPM,
      pauseDurationMs: input.acousticFeatures.pauseDurationMs,
      pauseCount: input.acousticFeatures.pauseCount,
      durationMs: input.acousticFeatures.durationMs,
      zeroCrossingRate: input.acousticFeatures.zeroCrossingRate,
    }));
  }

  void logSessionEvent(makeEvent(evBase, "cai", {
    score: cai.score,
    category: cai.category,
    explanation: cai.explanation
  }));

  const I = importanceScore({
    text: input.transcript,
    emotion: emotionCtx,
    novelty: novelty(queryEmbedding, mtmExisting),
    recurrence: mtmExisting.filter((m) => m.topic && input.transcript.toLowerCase().includes(m.topic)).length,
    taskCriticality: taskCriticality(input.transcript),
    policyFlag: policyFlag(emotionCtx),
  });

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
  await stm.push(input.sessionId, agentTurn, input.clientId);

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
      inputGuardResult: inputGuard,
      acousticFeatures: input.acousticFeatures,
    },
  };
}
