import { initiateOutboundCall } from "./twilio";
import { supabase } from "../db/supabase";

export interface PlaceOutboundCallOptions {
  to: string;
  clientId: string;
  /** Agent whose prompt/knowledge base should handle the call once answered
   * — passed through as a query param on the webhook URL so /incoming can
   * resolve it without a phone_numbers lookup (see that route for why). */
  agentId?: string;
  baseUrl: string;
  /** Set when dispatched from a campaign, so the Twilio status callback can
   * update this specific campaign_calls row once the call finishes — see
   * app/api/telephony/status/route.ts. */
  campaignCallId?: number;
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
  const webhookUrl = `${opts.baseUrl}/api/telephony/incoming?${params.toString()}`;

  const statusParams = new URLSearchParams();
  if (opts.campaignCallId) statusParams.set("campaignCallId", String(opts.campaignCallId));
  const statusCallback = `${opts.baseUrl}/api/telephony/status${statusParams.toString() ? `?${statusParams}` : ""}`;

  const { callSid, status } = await initiateOutboundCall({ to: opts.to, webhookUrl, statusCallback });

  await supabase.from("call_logs").insert([{
    id: callSid,
    clientId: opts.clientId,
    callerNumber: opts.to,
    status: "outbound_initiated",
    startedAt: Date.now(),
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
