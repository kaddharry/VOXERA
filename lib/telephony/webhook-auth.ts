import type { NextRequest } from "next/server";
import { validateTwilioSignature } from "./twilio";
import { resolvePublicBaseUrl, resolveVoiceWebSocketUrl } from "./urls";

/**
 * Twilio request verification for every Twilio-facing endpoint.
 *
 * HTTP webhooks: Twilio signs the full URL it was given (query string
 * included) plus the POST params. When TWILIO_AUTH_TOKEN isn't set (local
 * development only) verification is skipped, exactly as the incoming
 * webhook always behaved.
 */
export function verifyTwilioWebhook(req: NextRequest, params: Record<string, string>): { ok: boolean; skipped: boolean } {
  if (!process.env.TWILIO_AUTH_TOKEN) return { ok: true, skipped: true };
  const baseUrl = resolvePublicBaseUrl({ configured: process.env.VOXERA_PUBLIC_URL || process.env.NEXT_PUBLIC_BASE_URL, requestUrl: req.url });
  const url = `${baseUrl}${req.nextUrl.pathname}${req.nextUrl.search}`;
  const ok = validateTwilioSignature(url, params, req.headers.get("x-twilio-signature") || "");
  if (!ok) {
    console.warn(JSON.stringify({ service: "telephony", event: "twilio_signature_invalid", path: req.nextUrl.pathname }));
  }
  return { ok, skipped: false };
}

/**
 * The Media Stream WebSocket handshake also carries X-Twilio-Signature,
 * computed over the exact wss:// URL from the TwiML and NO params. The URL we
 * put in the TwiML is the first candidate; the request's own host/path (and
 * a trailing-slash variant) are accepted too, so a proxy rewriting the path
 * slightly can't lock every call out.
 *
 * TWILIO_VALIDATE_STREAM_SIGNATURE=false switches a mismatch to log-only. It
 * exists only as an emergency switch while this is confirmed on live calls:
 * a wrong rejection here would refuse every call.
 */
export function verifyTwilioStreamHandshake(req: Request): { ok: boolean; enforced: boolean; skipped: boolean } {
  const enforced = process.env.TWILIO_VALIDATE_STREAM_SIGNATURE?.trim().toLowerCase() !== "false";
  if (!process.env.TWILIO_AUTH_TOKEN) return { ok: true, enforced, skipped: true };

  const signature = req.headers.get("x-twilio-signature") || "";
  const requestUrl = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || requestUrl.host;
  const candidates = new Set<string>();
  try {
    const baseUrl = resolvePublicBaseUrl({ configured: process.env.VOXERA_PUBLIC_URL || process.env.NEXT_PUBLIC_BASE_URL, requestUrl: req.url });
    candidates.add(resolveVoiceWebSocketUrl(baseUrl));
  } catch {
    // fall through to the request-derived candidates
  }
  const fromRequest = `wss://${host}${requestUrl.pathname}`;
  candidates.add(fromRequest);
  candidates.add(fromRequest.endsWith("/") ? fromRequest.slice(0, -1) : `${fromRequest}/`);

  const ok = signature !== "" && [...candidates].some((url) => validateTwilioSignature(url, {}, signature));
  if (!ok) {
    console.warn(
      JSON.stringify({
        service: "telephony",
        event: "stream_signature_invalid",
        enforced,
        hasSignature: signature !== "",
        candidates: [...candidates],
      }),
    );
  }
  return { ok, enforced, skipped: false };
}
