import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDoctorScope } from "../../../../lib/auth/doctor-scope";
import { getMyPatient } from "../../../../lib/db/doctor";
import { createInstructionRequest, InstructionError, listInstructionRequests } from "../../../../lib/db/instruction-requests";
import { sanitizeInstruction } from "../../../../lib/agent/doctor-assistant";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const requests = await listInstructionRequests(guard.access.db, guard.scope.clientId, { providerId: guard.scope.providerId, status: "all" });
  return NextResponse.json({ requests });
}

const Schema = z.object({
  title: z.string().trim().min(3).max(120),
  doctorMessage: z.string().trim().min(3).max(2000),
  proposedInstruction: z.string().trim().min(1).max(2000),
  patientId: z.string().nullable().optional(),
  transcript: z.array(z.object({ role: z.string(), content: z.string().max(2000) })).max(20).optional(),
});

/** POST — submit the assistant's proposal for admin approval. It does nothing to live calls until approved. */
export async function POST(request: NextRequest) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { access, scope } = guard;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });

  // Re-checked here, not trusted from the browser: whatever the doctor edited must still be a safe instruction.
  const clean = sanitizeInstruction(parsed.data.proposedInstruction);
  if (!clean.ok) return NextResponse.json({ error: clean.reason }, { status: 400 });

  if (parsed.data.patientId && !(await getMyPatient(access.db, scope, parsed.data.patientId))) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }
  try {
    const created = await createInstructionRequest(access.db, {
      clientId: scope.clientId,
      tenantId: scope.tenantId,
      providerId: scope.providerId,
      userId: access.userId,
      patientId: parsed.data.patientId ?? null,
      title: parsed.data.title,
      doctorMessage: parsed.data.doctorMessage,
      proposedInstruction: clean.text,
      transcript: parsed.data.transcript,
    });
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (err) {
    if (err instanceof InstructionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Failed to submit" }, { status: 500 });
  }
}
