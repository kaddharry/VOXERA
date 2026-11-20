import { NextRequest, NextResponse } from "next/server";
import { runScheduledDispatch } from "../../../../lib/scheduler/dispatcher";
import { runDueJobs } from "../../../../lib/jobs/background-jobs";
import { POST_CALL_JOB, runPostCallJob } from "../../../../lib/telephony/post-call";
import { recoverTelephonyState } from "../../../../lib/telephony/call-coordination";
import { reportMissingEnvOnce } from "../../../../lib/env";

export const dynamic = "force-dynamic";
// Room for a few after-call jobs (each an LLM summary + analysis).
export const maxDuration = 300;

/**
 * GET /api/cron/dispatch — invoked by the Vercel Schedule in vercel.json
 * (every 15 minutes; on the Hobby plan Vercel may start it up to 15 minutes
 * late, so follow-ups go out within roughly 15–30 minutes of being due).
 * Replaces custom-server.ts's poller, which Vercel never runs. Each run:
 *
 *  1. Recovery: frees call-slot leases a dead Function never released,
 *     marks queued callers who hung up as abandoned, re-queues stuck queue
 *     dispatches (recover_telephony_state, migration_v33).
 *  2. Retries after-call jobs (summary / follow-up decision / insights)
 *     whose immediate run in the status callback didn't finish.
 *  3. Dispatches due follow-up and reminder calls (follow_up_tasks).
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>`. In production the
 * secret is required: without it the route refuses to run rather than
 * letting anyone trigger calls. Locally it may be left unset.
 */
export async function GET(req: NextRequest) {
  reportMissingEnvOnce("cron_dispatch");
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.VERCEL_ENV === "production") {
    console.error(JSON.stringify({ service: "cron", event: "config_missing", variable: "CRON_SECRET" }));
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const recovered = await recoverTelephonyState();
    const jobs = await runDueJobs({ [POST_CALL_JOB]: runPostCallJob }, 5);
    const dispatch = await runScheduledDispatch();
    console.info(JSON.stringify({ service: "cron", event: "cron_dispatch_done", recovered, jobsClaimed: jobs.claimed, ...dispatch }));
    return NextResponse.json({ ok: true, recovered, jobsClaimed: jobs.claimed, ...dispatch });
  } catch (err) {
    console.error("[Cron] Dispatch failed:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
