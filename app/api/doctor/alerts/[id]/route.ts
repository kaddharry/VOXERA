import { NextRequest, NextResponse } from "next/server";
import { requireDoctorScope } from "../../../../../lib/auth/doctor-scope";
import { isMyPatient } from "../../../../../lib/db/doctor";
import { resolveAlert } from "../../../../../lib/db/alerts";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const { access, scope } = guard;
  const { data: alert } = await access.db.from("alerts").select('id, "patientId"').eq("id", id).eq("clientId", scope.clientId).maybeSingle();
  if (!alert?.patientId || !(await isMyPatient(access.db, scope, alert.patientId as string))) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const resolved = await resolveAlert(access.db, id, scope.clientId, typeof body.resolutionNotes === "string" ? body.resolutionNotes : undefined);
  if (!resolved) return NextResponse.json({ error: "Could not resolve the alert" }, { status: 500 });
  return NextResponse.json({ alert: resolved });
}
