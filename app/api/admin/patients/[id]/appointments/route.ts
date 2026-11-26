import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "../../../../../../lib/auth/access";
import { listAppointmentsForPatient } from "../../../../../../lib/db/appointments";

export const dynamic = "force-dynamic";

/** A single patient's appointment history — surfaces as a new tab on the
 * existing patient detail page (app/admin/patients/[id]/page.tsx). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireAccess("appointments.read");
  if (!guard.ok) return guard.response;
  const supabase = guard.access.db;
  const user = { id: guard.access.clientId };

  const appointments = await listAppointmentsForPatient(supabase, id, user.id);
  return NextResponse.json({ appointments });
}
