import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../../lib/db/server";
import { getPatient } from "../../../../../../lib/db/patients";
import { createFollowUpTask, listFollowUpTasksForPatient } from "../../../../../../lib/db/follow-up-tasks";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tasks = await listFollowUpTasksForPatient(supabase, id, user.id);
  return NextResponse.json({ tasks });
}

/**
 * POST /api/admin/patients/[id]/follow-ups — schedules one follow-up call.
 * First-release scope (spec §19 Batch 4 / §25): a single scheduled call
 * with a retry policy, not a reusable multi-step programme (day 1/3/7).
 *
 * `maxAttempts` includes the initial attempt — this is an explicit product
 * decision this codebase had to make without a product-owner answer (spec
 * §24 Q4 flags the ambiguity); the UI must say so.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body?.scheduledAt || typeof body.scheduledAt !== "number") {
    return NextResponse.json({ error: "scheduledAt (unix ms) is required." }, { status: 400 });
  }
  if (body.scheduledAt < Date.now() - 60_000) {
    return NextResponse.json({ error: "scheduledAt must be in the future." }, { status: 400 });
  }

  const maxAttempts = Number(body.maxAttempts ?? 3);
  const retryDelayMinutes = Number(body.retryDelayMinutes ?? 30);
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    return NextResponse.json({ error: "maxAttempts must be between 1 and 10." }, { status: 400 });
  }
  if (!Number.isFinite(retryDelayMinutes) || retryDelayMinutes < 1 || retryDelayMinutes > 1440) {
    return NextResponse.json({ error: "retryDelayMinutes must be between 1 and 1440." }, { status: 400 });
  }

  const task = await createFollowUpTask(supabase, user.id, {
    patientId: id,
    agentId: body.agentId ?? patient.assignedAgentId ?? null,
    scheduledAt: body.scheduledAt,
    timezone: typeof body.timezone === "string" ? body.timezone : "UTC",
    windowStartMinute: typeof body.windowStartMinute === "number" ? body.windowStartMinute : null,
    windowEndMinute: typeof body.windowEndMinute === "number" ? body.windowEndMinute : null,
    maxAttempts,
    retryDelayMinutes,
    finalAction: ["needs_review", "completed", "cancelled"].includes(body.finalAction) ? body.finalAction : "needs_review",
  });
  if (!task) return NextResponse.json({ error: "Failed to schedule follow-up" }, { status: 500 });
  return NextResponse.json({ task }, { status: 201 });
}
