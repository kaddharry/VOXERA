import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/db/supabase";
import { validateTwilioSignature } from "../../../../lib/telephony/twilio";
import { resolvePublicBaseUrl, publicWebhookUrl } from "../../../../lib/telephony/urls";

export const dynamic = "force-dynamic";

/** Twilio <Stream> lifecycle callback. */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const params = Object.fromEntries(new URLSearchParams(body));
  const callSid = params.CallSid;
  const streamSid = params.StreamSid;
  const streamEvent = params.StreamEvent;
  const streamError = params.StreamError || null;

  if (!callSid || !["stream-started", "stream-stopped", "stream-error"].includes(streamEvent)) {
    return NextResponse.json({ error: "Invalid stream callback" }, { status: 400 });
  }

  if (process.env.TWILIO_AUTH_TOKEN) {
    const baseUrl = resolvePublicBaseUrl({ configured: process.env.VOXERA_PUBLIC_URL || process.env.NEXT_PUBLIC_BASE_URL, requestUrl: req.url });
    const signatureUrl = publicWebhookUrl(baseUrl, `/api/telephony/stream-status${req.nextUrl.search}`);
    if (!validateTwilioSignature(signatureUrl, params, req.headers.get("x-twilio-signature") || "")) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const { data: call, error: lookupError } = await supabase
    .from("call_logs")
    .select('id, "clientId"')
    .eq("id", callSid)
    .maybeSingle();
  if (lookupError) {
    console.error(JSON.stringify({ service: "telephony", event: "stream_status_lookup_failed", timestamp: new Date().toISOString(), callSid, error: lookupError.message }));
    return NextResponse.json({ error: "Could not associate stream callback" }, { status: 503 });
  }
  if (!call) return NextResponse.json({ error: "Unknown call" }, { status: 404 });

  const { error: updateError } = await supabase.from("call_logs").update({
    streamSid: streamSid || null,
    streamStatus: streamEvent,
    streamError,
    streamStatusAt: Date.now(),
  }).eq("id", callSid).eq("clientId", call.clientId);
  if (updateError) {
    console.error(JSON.stringify({ service: "telephony", event: "stream_status_update_failed", timestamp: new Date().toISOString(), callSid, streamSid: streamSid || null, clientId: call.clientId, streamEvent, error: updateError.message }));
    return NextResponse.json({ error: "Could not save stream callback" }, { status: 503 });
  }

  console.info(JSON.stringify({ service: "telephony", event: "twilio_stream_status", timestamp: params.Timestamp || new Date().toISOString(), callSid, streamSid: streamSid || null, clientId: call.clientId, streamEvent, streamError }));
  return new NextResponse(null, { status: 204 });
}
