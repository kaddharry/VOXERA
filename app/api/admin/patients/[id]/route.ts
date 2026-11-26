import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "../../../../../lib/auth/access";
import { deletePatient, getPatient, updatePatient, RISK_LEVELS, type RiskLevel } from "../../../../../lib/db/patients";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAccess("patients.read");
  if (!guard.ok) return guard.response;
  const supabase = guard.access.db;
  const user = { id: guard.access.clientId };

  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ patient });
}

/** PATCH /api/admin/patients/[id] — { condition?: string|null, riskLevel?: RiskLevel }.
 * Used by the Patients table's quick-edit pencil and the detail page header
 * to update a patient's condition tag / risk tier. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAccess("patients.write");
  if (!guard.ok) return guard.response;
  const supabase = guard.access.db;
  const user = { id: guard.access.clientId };

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const fields: { condition?: string | null; riskLevel?: RiskLevel; primaryProviderId?: string | null } = {};

  if ("condition" in body) {
    if (body.condition !== null && typeof body.condition !== "string") {
      return NextResponse.json({ error: "condition must be a string or null." }, { status: 400 });
    }
    fields.condition = typeof body.condition === "string" ? body.condition.trim() || null : null;
  }
  if ("riskLevel" in body) {
    if (!(RISK_LEVELS as readonly string[]).includes(body.riskLevel)) {
      return NextResponse.json({ error: `riskLevel must be one of: ${RISK_LEVELS.join(", ")}` }, { status: 400 });
    }
    fields.riskLevel = body.riskLevel as RiskLevel;
  }
  if ("primaryProviderId" in body) {
    if (body.primaryProviderId !== null && typeof body.primaryProviderId !== "string") {
      return NextResponse.json({ error: "primaryProviderId must be a doctor id or null." }, { status: 400 });
    }
    if (body.primaryProviderId) {
      // Only a doctor of THIS hospital can own a patient's care.
      const { data: doctor } = await supabase.from("providers").select("id").eq("id", body.primaryProviderId).eq("tenant_id", guard.access.tenantId).maybeSingle();
      if (!doctor) return NextResponse.json({ error: "That doctor isn't part of this hospital." }, { status: 404 });
    }
    fields.primaryProviderId = body.primaryProviderId ?? null;
  }
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Nothing to update — pass condition, riskLevel and/or primaryProviderId." }, { status: 400 });
  }

  const patient = await updatePatient(supabase, id, user.id, fields);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ patient });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAccess("patients.write");
  if (!guard.ok) return guard.response;
  const supabase = guard.access.db;
  const user = { id: guard.access.clientId };

  const { id } = await params;
  const ok = await deletePatient(supabase, id, user.id);
  if (!ok) return NextResponse.json({ error: "Failed to delete patient" }, { status: 500 });
  return NextResponse.json({ success: true });
}
