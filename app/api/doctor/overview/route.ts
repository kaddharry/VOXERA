import { NextResponse } from "next/server";
import { requireDoctorScope } from "../../../../lib/auth/doctor-scope";
import { getDoctorOverview } from "../../../../lib/db/doctor";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  return NextResponse.json(await getDoctorOverview(guard.access.db, guard.scope));
}
