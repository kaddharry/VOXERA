import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../../lib/db/server";
import { getPatient } from "../../../../../../lib/db/patients";
import { placeOutboundCall, isLocalBaseUrl, resolveBaseUrl } from "../../../../../../lib/telephony/outbound";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/patients/[id]/call — body: { agentId }. The agent is
 * chosen at call time (the Patients page prompts for it via a picker right
 * before dialing), not necessarily the patient's stored assignedAgentId —
 * that field is only a convenience default for the picker's initial
 * selection, never silently substituted here if the caller sends a
 * different one.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const agentId = body.agentId ? String(body.agentId) : undefined;
  if (!agentId) return NextResponse.json({ error: "Select an agent to place this call." }, { status: 400 });

  const baseUrl = resolveBaseUrl(request);
  if (isLocalBaseUrl(baseUrl)) {
    return NextResponse.json(
      {
        error:
          "Outbound calls need a public URL Twilio can reach. Start ngrok (`ngrok http 3000`) and set NEXT_PUBLIC_BASE_URL to the ngrok URL in .env.local, then restart the dev server.",
      },
      { status: 400 }
    );
  }

  try {
    const { callSid, status } = await placeOutboundCall({
      to: patient.phone,
      clientId: user.id,
      agentId,
      patientId: patient.id,
      baseUrl,
    });
    return NextResponse.json({ success: true, callSid, status });
  } catch (err: any) {
    console.error("[Patients] Failed to trigger call:", err);
    return NextResponse.json({ error: err.message || "Failed to trigger outbound call" }, { status: 500 });
  }
}
