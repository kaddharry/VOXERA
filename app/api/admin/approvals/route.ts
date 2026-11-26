import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "../../../../lib/auth/access";
import { listInstructionRequests } from "../../../../lib/db/instruction-requests";

export const dynamic = "force-dynamic";

/** GET /api/admin/approvals?status=pending|approved|rejected|withdrawn|all — doctor→agent instruction requests. */
export async function GET(request: NextRequest) {
  const guard = await requireAccess("approvals.review");
  if (!guard.ok) return guard.response;
  const status = request.nextUrl.searchParams.get("status") ?? "pending";
  const allowed = ["pending", "approved", "rejected", "withdrawn", "all"];
  const requests = await listInstructionRequests(guard.access.db, guard.access.clientId, { status: (allowed.includes(status) ? status : "pending") as never });
  return NextResponse.json({ requests });
}
