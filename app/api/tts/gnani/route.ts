import type { NextRequest } from "next/server";
import { synthesizeGnaniDemo, type GnaniLanguage } from "@/lib/tts/gnani";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Gnani voice preview for the Agent Builder / Settings voice pickers —
 * mirrors app/api/tts/route.ts's shape for the Deepgram picker. */
export async function POST(request: NextRequest) {
  if (!process.env.GNANI_API_KEY) {
    return Response.json({ error: "GNANI_API_KEY not configured" }, { status: 501 });
  }
  const body = (await request.json()) as { text?: string; voice?: string; model?: string; language?: GnaniLanguage };
  if (!body.text || body.text.length === 0) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  if (!body.voice) {
    return Response.json({ error: "voice is required" }, { status: 400 });
  }
  try {
    const audio = await synthesizeGnaniDemo(body.text, { voice: body.voice, model: body.model, language: body.language });
    const ab = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
    return new Response(ab, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}
