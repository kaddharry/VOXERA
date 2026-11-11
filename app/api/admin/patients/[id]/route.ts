import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../lib/db/server";
import { deletePatient, getPatient, updatePatient, RISK_LEVELS, type RiskLevel } from "../../../../../lib/db/patients";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ patient });
}

/** PATCH /api/admin/patients/[id] — { condition?: string|null, riskLevel?: RiskLevel }.
 * Used by the Patients table's quick-edit pencil and the detail page header
 * to update a patient's condition tag / risk tier. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const fields: { condition?: string | null; riskLevel?: RiskLevel } = {};

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
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Nothing to update — pass condition and/or riskLevel." }, { status: 400 });
  }

  const patient = await updatePatient(supabase, id, user.id, fields);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ patient });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ok = await deletePatient(supabase, id, user.id);
  if (!ok) return NextResponse.json({ error: "Failed to delete patient" }, { status: 500 });
  return NextResponse.json({ success: true });
}
