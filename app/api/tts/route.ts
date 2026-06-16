import type { NextRequest } from "next/server";
import { hasDeepgram } from "@/lib/deepgram/client";
import { synthesize } from "@/lib/deepgram/tts";
import type { PolicyDirectives } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasDeepgram()) {
    return Response.json(
      { error: "DEEPGRAM_API_KEY not configured" },
      { status: 501 },
    );
  }
  const body = (await request.json()) as { text?: string; policy?: PolicyDirectives; persona?: string };
  if (!body.text || body.text.length === 0) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  try {
    const audio = await synthesize(body.text, { policy: body.policy, persona: body.persona });
    const ab = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
    return new Response(ab, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}
