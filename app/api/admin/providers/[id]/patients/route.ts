import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "../../../../../../lib/auth/access";
import { getProviderForTenant } from "../../../../../../lib/db/providers";
import { listDistinctPatientIdsForProvider } from "../../../../../../lib/db/appointments";
import { listPatientsByIds } from "../../../../../../lib/db/patients";

export const dynamic = "force-dynamic";

/** GET /api/admin/providers/[id]/patients?status=upcoming|all
 * Backs the staff-directory slide-over (app/admin/staff/page.tsx). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireAccess("staff.read");
  if (!guard.ok) return guard.response;
  const supabase = guard.access.db;
  const user = { id: guard.access.clientId };
  const tenantId = guard.access.tenantId;

  const provider = await getProviderForTenant(supabase, id, tenantId);
  if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });

  const status = request.nextUrl.searchParams.get("status");
  const patientIds = await listDistinctPatientIdsForProvider(supabase, id, user.id, { upcomingOnly: status !== "all" });
  const patients = await listPatientsByIds(supabase, patientIds, user.id);
  return NextResponse.json({ patients });
}
