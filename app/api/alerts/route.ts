import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "../../../lib/auth/access";
import { listAlerts } from "../../../lib/db/alerts";
import { listPatients } from "../../../lib/db/patients";
import { isTestSession } from "../../../lib/agent/alert-priority";

export const dynamic = "force-dynamic";

/** GET /api/alerts?status=open|resolved|all (default open)&patientId=... —
 * the Needs Attention queue (spec §8.1.D / §16.10), optionally scoped to
 * one patient for their profile's Insights & Alerts view.
 *
 * Enriches each alert with patientName (so the Alerts page doesn't need a
 * second round trip per row) and pickedUp (whether the patient actually
 * answered and talked, vs. the call never connecting). An alert counts as
 * "picked up" if either: its linked call_logs row has status "completed",
 * or it carries a sessionId at all — a session only ever gets created once
 * a call connects and a conversation starts, so sessionId alone is proof
 * of pickup even when callId is missing. That matters because live-call
 * escalation alerts (lib/db/alerts.ts::raiseCallAlert) are written
 * with a sessionId but no callId — they can only fire mid-conversation, so
 * relying on callId alone silently sorted every escalation into "patient
 * didn't pick up," which is backwards (that's literally the case where the
 * patient *did* pick up and something still went wrong). */
export async function GET(request: NextRequest) {
  const guard = await requireAccess("alerts.read");
  if (!guard.ok) return guard.response;
  const supabase = guard.access.db;
  const user = { id: guard.access.clientId };

  const status = request.nextUrl.searchParams.get("status");
  const patientId = request.nextUrl.searchParams.get("patientId") ?? undefined;
  const alerts = await listAlerts(
    supabase,
    user.id,
    status === "resolved" || status === "all" ? status : "open",
    patientId,
  );

  const [patients, callStatuses] = await Promise.all([
    listPatients(supabase, user.id),
    (async () => {
      const callIds = [...new Set(alerts.map((a) => a.callId).filter((id): id is string => !!id))];
      if (callIds.length === 0) return new Map<string, string>();
      const { data } = await supabase.from("call_logs").select("id, status").in("id", callIds);
      return new Map((data ?? []).map((c) => [c.id as string, c.status as string]));
    })(),
  ]);
  const patientNameById = new Map(patients.map((p) => [p.id, p.name]));

  const enriched = alerts.map((a) => ({
    ...a,
    patientName: a.patientId ? patientNameById.get(a.patientId) ?? "Unknown patient" : "Unknown patient",
    pickedUp: !!a.sessionId || (!!a.callId && callStatuses.get(a.callId) === "completed"),
    // From the browser test drawer / Test Agent page, not a real patient call — shown on its own tab.
    isTest: isTestSession(a.sessionId),
  }));

  return NextResponse.json({ alerts: enriched });
}
