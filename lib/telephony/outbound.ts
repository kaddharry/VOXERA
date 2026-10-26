import { initiateOutboundCall } from "./twilio";
import { supabase } from "../db/supabase";

export interface PlaceOutboundCallOptions {
  to: string;
  clientId: string;
  /** Agent whose prompt/knowledge base should handle the call once answered
   * — passed through as a query param on the webhook URL so /incoming can
   * resolve it without a phone_numbers lookup (see that route for why). */
  agentId?: string;
  /** Roster patient (lib/db/patients.ts) being called — threaded the same
   * way as agentId, so the orchestrator can inject this patient's `notes`
   * into the call's context (see lib/agent/context.ts's PATIENT CONTEXT
   * block). Also recorded on call_logs for the patient's call history. */
  patientId?: string;
  baseUrl: string;
  /** Set when dispatched from a campaign, so the Twilio status callback can
   * update this specific campaign_calls row once the call finishes — see
   * app/api/telephony/status/route.ts. */
  campaignCallId?: number;
  /** Set when dispatched by the follow-up scheduler. Stored on call_logs and
   * also put on the status callback URL, so the callback can find the task
   * even if it arrives before the call_logs row is written. */
  followUpTaskId?: string;
  /** Which attempt of that task this call is (1 = first). Sent back on the
   * status and voicemail-detection callbacks, so a late callback from an
   * earlier attempt can never be applied to a newer one. */
  followUpAttempt?: number;
}

/** Voicemail detection is on for scheduled follow-up calls unless
 * FOLLOWUP_AMD=off (it's a paid Twilio feature, billed per call). */
export function followUpAmdEnabled(): boolean {
  return (process.env.FOLLOWUP_AMD ?? "on").toLowerCase() !== "off";
}

/**
 * Places one outbound Twilio call and records it in call_logs. Shared by
 * the single "Place Outbound Call" route and the bulk campaign dispatcher
 * so both go through identical webhook-URL construction and logging —
 * duplicating this logic between them previously wasn't a risk (only one
 * call site existed), but a campaign calling it in a loop makes any drift
 * between the two paths much more consequential.
 */
export async function placeOutboundCall(opts: PlaceOutboundCallOptions): Promise<{ callSid: string; status: string }> {
  const params = new URLSearchParams({ clientId: opts.clientId });
  if (opts.agentId) params.set("agentId", opts.agentId);
  if (opts.patientId) params.set("patientId", opts.patientId);
  const webhookUrl = `${opts.baseUrl}/api/telephony/incoming?${params.toString()}`;

  const statusParams = new URLSearchParams();
  if (opts.campaignCallId) statusParams.set("campaignCallId", String(opts.campaignCallId));
  if (opts.followUpTaskId) statusParams.set("followUpTaskId", opts.followUpTaskId);
  if (opts.followUpTaskId && opts.followUpAttempt) statusParams.set("followUpAttempt", String(opts.followUpAttempt));
  const statusCallback = `${opts.baseUrl}/api/telephony/status${statusParams.toString() ? `?${statusParams}` : ""}`;

  const amd =
    opts.followUpTaskId && followUpAmdEnabled()
      ? { callbackUrl: `${opts.baseUrl}/api/telephony/amd${statusParams.toString() ? `?${statusParams}` : ""}` }
      : undefined;

  const { callSid, status } = await initiateOutboundCall({ to: opts.to, webhookUrl, statusCallback, answeringMachineDetection: amd });

  await supabase.from("call_logs").insert([{
    id: callSid,
    clientId: opts.clientId,
    callerNumber: opts.to,
    status: "outbound_initiated",
    startedAt: Date.now(),
    patientId: opts.patientId ?? null,
    ...(opts.followUpTaskId && { followUpTaskId: opts.followUpTaskId }),
  }]);

  return { callSid, status };
}

/** Twilio calls this webhook from the public internet — it can never reach
 * localhost, so outbound calls need NEXT_PUBLIC_BASE_URL pointed at a
 * publicly reachable URL (ngrok in local dev, the real deployment in prod). */
export function isLocalBaseUrl(baseUrl: string): boolean {
  return /localhost|127\.0\.0\.1/.test(baseUrl);
}

export function resolveBaseUrl(req: { headers: { get(name: string): string | null } }): string {
  const host = req.headers.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  return process.env.NEXT_PUBLIC_BASE_URL || `${protocol}://${host}`;
}
