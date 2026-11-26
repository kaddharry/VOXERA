import { NextRequest, NextResponse } from "next/server";
import { requireDoctorScope } from "../../../../../lib/auth/doctor-scope";
import { getPatientDetailForDoctor } from "../../../../../lib/db/doctor";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const detail = await getPatientDetailForDoctor(guard.access.db, guard.scope, id);
  // A patient who isn't theirs looks exactly like one that doesn't exist.
  if (!detail) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  return NextResponse.json(detail);
}
