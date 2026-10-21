import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/session/recent
 *
 * Recently-ENDED call sessions for this tenant — the "evaluate a past call"
 * half of the Live Dashboard (the active half is /api/session/active).
 * Scoped to the authenticated user's clientId, same as the active endpoint.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // No `.not("sessionId", "is", null)` filter here on purpose: a call that
    // never reached the Twilio Media Stream (voicemail, hung up before the
    // AI pipeline connected, `placeOutboundCall` row never backfilled by
    // TelephonyStreamHandler's "start" handler — see lib/telephony/
    // outbound.ts and stream-handler.ts) still has a real status/duration/
    // summary worth showing on the Calls & Insights page, it just can't
    // deep-link into a transcript/emotion timeline. Excluding it here used
    // to make those patients silently vanish from the list entirely — the
    // row still exists (and shows up fine on the patient's own profile,
    // which never applied this filter), it just never appeared grouped by
    // patient. The UI already disables the "open session" action when
    // sessionId is null (app/admin/sessions/page.tsx), so there's nothing
    // left here that depends on every row having one.
    //
    // Limit raised from 20 to 200 for the same underlying reason: this was
    // a single top-N across the WHOLE tenant, not per patient — a run of
    // browser Test Agent calls (see app/admin/try-call) more recent than a
    // patient's real calls could fill the entire window and crowd out every
    // other patient's history, not just trim old data as intended.
    const { data: calls, error } = await supabase
      .from("call_logs")
      .select("*")
      .eq("clientId", user.id)
      .neq("status", "active")
      .order("startedAt", { ascending: false })
      .limit(200);

    if (error) {
      console.error("[Recent Sessions API] Error fetching call_logs:", error);
      return NextResponse.json({ calls: [] });
    }

    return NextResponse.json({ calls: calls || [] });
  } catch (err) {
    console.error("[Recent Sessions API] Exception:", err);
    return NextResponse.json({ calls: [] });
  }
}
