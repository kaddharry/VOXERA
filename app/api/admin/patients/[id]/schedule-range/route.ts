import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../../lib/db/server";
import { getPatient } from "../../../../../../lib/db/patients";
import { createFollowUpRange } from "../../../../../../lib/db/follow-up-tasks";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/patients/[id]/schedule-range — "call this patient every
 * day from date A to date B around a given time, retry if no answer, stop
 * for the day once they pick up and talk." Each day becomes its own
 * follow_up_tasks row (see lib/db/follow-up-tasks.ts::createFollowUpRange)
 * sharing one rangeGroupId, so same-day retry exhaustion never touches
 * other days and a connected+resolved call only ever cancels *that* day's
 * remaining attempts.
 *
 * Body: { dailyAttemptTimes: number[] } — unix-ms instants, one per day,
 * computed client-side from the picked date range + time-of-day so the
 * browser's own timezone resolution is authoritative (same approach the
 * existing single-call datetime-local flow already uses).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (patient.doNotContact) return NextResponse.json({ error: "This patient is marked Do Not Contact." }, { status: 400 });

  const body = await request.json().catch(() => null);
  const dailyAttemptTimes = Array.isArray(body?.dailyAttemptTimes) ? body.dailyAttemptTimes : null;
  if (!dailyAttemptTimes || dailyAttemptTimes.length === 0) {
    return NextResponse.json({ error: "dailyAttemptTimes (non-empty array of unix-ms) is required." }, { status: 400 });
  }
  if (dailyAttemptTimes.length > 60) {
    return NextResponse.json({ error: "Date range is too long (max 60 days)." }, { status: 400 });
  }
  if (!dailyAttemptTimes.every((t: unknown) => typeof t === "number" && Number.isFinite(t))) {
    return NextResponse.json({ error: "dailyAttemptTimes must all be unix-ms numbers." }, { status: 400 });
  }
  const earliestAllowed = Date.now() - 60_000;
  if (dailyAttemptTimes.some((t: number) => t < earliestAllowed)) {
    return NextResponse.json({ error: "Every date in the range must be today or later." }, { status: 400 });
  }

  const maxAttemptsPerDay = Number(body.maxAttemptsPerDay ?? 3);
  const retryDelayMinutes = Number(body.retryDelayMinutes ?? 30);
  if (!Number.isFinite(maxAttemptsPerDay) || maxAttemptsPerDay < 1 || maxAttemptsPerDay > 10) {
    return NextResponse.json({ error: "maxAttemptsPerDay must be between 1 and 10." }, { status: 400 });
  }
  if (!Number.isFinite(retryDelayMinutes) || retryDelayMinutes < 1 || retryDelayMinutes > 1440) {
    return NextResponse.json({ error: "retryDelayMinutes must be between 1 and 1440." }, { status: 400 });
  }

  // Without this, scheduling "succeeded" but the dispatcher immediately
  // bailed on the very first attempt (lib/scheduler/dispatcher.ts's
  // `if (!agentId) { markNeedsReview(...) }`) and silently created a
  // needs_review alert instead of ever placing a call — from the hospital's
  // side that looked exactly like "it just never called," with the only
  // clue buried in Alerts. Reject at schedule time instead, where there's
  // actually a form on screen to fix it.
  const agentId = body.agentId ?? patient.assignedAgentId ?? null;
  if (!agentId) {
    return NextResponse.json({ error: "This patient has no assigned agent — pick one before scheduling." }, { status: 400 });
  }

  const tasks = await createFollowUpRange(supabase, user.id, {
    patientId: id,
    agentId,
    dailyAttemptTimes,
    timezone: typeof body.timezone === "string" ? body.timezone : "UTC",
    windowStartMinute: typeof body.windowStartMinute === "number" ? body.windowStartMinute : null,
    windowEndMinute: typeof body.windowEndMinute === "number" ? body.windowEndMinute : null,
    maxAttemptsPerDay,
    retryDelayMinutes,
  });
  if (tasks.length === 0) return NextResponse.json({ error: "Failed to schedule the range." }, { status: 500 });
  return NextResponse.json({ tasks }, { status: 201 });
}
