import { NextRequest, NextResponse } from "next/server";
import { requireDoctorScope } from "../../../../../lib/auth/doctor-scope";
import { InstructionError, withdrawInstructionRequest } from "../../../../../lib/db/instruction-requests";
import { invalidateCarePlanContext } from "../../../../../lib/db/agent-cache";

export const dynamic = "force-dynamic";

/** DELETE — take back a pending request, or switch off one that was approved. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    const request = await withdrawInstructionRequest(guard.access.db, { clientId: guard.scope.clientId, requestId: id, providerId: guard.scope.providerId });
    invalidateCarePlanContext(guard.scope.clientId);
    return NextResponse.json({ request });
  } catch (err) {
    if (err instanceof InstructionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
