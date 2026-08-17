import { nanoid } from "nanoid";
import { CONFIG } from "../config";
import { buildEmotionContext } from "../emotion/context";
import { detectTextEmotion, fuseEmotion } from "../emotion/detect";
import { detectAudioEmotion } from "../emotion/audio-emotion";
import { importanceScore, novelty, policyFlag, taskCriticality } from "../emotion/importance";
import { calculateCAI, type CAIResult } from "../emotion/cai";
import { runDiagnosticEmotion, type DiagnosticEmotionResult } from "../emotion/emotion-debug";
import { logSessionEvent, makeEvent } from "../logging/session-logger";
import { emitSessionEvent } from "../realtime/emitter";
import { supabase as supabaseService } from "../db/supabase";
import { getAgentWithTenant } from "../db/agents";
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
  /** Per-call override for CONFIG.emotion.diagnosticMode — lets callers (e.g. the demo UI) opt into the full engine breakdown without changing the global production default. */
  diagnostics?: boolean;
  /** Manual acoustic-engine calibration knob (-1..1, default 0) — see
   * detectAudioEmotion()'s opts doc in lib/emotion/audio-emotion.ts.
   * Positive nudges scoring toward positive/calm labels, negative toward
   * negative labels. Lets a judge/operator counteract the acoustic engine's
   * documented tendency to over-read ambiguous audio as negative. */
  sensitivityBias?: number;
  /** Raw mono PCM at 16kHz (as Float32 samples in [-1, 1]) for the wav2vec2
   * acoustic ML diagnostic engine (see lib/emotion/local-audio-detect.ts).
   * Server-only (not part of the JSON /api/turn schema — Buffer/Float32Array
   * isn't a sane wire format there); server.ts's browser-mic capture is
   * already 16kHz, so no resampling is needed for that path. Telephony
   * audio is 8kHz mulaw natively and doesn't populate this. */
  rawAudioPcm16k?: Float32Array;
  /** Agent Builder (lib/db/agents.ts) agent id. When present, its owning
   * tenant's clientId overrides the plain `clientId` field above (so
   * retrieval/knowledge scoping follows the agent, not a separately-passed
   * value), and its system_prompt is layered into the LLM system prompt. */
  agentId?: string;
}

/** Lightweight, judge-readable view of a MemoryRecord — enough to show WHY a
 * memory was retrieved without shipping the full record (embedding vector,
 * etc.) over the wire. */
export interface MemorySnippet {
  id: string;
  summary: string;
  topic: string;
  emotion: string;
  importance: number;
  ts: number;
}

export interface TurnTrace {
  utterance: Utterance;
  emotion: ReturnType<typeof buildEmotionContext>;
  importance: number;
  memoryWrite: Awaited<ReturnType<typeof writeMemory>>;
  retrieved: {
    mtmIds: string[];
    ltmUserIds: string[];
    ltmClientIds: string[];
    scores: { id: string; score: number }[];
    explanations?: Record<string, any>;
    timeline?: any[];
    /** Actual retrieved memory content, not just IDs/counts — the evidence a
     * judge (or the LLM itself, via citations) can point at directly. */
    mtmSnippets?: MemorySnippet[];
    ltmUserSnippets?: MemorySnippet[];
    ltmClientSnippets?: MemorySnippet[];
  };
  policy: ReturnType<typeof decidePolicy>;
  guardReasons: string[];
  llmModel: string;
  usedLiveLlm: boolean;
  cai?: CAIResult;
  inputGuardResult?: InputGuardResult;
  acousticFeatures?: AcousticFeatures;
  /** Present only when CONFIG.emotion.diagnosticMode is on — full HF/Lexicon/Local ONNX/Acoustic comparison. */
  emotionDiagnostics?: DiagnosticEmotionResult;
  /** Present when this turn was routed through a custom Agent Builder agent
   * (TurnInput.agentId resolved successfully) — lets the UI show which
   * agent actually generated the reply, and lets the TTS call site (server.ts,
   * stream-handler.ts) synthesize with the agent's own chosen voice instead
   * of silently falling back to the global default. */
  agent?: { id: string; name: string; voicePersona?: string | null };
  /** Wall-clock ms spent in each server-side stage of this turn — real
   * measurements, not estimates, wired into the Live Engine Console's
   * pipeline visual. sttMs/ttsMs are filled in by server.ts for realtime
   * calls; text-only callers (e.g. /api/turn) only get the stages they hit. */
  timings?: {
    sttMs?: number;
    emotionMs: number;
    retrievalMs: number;
    llmMs: number;
    ttsMs?: number;
    totalMs: number;
  };
}

export interface TurnOutput {
  reply: string;
  trace: TurnTrace;
}

export async function handleTurn(input: TurnInput): Promise<TurnOutput> {
  const turnStart = Date.now();
  const ts = turnStart;
  const sttConf = input.sttConfidence ?? 1;

  // Resolve a custom Agent Builder agent before anything else keys off
  // clientId — the agent's owning tenant becomes the effective clientId for
  // knowledge/memory scoping, and its system_prompt flows into the LLM
  // context below. Falls back silently to the plain clientId/DEMO agent on
  // any lookup failure (unknown id, Supabase unreachable) rather than
  // failing the turn.
  let customInstructions: string | undefined;
  let resolvedAgent: { id: string; name: string; voicePersona?: string | null } | undefined;
  if (input.agentId) {
    try {
      const agentInfo = await getAgentWithTenant(supabaseService, input.agentId);
      if (agentInfo) {
        input.clientId = agentInfo.tenant_auth_user_id;
        customInstructions = agentInfo.system_prompt ?? undefined;
        resolvedAgent = { id: agentInfo.id, name: agentInfo.name, voicePersona: agentInfo.voice_persona };
      }
    } catch (err) {
      console.warn("[Orchestrator] Failed to resolve agentId, using default clientId:", err);
    }
  }

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

  const wantsDiagnostics = input.diagnostics ?? CONFIG.emotion.diagnosticMode;

  // ── Issue #14: Acoustic Emotion Analysis ────────────────────────────────
  // detectTextEmotion() now runs Local ONNX as part of its own production
  // routing (Local ONNX > HF > Lexicon — see detect.ts), so its result is
  // already available on textEmoResult.localOnnx for the diagnostics
  // breakdown below — no need for a second, separate Local ONNX call here.
  const textEmoResult = await detectTextEmotion(input.transcript);
  const textEmo = textEmoResult.primary;
  const audioEmo = input.acousticFeatures
    ? detectAudioEmotion(input.acousticFeatures, { sensitivityBias: input.sensitivityBias })
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

  const sttHistory = await stm.get(input.sessionId);
  const emotionCtx = buildEmotionContext({
    current: fused,
    stm: sttHistory,
    ltmUser: ltmUserAll,
  });
  const emotionMs = Date.now() - turnStart;

  // ── Phase 1 diagnostic instrumentation (off by default, see CONFIG.emotion.diagnosticMode) ──
  // Fired here but NOT awaited yet — kicked off concurrently with the
  // retrieval/LLM/guard work below and only awaited right before the trace
  // is assembled, so a slow diagnostics pass (e.g. the wav2vec2 acoustic ML
  // engine) overlaps with reply generation instead of blocking it. This is
  // the "emotion analysis runs in parallel, answering isn't gated on it"
  // fix — previously this was a plain serial `await` sitting entirely
  // before the LLM call even started.
  const diagnosticsPromise: Promise<DiagnosticEmotionResult | undefined> = wantsDiagnostics
    ? runDiagnosticEmotion(input.transcript, input.acousticFeatures, {
        stm: sttHistory,
        ltmUser: ltmUserAll,
      }, { textEmoResult, audioSignal: audioEmo, localOnnxResult: textEmoResult.localOnnx }, input.rawAudioPcm16k)
        .then((result) => {
          void logSessionEvent(makeEvent(evBase, "emotion_diagnostic", result as unknown as Record<string, unknown>));
          return result;
        })
        .catch((err) => {
          console.warn("[Orchestrator] emotion diagnostic run failed:", err);
          return undefined;
        })
    : Promise.resolve(undefined);

  void logSessionEvent(makeEvent(evBase, "utterance", {
    utteranceId: userTurn.id,
    role: userTurn.role,
    text: userTurn.text,
    sttConfidence: sttConf,
  }));
  void emitSessionEvent(input.sessionId, "transcript", {
    role: "user",
    text: userTurn.text,
    sttConfidence: sttConf,
  });

  const emotionData = {
    label: fused.label,
    intensity: fused.intensity,
    confidence: fused.confidence,
    confidenceCategory: fused.confidenceCategory,
    vad: fused.vad,
    trajectory: emotionCtx.trajectory,
    zDeviation: emotionCtx.zDeviation,
    flags: emotionCtx.flags,
  };
  void logSessionEvent(makeEvent(evBase, "emotion", emotionData));
  void emitSessionEvent(input.sessionId, "emotion", emotionData);

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

  const caiData = {
    score: cai.score,
    category: cai.category,
    explanation: cai.explanation,
  };
  void logSessionEvent(makeEvent(evBase, "cai", caiData));
  void emitSessionEvent(input.sessionId, "cai", caiData);

  const I = importanceScore({
    text: input.transcript,
    emotion: emotionCtx,
    novelty: novelty(queryEmbedding, mtmExisting),
    recurrence: mtmExisting.filter((m) => m.topic && input.transcript.toLowerCase().includes(m.topic)).length,
    taskCriticality: taskCriticality(input.transcript),
    policyFlag: policyFlag(emotionCtx),
  });

  const retrievalStart = Date.now();
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
  const retrievalMs = Date.now() - retrievalStart;

  const toSnippet = (r: (typeof retrieved.mtm)[number]): MemorySnippet => ({
    id: r.id,
    summary: r.summary,
    topic: r.topic,
    emotion: r.emotion,
    importance: r.importance_score ?? r.importance,
    ts: r.ts,
  });
  const mtmSnippets = retrieved.mtm.map(toSnippet);
  const ltmUserSnippets = retrieved.ltmUser.map(toSnippet);
  const ltmClientSnippets = retrieved.ltmClient.map(toSnippet);

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
    explanations: retrieved.explanations,
    timeline: retrieved.timeline,
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
    customInstructions,
  });

  const llmStart = Date.now();
  const llmReply = await generateReply({
    system: llmContext.system,
    user: llmContext.user,
    clientId: input.clientId,
    sessionId: input.sessionId,
    userId: input.userId,
  });
  const llmMs = Date.now() - llmStart;

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
  void emitSessionEvent(input.sessionId, "transcript", {
    role: "agent",
    text: guarded.cleaned,
  });

  void logSessionEvent(makeEvent(evBase, "guard", {
    ok: guarded.ok,
    reasons: guarded.reasons,
  }));

  void logSessionEvent(makeEvent(evBase, "llm_reply", {
    model: llmReply.model,
    usedLive: llmReply.usedLive,
    replyLength: guarded.cleaned.length,
  }));

  // Persist the agent's own utterance to session_logs the same way the
  // user's turn is (above) — llm_reply above only logs metadata, not the
  // text itself, so without this the Sessions history page could only ever
  // reconstruct half a transcript (the caller's side) after the fact; the
  // agent's replies previously existed only on the ephemeral SSE channel.
  void logSessionEvent(makeEvent(evBase, "utterance", {
    utteranceId: agentTurn.id,
    role: agentTurn.role,
    text: agentTurn.text,
  }));

  // By now the diagnostics promise (kicked off back when emotionCtx was
  // built, well before retrieval/LLM/guard ran) has had the entire
  // retrieval+LLM+guard pipeline's worth of time to finish concurrently —
  // in practice this await resolves immediately. It only actually waits
  // when diagnostics is unusually slow, and even then it's capped by
  // CONFIG.emotion.localAudioMlLatencyBudgetMs/localOnnxLatencyBudgetMs
  // rather than the old unbounded wav2vec2 cold-load risk.
  const emotionDiagnostics = await diagnosticsPromise;

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
        explanations: retrieved.explanations,
        timeline: retrieved.timeline,
        mtmSnippets,
        ltmUserSnippets,
        ltmClientSnippets,
      },
      policy,
      guardReasons: guarded.reasons,
      llmModel: llmReply.model,
      usedLiveLlm: llmReply.usedLive,
      cai,
      inputGuardResult: inputGuard,
      timings: {
        emotionMs,
        retrievalMs,
        llmMs,
        totalMs: Date.now() - turnStart,
      },
      acousticFeatures: input.acousticFeatures,
      emotionDiagnostics,
      agent: resolvedAgent,
    },
  };
}
