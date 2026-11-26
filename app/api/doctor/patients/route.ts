import { NextResponse } from "next/server";
import { requireDoctorScope } from "../../../../lib/auth/doctor-scope";
import { listMyPatients } from "../../../../lib/db/doctor";
import { computeAdherence, listAdherence, listMedications } from "../../../../lib/db/medications";

export const dynamic = "force-dynamic";

/** GET /api/doctor/patients — only this doctor's patients, each with a one-line adherence status. */
export async function GET() {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { access, scope } = guard;
  const patients = await listMyPatients(access.db, scope);
  const enriched = await Promise.all(
    patients.map(async (p) => {
      const [meds, logs] = await Promise.all([
        listMedications(access.db, scope.clientId, p.id, { activeOnly: true }),
        listAdherence(access.db, scope.clientId, p.id),
      ]);
      const a = computeAdherence(meds, logs);
      return { ...p, medicationCount: meds.length, adherencePct: a.overallPct, adherenceAtRisk: a.atRisk };
    }),
  );
  return NextResponse.json({ patients: enriched });
}
