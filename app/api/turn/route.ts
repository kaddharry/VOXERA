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
    return Response.json(
      { error: err.message || "Internal server error", stack: process.env.NODE_ENV === "development" ? err.stack : undefined },
      { status: 500 }
    );
  }
}
