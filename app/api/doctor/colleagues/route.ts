import { NextResponse } from "next/server";
import { requireDoctorScope } from "../../../../lib/auth/doctor-scope";
import { listProvidersForTenant } from "../../../../lib/db/providers";

export const dynamic = "force-dynamic";

/** Other active doctors in the hospital — the "refer to" picker. Names and specialties only. */
export async function GET() {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const all = await listProvidersForTenant(guard.access.db, guard.scope.tenantId, { status: "active" });
  return NextResponse.json({
    colleagues: all.filter((p) => p.id !== guard.scope.providerId).map((p) => ({ id: p.id, name: p.name, specialty: p.specialty, color: p.color })),
  });
}
