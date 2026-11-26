import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDoctorScope } from "../../../../lib/auth/doctor-scope";
import { isMyPatient } from "../../../../lib/db/doctor";
import { createReferral, listReferrals, ReferralError, REFERRAL_URGENCIES } from "../../../../lib/db/referrals";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const dir = request.nextUrl.searchParams.get("direction");
  const referrals = await listReferrals(guard.access.db, guard.scope.clientId, {
    providerId: guard.scope.providerId,
    direction: dir === "incoming" || dir === "outgoing" ? dir : "all",
  });
  return NextResponse.json({ referrals, me: guard.scope.providerId });
}

const CreateSchema = z.object({
  patientId: z.string().min(1),
  toProviderId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1000),
  urgency: z.enum(REFERRAL_URGENCIES as unknown as [string, ...string[]]).default("routine"),
});

/** POST — refer one of MY patients to another doctor. */
export async function POST(request: NextRequest) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { access, scope } = guard;
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a doctor and give a short reason.", issues: parsed.error.issues }, { status: 400 });
  if (!(await isMyPatient(access.db, scope, parsed.data.patientId))) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  try {
    const referral = await createReferral(access.db, {
      clientId: scope.clientId,
      tenantId: scope.tenantId,
      patientId: parsed.data.patientId,
      fromProviderId: scope.providerId,
      toProviderId: parsed.data.toProviderId,
      reason: parsed.data.reason,
      urgency: parsed.data.urgency as "routine" | "soon" | "urgent",
      createdByUserId: access.userId,
    });
    return NextResponse.json({ referral }, { status: 201 });
  } catch (err) {
    if (err instanceof ReferralError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/doctor/referrals] POST failed:", err);
    return NextResponse.json({ error: "Failed to create the referral" }, { status: 500 });
  }
}
