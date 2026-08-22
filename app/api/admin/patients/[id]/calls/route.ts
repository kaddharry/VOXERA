import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../../lib/db/server";
import { getPatient } from "../../../../../../lib/db/patients";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/patients/[id]/calls
 *
 * Post-call analysis history for one patient — every real call placed to
 * them, each carrying the LLM-generated summary (sentiment trajectory,
 * flagged concerns, recommended action) that lib/agent/call-summary.ts
 * already produces and app/api/telephony/status/route.ts already writes to
 * call_logs.summary once the call ends. This is the missing "shown"
 * half — the generation/storage already existed, nothing in the UI
 * surfaced it until now.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

  const { data: calls, error } = await supabase
    .from("call_logs")
    .select('id, "sessionId", status, "startedAt", "endedAt", "durationMs", summary')
    .eq("patientId", id)
    .eq("clientId", user.id)
    .order("startedAt", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[Patient Calls API] Error fetching call_logs:", error);
    return NextResponse.json({ calls: [] });
  }

  return NextResponse.json({ calls: calls ?? [] });
}
