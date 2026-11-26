import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDoctorScope } from "../../../../lib/auth/doctor-scope";
import { getMyPatient } from "../../../../lib/db/doctor";
import { runDoctorAssistant } from "../../../../lib/agent/doctor-assistant";
import { checkRateLimit } from "../../../../lib/telephony/rate-limit";

export const dynamic = "force-dynamic";

const Schema = z.object({
  messages: z.array(z.object({ role: z.enum(["doctor", "assistant"]), content: z.string().max(2000) })).min(1).max(20),
  patientId: z.string().nullable().optional(),
});

/** POST /api/doctor/assistant — chat that turns a doctor's wish into a proposed agent instruction (not yet applied). */
export async function POST(request: NextRequest) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { access, scope } = guard;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.messages[parsed.data.messages.length - 1].role !== "doctor") {
    return NextResponse.json({ error: "Send your message to the assistant." }, { status: 400 });
  }

  let patientName: string | null = null;
  if (parsed.data.patientId) {
    const patient = await getMyPatient(access.db, scope, parsed.data.patientId);
    if (!patient) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    patientName = patient.name;
  }

  const limited = await checkRateLimit(`doctor-assistant:${access.userId}`, 30, 60_000);
  if (!limited.allowed) return NextResponse.json({ error: "Slow down a little — try again in a minute." }, { status: 429 });

  const result = await runDoctorAssistant({ clientId: scope.clientId, messages: parsed.data.messages, patientName });
  return NextResponse.json(result);
}
