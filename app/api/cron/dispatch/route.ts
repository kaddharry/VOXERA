import { NextRequest, NextResponse } from "next/server";
import { runScheduledDispatch } from "../../../../lib/scheduler/dispatcher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/dispatch — invoked by the Vercel Schedule configured in
 * vercel.json. Replaces custom-server.ts's startSchedulerPolling() for the
 * Vercel deployment, which never runs that file at all.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` on scheduled
 * invocations when CRON_SECRET is set on the project — verified here so an
 * arbitrary caller can't trigger follow-up call dispatch on demand. If
 * CRON_SECRET isn't configured, the check is skipped (local/manual testing)
 * rather than locking the route out entirely.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runScheduledDispatch();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[Cron] Dispatch failed:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
