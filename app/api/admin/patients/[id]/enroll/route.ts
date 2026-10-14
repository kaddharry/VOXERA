import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../../lib/db/server";
import { getPatient } from "../../../../../../lib/db/patients";
import { enrollPatientInProgramme } from "../../../../../../lib/db/follow-up-programmes";

export const dynamic = "force-dynamic";

/** POST /api/admin/patients/[id]/enroll — { programmeId, startAt, timezone }.
 * Creates one follow_up_tasks row per programme step (see
 * lib/db/follow-up-programmes.ts's enrollPatientInProgramme doc comment). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
    timezone: typeof body.timezone === "string" ? body.timezone : "UTC",
    patientAssignedAgentId: resolvedAgentId,
  });
  if (tasks.length === 0) {
    return NextResponse.json({ error: "Programme not found, or has no steps." }, { status: 400 });
  }
  return NextResponse.json({ tasks }, { status: 201 });
}
