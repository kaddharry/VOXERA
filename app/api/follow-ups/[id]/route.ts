import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "../../../../lib/auth/access";
import { setFollowUpTaskStatus } from "../../../../lib/db/follow-up-tasks";

export const dynamic = "force-dynamic";

/** PATCH /api/follow-ups/[id] — { action: "pause" | "resume" | "cancel", resumeAt? }.
 * A task currently "dispatching"/"calling" can't be touched here — those
 * are owned by lib/scheduler/dispatcher.ts mid-flight. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAccess("patients.write");
  if (!guard.ok) return guard.response;
  const supabase = guard.access.db;
  const user = { id: guard.access.clientId };

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !["pause", "resume", "cancel"].includes(body.action)) {
    return NextResponse.json({ error: "action must be one of pause, resume, cancel." }, { status: 400 });
  }

  const task = await setFollowUpTaskStatus(supabase, id, user.id, body.action, body.resumeAt);
  if (!task) {
    return NextResponse.json(
      { error: "Task not found, not yours, or not in a state that can be changed right now." },
      { status: 404 },
    );
  }
  return NextResponse.json({ task });
}
