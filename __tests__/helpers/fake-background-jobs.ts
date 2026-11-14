/**
 * In-memory stand-in for lib/jobs/background-jobs.ts in route tests that
 * fake Supabase with plain tables (no RPCs). Same contract: one job per
 * idempotency key; runJobNow runs it once and records success/failure.
 * The real SQL behaviour is tested against Postgres in
 * __tests__/db/migration-v33.test.ts.
 */
import type { BackgroundJob, JobHandler } from "../../lib/jobs/background-jobs";

const jobs = new Map<string, BackgroundJob>();

export const fakeJobs = {
  all: () => [...jobs.values()],
  reset: () => jobs.clear(),
};

export async function enqueueJob(kind: string, key: string, payload: Record<string, unknown>) {
  if (!jobs.has(key)) {
    jobs.set(key, { id: `job-${jobs.size + 1}`, kind, idempotency_key: key, payload, status: "pending", attempts: 0, max_attempts: 5, last_error: null });
  }
  return jobs.get(key)!;
}

async function run(job: BackgroundJob, handler: JobHandler) {
  job.status = "running";
  job.attempts += 1;
  try {
    await handler(job);
    job.status = "succeeded";
  } catch (err) {
    job.last_error = err instanceof Error ? err.message : String(err);
    job.status = job.attempts >= job.max_attempts ? "failed" : "pending";
  }
}

export async function runJobNow(key: string, handler: JobHandler) {
  const job = jobs.get(key);
  if (job && job.status === "pending") await run(job, handler);
}

export async function runDueJobs(handlers: Record<string, JobHandler>) {
  const due = [...jobs.values()].filter((j) => j.status === "pending" && handlers[j.kind]);
  for (const j of due) await run(j, handlers[j.kind]);
  return { claimed: due.length };
}

export const JOB_LEASE_SECONDS = 240;
