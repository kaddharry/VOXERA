import { NextResponse } from "next/server";
import { requireDoctorScope } from "../../../../lib/auth/doctor-scope";
import { listMyPatients } from "../../../../lib/db/doctor";
import { listAlerts } from "../../../../lib/db/alerts";
import { isTestSession } from "../../../../lib/agent/alert-priority";

export const dynamic = "force-dynamic";

/** Open alerts for this doctor's patients only. */
export async function GET() {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { access, scope } = guard;
  const patients = await listMyPatients(access.db, scope);
  const names = new Map(patients.map((p) => [p.id, p.name]));
  const alerts = (await listAlerts(access.db, scope.clientId, "open"))
    .filter((a) => a.patientId && names.has(a.patientId) && !isTestSession(a.sessionId))
    .map((a) => ({ ...a, patientName: names.get(a.patientId!) }));
  return NextResponse.json({ alerts });
}
