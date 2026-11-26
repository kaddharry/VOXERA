import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "../../../../../../lib/auth/access";
import { getPatient } from "../../../../../../lib/db/patients";
import { enrollPatientInProgramme } from "../../../../../../lib/db/follow-up-programmes";
import { isValidTimeZone } from "../../../../../../lib/scheduler/validation";

export const dynamic = "force-dynamic";

/** POST /api/admin/patients/[id]/enroll — { programmeId, startAt, timezone }.
 * Creates one follow_up_tasks row per programme step (see
 * lib/db/follow-up-programmes.ts's enrollPatientInProgramme doc comment). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAccess("patients.write");
  if (!guard.ok) return guard.response;
  const supabase = guard.access.db;
  const user = { id: guard.access.clientId };

  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (patient.doNotContact) return NextResponse.json({ error: "This patient is marked Do Not Contact." }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body?.programmeId || typeof body.programmeId !== "string") {
    return NextResponse.json({ error: "programmeId is required." }, { status: 400 });
  }
  if (!body?.startAt || typeof body.startAt !== "number") {
    return NextResponse.json({ error: "startAt (unix ms) is required." }, { status: 400 });
  }

  // Same failure mode as /schedule-range: if neither the programme nor the
  // patient has an agent, every step the dispatcher ever tries just bails
  // out with a silent "No agent assigned" alert instead of calling — catch
  // it at enrollment time instead.
  const timezone = body.timezone ?? "UTC";
  if (!isValidTimeZone(timezone)) {
    return NextResponse.json({ error: `Unknown timezone "${timezone}".` }, { status: 400 });
  }

  const { data: programmeRow } = await supabase
    .from("follow_up_programmes")
    .select('"agentId"')
    .eq("id", body.programmeId)
    .eq("clientId", user.id)
    .maybeSingle();
  const resolvedAgentId = (typeof body.agentId === "string" && body.agentId) || programmeRow?.agentId || patient.assignedAgentId || null;
  if (!resolvedAgentId) {
    return NextResponse.json({ error: "No agent assigned — this patient and programme both have none. Pick one before enrolling." }, { status: 400 });
  }

  const tasks = await enrollPatientInProgramme(supabase, user.id, {
    programmeId: body.programmeId,
    patientId: id,
    startAt: body.startAt,
    timezone,
    patientAssignedAgentId: resolvedAgentId,
  });
  if (tasks.length === 0) {
    return NextResponse.json({ error: "Programme not found, or has no steps." }, { status: 400 });
  }
  return NextResponse.json({ tasks }, { status: 201 });
}
