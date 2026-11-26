import { NextResponse } from "next/server";
import { requireAccess } from "../../../../lib/auth/access";

export const dynamic = "force-dynamic";

const STALE_FLOOR_MS = 15 * 60 * 1000;

/**
 * GET /api/session/active
 *
 * Fetches this tenant's genuinely in-progress call sessions for real-time
 * admin monitoring. Scoped to the authenticated user's clientId (RLS also
 * enforces this, but the filter is kept explicit).
 */
export async function GET() {
  try {
    const guard = await requireAccess("calls.read");
    if (!guard.ok) return guard.response;
    const supabase = guard.access.db;
    const user = { id: guard.access.clientId };

    const { data: calls, error } = await supabase
      .from("call_logs")
      .select("*")
      .eq("clientId", user.id)
      .eq("status", "active")
      .gte("startedAt", Date.now() - STALE_FLOOR_MS)
      .order("startedAt", { ascending: false })
      .limit(10);

    if (error) {
      console.error("[Active Sessions API] Error fetching call_logs:", error);
      return NextResponse.json({ calls: [] });
    }

    return NextResponse.json({ calls: calls || [] });
  } catch (err) {
    console.error("[Active Sessions API] Exception:", err);
    return NextResponse.json({ calls: [] });
  }
}
