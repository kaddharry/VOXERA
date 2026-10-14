import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/db/supabase";
import { createDemoRequest } from "../../../lib/db/demo-requests";
import { checkRateLimit } from "../../../lib/telephony/rate-limit";

export const dynamic = "force-dynamic";

const SUBMIT_LIMIT = 5;
const SUBMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[1-9]\d{7,14}$/;

/**
 * POST /api/demo-requests — public, unauthenticated (spec §5.3 step 1:
 * details come before signup). Rate-limited per-IP, separate from the
 * already-existing per-IP limit on the call-placing route itself
 * (/api/telephony/outbound) — this one guards against the table filling up
 * with spam submissions that never even reach the call step.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rateLimit = await checkRateLimit(`ratelimit:demo-request:${ip}`, SUBMIT_LIMIT, SUBMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    const retryAfterSec = Math.ceil((rateLimit.retryAfterMs ?? 0) / 1000);
    return NextResponse.json(
      { error: `Too many requests. Try again in ${retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const hospitalName = String(body.hospitalName ?? "").trim();
  const contactName = String(body.contactName ?? "").trim();
  const workEmail = String(body.workEmail ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const consent = body.consent === true;

  if (!hospitalName) return NextResponse.json({ error: "Hospital/clinic name is required." }, { status: 400 });
  if (!contactName) return NextResponse.json({ error: "Your name is required." }, { status: 400 });
  if (!EMAIL_RE.test(workEmail)) return NextResponse.json({ error: "A valid work email is required." }, { status: 400 });
  if (!PHONE_RE.test(phone)) return NextResponse.json({ error: "A valid phone number is required." }, { status: 400 });
  if (!consent) return NextResponse.json({ error: "Consent to receive the demo call is required." }, { status: 400 });

  const request = await createDemoRequest(supabase, {
    hospitalName,
    institutionType: typeof body.institutionType === "string" ? body.institutionType.trim() || null : null,
    department: typeof body.department === "string" ? body.department.trim() || null : null,
    contactName,
    workEmail,
    phone,
    preferredLanguage: typeof body.preferredLanguage === "string" ? body.preferredLanguage.trim() || null : null,
    workflow: typeof body.workflow === "string" ? body.workflow.trim() || null : null,
    description: typeof body.description === "string" ? body.description.trim() || null : null,
    consent,
  });
  if (!request) return NextResponse.json({ error: "Failed to submit demo request" }, { status: 500 });
  return NextResponse.json({ request }, { status: 201 });
}
