import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDoctorScope } from "../../../../../../lib/auth/doctor-scope";
import { isMyPatient } from "../../../../../../lib/db/doctor";
import { addMedication, getMedication, setMedicationStatus } from "../../../../../../lib/db/medications";
import { invalidateCarePlanContext } from "../../../../../../lib/db/agent-cache";
import { recordAdherenceAndCheck } from "../../../../../../lib/agent/adherence";

export const dynamic = "force-dynamic";

const AddSchema = z.object({
  name: z.string().trim().min(2).max(120),
  dosage: z.string().trim().max(60).nullable().optional(),
  frequency: z.string().trim().max(120).optional(),
  timesPerDay: z.number().int().min(1).max(6).optional(),
  instructions: z.string().trim().max(300).nullable().optional(),
});

const PatchSchema = z.union([
  z.object({ medicationId: z.string().min(1), status: z.enum(["active", "stopped", "completed"]) }),
  z.object({ medicationId: z.string().min(1), adherence: z.enum(["taken", "partial", "missed"]), note: z.string().max(300).optional() }),
]);

/** POST — prescribe a medicine to one of this doctor's patients (the agent starts asking about it on the next call). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const { access, scope } = guard;
  if (!(await isMyPatient(access.db, scope, id))) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

  const parsed = AddSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the medicine name (and optionally dose and frequency).", issues: parsed.error.issues }, { status: 400 });
  const medication = await addMedication(access.db, scope.clientId, id, scope.providerId, parsed.data);
  if (!medication) return NextResponse.json({ error: "Could not save the medicine" }, { status: 500 });
  invalidateCarePlanContext(scope.clientId, id);
  return NextResponse.json({ medication }, { status: 201 });
}

/** PATCH — stop/complete a medicine, or log adherence the doctor learned in clinic. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const { access, scope } = guard;
  if (!(await isMyPatient(access.db, scope, id))) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const med = await getMedication(access.db, scope.clientId, parsed.data.medicationId);
  if (!med || med.patientId !== id) return NextResponse.json({ error: "Medicine not found" }, { status: 404 });

  if ("status" in parsed.data) {
    const updated = await setMedicationStatus(access.db, scope.clientId, med.id, parsed.data.status);
    invalidateCarePlanContext(scope.clientId, id);
    return NextResponse.json({ medication: updated });
  }
  const saved = await recordAdherenceAndCheck(access.db, {
    clientId: scope.clientId,
    patientId: id,
    medicationId: med.id,
    status: parsed.data.adherence,
    note: parsed.data.note,
    source: "doctor",
  });
  invalidateCarePlanContext(scope.clientId, id);
  return NextResponse.json({ adherence: saved?.record ?? null });
}
