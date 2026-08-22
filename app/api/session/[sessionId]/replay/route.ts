import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../lib/db/server";
import { getSessionLog } from "../../../../../lib/logging/session-logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/session/[sessionId]/replay
 *
 * Reconstructs a Live Dashboard-shaped snapshot (transcript, latest emotion/
 * CAI/diagnostics, and the "Data Source" explainability panel) from the
 * PERSISTED session_logs event log — the historical counterpart to the
 * live SSE stream at /api/session/[sessionId]/stream, which only carries
 * events for a call that's still in progress. This is what lets an ended
 * call stay reviewable on the Live Dashboard page itself instead of only
 * ever being visible while it's active.
 *
 * Ownership-scoped (unlike the older, unscoped GET /api/session/[sessionId]
 * raw-events endpoint) — a caller can only replay a session tied to one of
 * their own call_logs rows.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!sessionId?.trim()) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: call } = await supabase
    .from("call_logs")
    .select("id, callerNumber, status, startedAt, endedAt, durationMs")
    .eq("sessionId", sessionId)
    .eq("clientId", user.id)
    .maybeSingle();

  if (!call) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const events = await getSessionLog(sessionId);

  const transcript: { role: "user" | "agent"; text: string }[] = [];
  let emotionLabel = "neutral";
  let intensity = 0;
  let confidence = 0.5;
  let flags: Record<string, boolean> = {};
  let caiScore = 50;
  let caiCategory = "Moderate Engagement";
  let diagnostics: Record<string, unknown> | null = null;
  // The live "retrieval" explainability shape (usedFallback/topSource/...)
  // only ever existed on the ephemeral SSE channel — session_logs persists
  // the raw ingredients instead (a "retrieval" event with memory ids/
  // scores/explanations, and a separate "guard" event with the reasons that
  // reveal whether the fallback/hedge language was used). Reconstruct the
  // same derivation orchestrator.ts does live, from the last such pair.
  let lastRetrievalPayload: Record<string, any> | null = null;
  let lastGuardPayload: Record<string, any> | null = null;
  let lastAgentText: string | undefined;

  for (const event of events) {
    switch (event.type) {
      case "utterance": {
        const role = event.payload.role as "user" | "agent";
        const text = event.payload.text as string;
        if (role && text) {
          transcript.push({ role, text });
          if (role === "agent") lastAgentText = text;
        }
        break;
      }
      case "emotion": {
        emotionLabel = (event.payload.label as string) ?? emotionLabel;
        intensity = (event.payload.intensity as number) ?? intensity;
        confidence = (event.payload.confidence as number) ?? confidence;
        flags = (event.payload.flags as Record<string, boolean>) ?? flags;
        break;
      }
      case "cai": {
        caiScore = (event.payload.score as number) ?? caiScore;
        caiCategory = (event.payload.category as string) ?? caiCategory;
        break;
      }
      case "emotion_diagnostic": {
        diagnostics = event.payload as Record<string, unknown>;
        break;
      }
      case "retrieval": {
        lastRetrievalPayload = event.payload as Record<string, any>;
        break;
      }
      case "guard": {
        lastGuardPayload = event.payload as Record<string, any>;
        break;
      }
    }
  }

  let retrieval: {
    usedFallback: boolean;
    fallbackText?: string;
    topSource: string | null;
    reason?: string;
    similarity?: number;
  } | null = null;

  if (lastRetrievalPayload) {
    const scores: { id: string; score: number }[] = lastRetrievalPayload.scores ?? [];
    const topEntry = [...scores].sort((a, b) => b.score - a.score)[0];
    const usedFallback = (lastGuardPayload?.reasons ?? []).some((r: string) => r.includes("hedging factual claim"));
    const explanations = lastRetrievalPayload.explanations ?? {};
    const topExplanation = topEntry ? explanations[topEntry.id] : undefined;
    const mtmIds: string[] = lastRetrievalPayload.mtmIds ?? [];
    const ltmUserIds: string[] = lastRetrievalPayload.ltmUserIds ?? [];
    const ltmClientIds: string[] = lastRetrievalPayload.ltmClientIds ?? [];
    const topTier = topEntry
      ? mtmIds.includes(topEntry.id)
        ? "EVIDENCE (recent memory)"
        : ltmUserIds.includes(topEntry.id)
          ? "USER_PROFILE"
          : ltmClientIds.includes(topEntry.id)
            ? "CLIENT (knowledge base)"
            : "unknown"
      : null;
    retrieval = {
      usedFallback,
      fallbackText: usedFallback ? lastAgentText : undefined,
      topSource: topTier,
      reason: topExplanation?.reason,
      similarity: topExplanation?.metrics?.similarity,
    };
  }

  return NextResponse.json({
    call: {
      id: call.id,
      callerNumber: call.callerNumber,
      status: call.status,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      durationMs: call.durationMs,
    },
    liveState: {
      sessionId,
      emotionLabel,
      intensity,
      confidence,
      caiScore,
      caiCategory,
      flags,
      transcript,
      diagnostics,
      retrieval,
    },
  });
}
