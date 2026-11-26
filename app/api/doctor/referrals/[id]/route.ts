import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDoctorScope } from "../../../../../lib/auth/doctor-scope";
import { ReferralError, respondToReferral } from "../../../../../lib/db/referrals";

export const dynamic = "force-dynamic";

const Schema = z.object({
  action: z.enum(["accept", "decline", "complete", "cancel"]),
  note: z.string().trim().max(500).optional(),
  appointmentId: z.string().uuid().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  try {
    const referral = await respondToReferral(guard.access.db, {
      clientId: guard.scope.clientId,
      referralId: id,
      actingProviderId: guard.scope.providerId,
      action: parsed.data.action,
      note: parsed.data.note,
      appointmentId: parsed.data.appointmentId,
    });
    return NextResponse.json({ referral });
  } catch (err) {
    if (err instanceof ReferralError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
