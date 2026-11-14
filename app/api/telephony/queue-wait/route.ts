import { NextRequest, NextResponse } from "next/server";
import { buildQueueHoldTwiml, buildQueueLeaveTwiml } from "../../../../lib/telephony/twilio";
import { tryDispatchQueuedCall } from "../../../../lib/telephony/call-coordination";
import { verifyTwilioWebhook } from "../../../../lib/telephony/webhook-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/telephony/queue-wait — the <Enqueue> waitUrl.
 *
 * Twilio requests this when a caller joins the queue and again every time
 * the hold message below finishes (about every 15 s), for as long as they
 * wait. Each request asks Postgres (try_dispatch_queued_call) whether a slot
 * is free and this caller is first in line; if so the slot is claimed for
 * them atomically and we answer <Leave/>, after which Twilio requests the
 * <Enqueue> action URL (/api/telephony/dequeue) to connect the call.
 *
 * These polls are the dispatch mechanism: nothing has to stay running to
 * notice that a slot freed up. A caller who hangs up stops polling and is
 * marked abandoned after 90 s, so they can't block the line.
 */
export async function POST(req: NextRequest) {
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  if (!verifyTwilioWebhook(req, params).ok) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const callSid = params.CallSid || "";
  if (!callSid) {
    return new NextResponse(buildQueueHoldTwiml(null), { headers: { "Content-Type": "text/xml" } });
  }

  const result = await tryDispatchQueuedCall(callSid);
  console.log(JSON.stringify({ service: "telephony", event: "queue_poll", callSid, dispatch: result.dispatch, reason: result.reason, position: result.position ?? null }));
  const twiml = result.dispatch ? buildQueueLeaveTwiml() : buildQueueHoldTwiml(result.position ?? null);
  return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
}
