import { getSessionLog } from "@/lib/logging/session-logger";
import { createClient } from "@/lib/db/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/session/[sessionId]
 *
 * Raw event-log dump used by the authenticated Sessions admin page. Scoped
 * to the caller's own call_logs row, matching the ownership check already
 * used by the sibling /replay route — this endpoint previously had no auth
 * or ownership check at all.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  if (!sessionId || sessionId.trim().length === 0) {
    return Response.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Full row (not just an ownership-check id) — the Sessions admin page
  // uses this to show which patient the call belongs to and surface the
  // post-call clinical summary (lib/agent/call-summary.ts) alongside the
  // raw event log, instead of an opaque session id with no context.
  const { data: call } = await supabase
    .from("call_logs")
    .select('id, "sessionId", "patientId", "callerNumber", status, "startedAt", "endedAt", "durationMs", summary')
    .eq("sessionId", sessionId)
    .eq("clientId", user.id)
    .maybeSingle();

  if (!call) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const events = await getSessionLog(sessionId);
  return Response.json({ sessionId, eventCount: events.length, events, call });
}
