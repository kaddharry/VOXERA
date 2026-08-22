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

    const { data: calls, error } = await supabase
      .from("call_logs")
      .select("*")
      .eq("clientId", user.id)
      .neq("status", "active")
      .not("sessionId", "is", null)
      .order("startedAt", { ascending: false })
      .limit(20);

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
