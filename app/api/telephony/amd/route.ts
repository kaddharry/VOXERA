import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/db/supabase";
import { hangUpCall, validateTwilioSignature } from "../../../../lib/telephony/twilio";
import { isMissingColumnError } from "../../../../lib/db/follow-up-tasks";

export const dynamic = "force-dynamic";

/** Twilio AnsweredBy values meaning nobody live picked up. */
const MACHINE_ANSWERS = new Set(["machine_start", "machine_end_beep", "machine_end_silence", "machine_end_other", "fax"]);

/**
 * POST /api/telephony/amd
 *
 * Twilio's asynchronous Answering Machine Detection callback for scheduled
 * follow-up calls (enabled in lib/telephony/outbound.ts). Fields:
 * CallSid, AccountSid, AnsweredBy, MachineDetectionDuration.
 *
 * Stores the verdict on the call (call_logs."answeredBy", migration_v24)
 * and, when a machine answered, hangs up — VOXERA never leaves a voicemail
 * (it could repeat health details to whoever plays it back). The call's
 * status callback then reads the stored verdict and retries the follow-up
 * (lib/scheduler/policy.ts: "voicemail"). A human or "unknown" verdict only
 * gets recorded; the transcript decides how that call went.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const params = Object.fromEntries(new URLSearchParams(body));

  if (process.env.TWILIO_AUTH_TOKEN) {
    const signature = req.headers.get("x-twilio-signature") || "";
    const url = `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/telephony/amd${req.nextUrl.search}`;
    if (!validateTwilioSignature(url, params, signature)) {
      console.warn("[Telephony/AMD] Invalid Twilio signature — rejecting request");
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const callSid = params.CallSid;
  const answeredBy = params.AnsweredBy;
  if (!callSid || !answeredBy) return NextResponse.json({ error: "Missing CallSid or AnsweredBy" }, { status: 400 });

  console.log(`[Telephony/AMD] CallSid=${callSid} answeredBy=${answeredBy} after ${params.MachineDetectionDuration ?? "?"}ms`);

  // Record first, then hang up: the hang-up triggers the status callback,
  // which must already see the verdict.
  const { error } = await supabase.from("call_logs").update({ answeredBy }).eq("id", callSid);
  if (error && !isMissingColumnError(error)) console.error("[Telephony/AMD] Failed to record AnsweredBy:", error.message);

  if (MACHINE_ANSWERS.has(answeredBy)) {
    const hungUp = await hangUpCall(callSid);
    console.log(`[Telephony/AMD] Voicemail/machine answered ${callSid} — ${hungUp ? "hung up" : "hang-up failed"}; the follow-up will be retried.`);
  }

  return NextResponse.json({ ok: true });
}
