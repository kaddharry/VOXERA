import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleTurn } from "@/lib/agent/orchestrator";
import { DEMO, ensureSeeded } from "@/lib/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TurnSchema = z.object({
  sessionId: z.string().min(1).default(DEMO.sessionId),
  userId: z.string().min(1).default(DEMO.userId),
  clientId: z.string().min(1).default(DEMO.clientId),
  transcript: z.string().min(1),
  sttConfidence: z.number().min(0).max(1).optional(),
});

export async function POST(request: NextRequest) {
  try {
    await ensureSeeded();
    const body = await request.json();
    const parsed = TurnSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
    }
    const out = await handleTurn(parsed.data);
    return Response.json(out);
  } catch (err: any) {
    console.error("[/api/turn] Unhandled error:", err);
    
    // Return a graceful fallback instead of a 500 so the voice agent doesn't crash
    const fallbackText = "I'm having a little trouble connecting right now. Could you hold on a moment or try again?";
    return Response.json({
      reply: fallbackText,
      trace: {
        utterance: {
          id: "err-fallback",
          role: "user",
          text: "",
          ts: Date.now(),
        },
        emotion: {
          current: { label: "neutral", intensity: 0, confidence: 1, confidenceCategory: "high", vad: {v:0, a:0, d:0}, source: "text", at: Date.now() },
          trajectory: "flat",
          zDeviation: 0,
          flags: {},
        },
        importance: 0,
        memoryWrite: { tier: "STM", recordId: "", merged: false },
        retrieved: { mtmIds: [], ltmUserIds: [], ltmClientIds: [], scores: [] },
        policy: { pace: "normal", acknowledgeFirst: false, allowUpsell: false, escalate: "none", notes: [] },
        guardReasons: [],
        llmModel: "fallback",
        usedLiveLlm: false,
      }
    });
  }
}
