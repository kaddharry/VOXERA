import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../../lib/db/server";
import { getTenantIdForUser } from "../../../../../../lib/db/agents";
import { getProviderForTenant } from "../../../../../../lib/db/providers";
import { listDistinctPatientIdsForProvider } from "../../../../../../lib/db/appointments";
import { listPatientsByIds } from "../../../../../../lib/db/patients";

export const dynamic = "force-dynamic";

/** GET /api/admin/providers/[id]/patients?status=upcoming|all
 * Backs the staff-directory slide-over (app/admin/staff/page.tsx). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getTenantIdForUser(supabase, user.id);
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });

  const provider = await getProviderForTenant(supabase, id, tenantId);
  if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });

  const status = request.nextUrl.searchParams.get("status");
  const patientIds = await listDistinctPatientIdsForProvider(supabase, id, user.id, { upcomingOnly: status !== "all" });
  const patients = await listPatientsByIds(supabase, patientIds, user.id);
  return NextResponse.json({ patients });
}
