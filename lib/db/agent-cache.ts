import type { SupabaseClient } from "@supabase/supabase-js";
import { getAgentWithTenant, type AgentWithTenant } from "./agents";
import { getPatientCallContext } from "./patient-documents";
import { buildCarePlanContext } from "../agent/care-plan";

/**
 * Short-TTL in-process caches for the two per-turn lookups that never change
 * during a phone call: the agent row (prompt, voice, tools, owning tenant) and
 * an outbound call's patient context. Both used to be re-read from Supabase on
 * EVERY turn, plus once more when the call started — a database round trip
 * sitting on the critical path in front of the LLM call. The call setup warms
 * them, so every turn after is a Map lookup.
 *
 * Only successful lookups are cached (a null from a transient outage must be
 * retried), and the TTL is short enough that an admin's edit in Agent Builder
 * still reaches the next call within seconds. In-flight lookups are shared so
 * concurrent callers (call setup + first turn) never duplicate the query.
 */
// Vitest runs set NODE_ENV=test: tests re-mock the lookups per case, so a
// process-wide cache would leak one test's agent into the next.
const TTL_MS = process.env.NODE_ENV === "test" ? 0 : 30_000;

interface Entry<T> {
  value: T;
  at: number;
}

const agents = new Map<string, Entry<AgentWithTenant>>();
const agentInflight = new Map<string, Promise<AgentWithTenant | null>>();
const patients = new Map<string, Entry<string | undefined>>();
const patientInflight = new Map<string, Promise<string | undefined>>();

export function getAgentWithTenantCached(db: SupabaseClient, agentId: string): Promise<AgentWithTenant | null> {
  const hit = agents.get(agentId);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value);
  const pending = agentInflight.get(agentId);
  if (pending) return pending;
  const p = getAgentWithTenant(db, agentId)
    .then((agent) => {
      if (agent) agents.set(agentId, { value: agent, at: Date.now() });
      return agent;
    })
    .finally(() => agentInflight.delete(agentId));
  agentInflight.set(agentId, p);
  return p;
}

export function getPatientCallContextCached(db: SupabaseClient, patientId: string): Promise<string | undefined> {
  const hit = patients.get(patientId);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value);
  const pending = patientInflight.get(patientId);
  if (pending) return pending;
  const p = getPatientCallContext(db, patientId)
    .then((ctx) => {
      patients.set(patientId, { value: ctx, at: Date.now() });
      return ctx;
    })
    .finally(() => patientInflight.delete(patientId));
  patientInflight.set(patientId, p);
  return p;
}

const carePlans = new Map<string, Entry<string>>();
const carePlanInflight = new Map<string, Promise<string>>();

/** Last-call pain, medicines and approved doctor instructions for this patient (lib/agent/care-plan.ts). */
export function getCarePlanContextCached(db: SupabaseClient, clientId: string, patientId: string): Promise<string> {
  const key = `${clientId}:${patientId}`;
  const hit = carePlans.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value);
  const pending = carePlanInflight.get(key);
  if (pending) return pending;
  const p = buildCarePlanContext(db, { clientId, patientId })
    .then((ctx) => {
      carePlans.set(key, { value: ctx, at: Date.now() });
      return ctx;
    })
    .finally(() => carePlanInflight.delete(key));
  carePlanInflight.set(key, p);
  return p;
}

/** Call after a doctor changes medicines or an instruction is approved so the next call sees it at once. */
export function invalidateCarePlanContext(clientId: string, patientId?: string): void {
  for (const key of [...carePlans.keys()]) {
    if (key.startsWith(`${clientId}:`) && (!patientId || key.endsWith(`:${patientId}`))) carePlans.delete(key);
  }
}

export function __clearAgentCachesForTesting(): void {
  carePlans.clear();
  carePlanInflight.clear();
  agents.clear();
  patients.clear();
  agentInflight.clear();
  patientInflight.clear();
}
