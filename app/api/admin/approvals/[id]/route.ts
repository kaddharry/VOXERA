import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccess } from "../../../../../lib/auth/access";
import { InstructionError, reviewInstructionRequest } from "../../../../../lib/db/instruction-requests";
import { invalidateCarePlanContext } from "../../../../../lib/db/agent-cache";

export const dynamic = "force-dynamic";

const Schema = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(500).optional() });

/** PATCH — approve (the instruction goes live on the next call) or reject (with a reason the doctor sees). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAccess("approvals.review");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  try {
    const updated = await reviewInstructionRequest(guard.access.db, {
      clientId: guard.access.clientId,
      requestId: id,
      reviewerUserId: guard.access.userId,
      decision: parsed.data.decision,
      note: parsed.data.note,
    });
    invalidateCarePlanContext(guard.access.clientId);
    return NextResponse.json({ request: updated });
  } catch (err) {
    if (err instanceof InstructionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
