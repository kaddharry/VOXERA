import { supabase } from "../db/supabase";

/**
 * Durable background jobs in Postgres (background_jobs, sql/migration_v33.sql).
 *
 * Important work that happens after an HTTP response (the post-call summary,
 * follow-up retry decision and self-learning analysis) is first saved as a
 * job with an idempotency key, then run straight away inside waitUntil().
 * If that run is cut short (the Function is frozen, a deploy restarts it, a
 * provider errors) the job stays in the table: the scheduled cron
 * (/api/cron/dispatch) claims it again once its lease expires and retries it,
 * with backoff, up to max_attempts. Claims use FOR UPDATE SKIP LOCKED, so two
 * workers never run the same job at once.
 */

export interface BackgroundJob<P = Record<string, unknown>> {
  id: string;
  kind: string;
  idempotency_key: string;
  payload: P;
  status: "pending" | "running" | "succeeded" | "failed";
  attempts: number;
  max_attempts: number;
  last_error: string | null;
}

export type JobHandler = (job: BackgroundJob) => Promise<void>;

/** Long enough for an LLM summary + analysis; a stuck run is retried after this. */
export const JOB_LEASE_SECONDS = 240;

function logJob(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ service: "jobs", event, ...fields }));
}

export async function enqueueJob(kind: string, idempotencyKey: string, payload: Record<string, unknown>): Promise<BackgroundJob | null> {
  const { data, error } = await supabase.rpc("enqueue_job", {
    p_kind: kind,
    p_idempotency_key: idempotencyKey,
    p_payload: payload,
    p_run_at: new Date().toISOString(),
    p_max_attempts: 5,
  });
  if (error) {
    logJob("job_enqueue_failed", { kind, idempotencyKey, error: error.message });
    return null;
  }
  return data as BackgroundJob;
}

async function finish(job: BackgroundJob, ok: boolean, err?: unknown) {
  const message = err instanceof Error ? err.message : err ? String(err) : null;
  const { data, error } = await supabase.rpc("complete_job", { p_id: job.id, p_ok: ok, p_error: message, p_retry_seconds: 60 });
  if (error) {
    logJob("job_complete_failed", { id: job.id, kind: job.kind, error: error.message });
    return;
  }
  const status = (data as BackgroundJob | null)?.status;
  logJob(ok ? "job_succeeded" : status === "failed" ? "job_failed_permanently" : "job_retry_scheduled", {
    id: job.id,
    kind: job.kind,
    key: job.idempotency_key,
    attempts: job.attempts,
    ...(message && { error: message.slice(0, 300) }),
  });
}

async function runClaimed(job: BackgroundJob, handler: JobHandler): Promise<void> {
  try {
    await handler(job);
    await finish(job, true);
  } catch (err) {
    await finish(job, false, err);
  }
}

/** Claims the job with this key right now (if nobody else holds it) and runs it. */
export async function runJobNow(idempotencyKey: string, handler: JobHandler): Promise<void> {
  const { data, error } = await supabase.rpc("claim_job_by_key", { p_idempotency_key: idempotencyKey, p_lease_seconds: JOB_LEASE_SECONDS });
  if (error) {
    logJob("job_claim_failed", { key: idempotencyKey, error: error.message });
    return;
  }
  const job = (data as BackgroundJob[] | null)?.[0];
  if (!job) return; // already running elsewhere, finished, or out of attempts
  await runClaimed(job, handler);
}

/** Claims due/expired jobs of these kinds and runs them one by one (used by the cron). */
export async function runDueJobs(handlers: Record<string, JobHandler>, limit = 10): Promise<{ claimed: number }> {
  const { data, error } = await supabase.rpc("claim_jobs", { p_kinds: Object.keys(handlers), p_limit: limit, p_lease_seconds: JOB_LEASE_SECONDS });
  if (error) {
    logJob("job_claim_failed", { kinds: Object.keys(handlers), error: error.message });
    return { claimed: 0 };
  }
  const jobs = (data as BackgroundJob[] | null) ?? [];
  for (const job of jobs) {
    const handler = handlers[job.kind];
    if (handler) await runClaimed(job, handler);
  }
  return { claimed: jobs.length };
}
