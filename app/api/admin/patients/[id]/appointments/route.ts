import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../../lib/db/server";
import { listAppointmentsForPatient } from "../../../../../../lib/db/appointments";

export const dynamic = "force-dynamic";

/** A single patient's appointment history — surfaces as a new tab on the
 * existing patient detail page (app/admin/patients/[id]/page.tsx). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appointments = await listAppointmentsForPatient(supabase, id, user.id);
  return NextResponse.json({ appointments });
}
