import { NextRequest } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { retrieve } from "../../../../lib/memory/retrieval";
import { ensureSeeded } from "../../../../lib/bootstrap";
import type { EmotionLabel, VAD } from "../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabaseServer = await createClient();
  const { data: { user } } = await supabaseServer.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureSeeded();

  try {
    const body = await request.json();
    const { queryText, userId, emotionLabel, intensity } = body;

    if (!queryText) {
      return Response.json({ error: "Missing queryText parameter" }, { status: 400 });
    }

    const resolvedUserId = userId || "user_42";
    const label: EmotionLabel = emotionLabel || "neutral";
    const intens: number = intensity ?? 0.0;

    // Build mock emotion context
    const mockEmotion = {
      current: {
        label,
        intensity: intens,
        confidence: 1.0,
        vad: { v: 0.5, a: 0.5, d: 0.5 } as VAD,
        source: "text" as const,
        at: Date.now(),
      },
      trajectory: { slope_v: 0, slope_a: 0, window: 5 },
      zDeviation: 0,
      flags: {
        repeated_frustration: label === "frustration",
        increasing_distress: label === "distress",
        affect_oscillation: false,
        chronic_negativity: false,
      },
      baseline: { v: 0.5, a: 0.5, d: 0.5, sigma_v: 0.1, sigma_a: 0.1, sigma_d: 0.1 },
    };

    const retrieved = await retrieve({
      sessionId: "rag-debug-session",
      userId: resolvedUserId,
      clientId: user.id, // Authenticated tenant ID
      queryText,
      emotion: mockEmotion,
    });

    return Response.json({ retrieved });
  } catch (err: any) {
    console.error("[RAG Debug] Error running debug query:", err);
    return Response.json({ error: err.message ?? "Failed to debug RAG" }, { status: 500 });
  }
}
