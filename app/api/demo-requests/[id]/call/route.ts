import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../lib/db/server";
import { supabase as supabaseService } from "../../../../../lib/db/supabase";
import { getDemoRequest, setDemoRequestCalling } from "../../../../../lib/db/demo-requests";
import { placeOutboundCall, isLocalBaseUrl, resolveBaseUrl } from "../../../../../lib/telephony/outbound";
import { checkRateLimit } from "../../../../../lib/telephony/rate-limit";

export const dynamic = "force-dynamic";

const CALL_LIMIT = 1;
const CALL_WINDOW_MS = 10 * 60 * 1000;

/**
 * POST /api/demo-requests/[id]/call — spec §5.3 step 7: place the demo
 * call only once the request is linked, confirmed, and consented. Uses the
 * literal clientId "demo" (lib/bootstrap.ts's DEMO constant / the same
 * default /api/telephony/outbound already uses for the public /demo page),
 * so these calls stay isolated from any real tenant's production call_logs
 * and analytics (spec §5.4) — never the authenticated caller's own tenant
 * clientId, even though they're now signed in.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const demoRequest = await getDemoRequest(supabaseService, id);
  if (!demoRequest || demoRequest.linkedUserId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!demoRequest.consent) {
    return NextResponse.json({ error: "Consent is required before a demo call can be placed." }, { status: 400 });
  }
  // "failed" is retryable (spec §5.3 step 9: a failed attempt must offer a
  // real retry, not a dead end) — any other non-"ready" status (already
  // calling, completed, cancelled) is not.
  if (demoRequest.status !== "ready" && demoRequest.status !== "failed") {
    return NextResponse.json({ error: `This demo request is not callable right now (status: ${demoRequest.status}).` }, { status: 400 });
  }

  const rateLimit = await checkRateLimit(`ratelimit:demo-call:${user.id}`, CALL_LIMIT, CALL_WINDOW_MS);
  if (!rateLimit.allowed) {
    const retryAfterSec = Math.ceil((rateLimit.retryAfterMs ?? 0) / 1000);
    return NextResponse.json(
      { error: `Too many calls requested. Try again in ${retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  const baseUrl = resolveBaseUrl(request);
  if (isLocalBaseUrl(baseUrl)) {
    return NextResponse.json(
      { error: "Demo calls need a public URL Twilio can reach. Set NEXT_PUBLIC_BASE_URL (see docs/PHONE_CALL_DEMO_SETUP.md)." },
      { status: 400 },
    );
  }

  try {
    const { callSid } = await placeOutboundCall({ to: demoRequest.phone, clientId: "demo", baseUrl });
    await setDemoRequestCalling(supabaseService, id, user.id, callSid);
    return NextResponse.json({ callSid, status: "calling" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to place demo call" }, { status: 500 });
  }
}
