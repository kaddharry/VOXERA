import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "../../../../lib/telephony/rate-limit";
import { placeOutboundCall, isLocalBaseUrl, resolveBaseUrl } from "../../../../lib/telephony/outbound";

export const dynamic = "force-dynamic";

const OUTBOUND_CALL_LIMIT = 1;
const OUTBOUND_CALL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/**
 * POST /api/telephony/outbound
 *
 * Initiates an outbound AI call to a destination phone number.
 *
 * This route has no user authentication (it's callable from the public
 * /demo page), so it's rate-limited per-IP to prevent it being used to
 * trigger unlimited real, cost-incurring Twilio calls.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit(`ratelimit:outbound-call:${ip}`, OUTBOUND_CALL_LIMIT, OUTBOUND_CALL_WINDOW_MS);
    if (!rateLimit.allowed) {
      const retryAfterSec = Math.ceil((rateLimit.retryAfterMs ?? 0) / 1000);
      return NextResponse.json(
        { error: `Too many calls requested. Try again in ${retryAfterSec}s.`, retryAfterMs: rateLimit.retryAfterMs },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
      );
    }

    const body = await req.json();
    const { to, clientId = "demo" } = body;

    if (!to || typeof to !== "string") {
      return NextResponse.json({ error: "Destination phone number 'to' is required." }, { status: 400 });
    }

    const baseUrl = resolveBaseUrl(req);

    // Twilio calls this webhook from the public internet — it can never reach
    // localhost. Fail fast with an actionable message instead of silently
    // placing a call Twilio will fail to connect (see docs/PHONE_CALL_DEMO_SETUP.md).
    if (isLocalBaseUrl(baseUrl)) {
      return NextResponse.json(
        {
          error:
            "Outbound calls need a public URL Twilio can reach. Start ngrok (`ngrok http 3000`) and set NEXT_PUBLIC_BASE_URL to the ngrok URL in .env.local, then restart the dev server. See docs/PHONE_CALL_DEMO_SETUP.md.",
        },
        { status: 400 }
      );
    }

    const { callSid, status } = await placeOutboundCall({ to, clientId, baseUrl });

    return NextResponse.json({ success: true, callSid, status });
  } catch (err: any) {
    console.error("[Outbound API] Failed to trigger call:", err);
    return NextResponse.json({ error: err.message || "Failed to trigger outbound call" }, { status: 500 });
  }
}
