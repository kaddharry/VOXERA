import { embed } from "../util/embed";
import { supabase } from "../db/supabase";
import { getAgentWithTenantCached } from "../db/agent-cache";
import { getPatientById } from "../db/patients";
import { buildLearningContext } from "./context";
import { extractWithLlm, validateExtraction, type TranscriptTurn } from "./extract";
import { applyExtraction, type MergeResult } from "./merge";
import { createSupabaseLearningStore, LearningTableMissingError } from "./store";
import type { Learning, LearningStore } from "./types";

export { buildLearningContext } from "./context";
export { applyExtraction } from "./merge";
export { validateExtraction } from "./extract";

const enabled = () => process.env.CALL_LEARNING !== "off";

export interface LearnDeps {
  store: LearningStore;
  loadTranscript: (sessionId: string) => Promise<TranscriptTurn[]>;
  /** Returns the model's raw JSON text. */
  extract: (args: { clientId: string; turns: TranscriptTurn[]; known: Pick<Learning, "key" | "text">[]; agentName?: string }) => Promise<string>;
  /** Optional semantic matcher; defaults to the local embedding model. */
  embed?: (text: string) => Promise<number[]>;
  /** Resolves who/what the call was with; overridable for tests. */
  resolveIdentity: (args: { clientId: string; agentId?: string | null; patientId?: string | null }) => Promise<{ clientId: string; agentName?: string; names: string[]; phones: string[] }>;
}

export async function loadTranscriptFromSession(sessionId: string): Promise<TranscriptTurn[]> {
  const { data, error } = await supabase
    .from("session_logs")
    .select("payload")
    .eq("sessionId", sessionId)
    .eq("type", "utterance")
    .order("ts", { ascending: true });
  if (error || !data) return [];
  return data
    .map((r) => r.payload as { role?: string; text?: string })
    .filter((p): p is { role: "user" | "agent"; text: string } => (p.role === "user" || p.role === "agent") && !!p.text?.trim())
    .map((p) => ({ role: p.role, text: p.text.trim() }));
}

async function resolveIdentityFromDb(args: { clientId: string; agentId?: string | null; patientId?: string | null }) {
  let clientId = args.clientId;
  let agentName: string | undefined;
  if (args.agentId) {
    const agent = await getAgentWithTenantCached(supabase, args.agentId).catch(() => null);
    if (agent) {
      clientId = agent.tenant_auth_user_id; // the agent's tenant owns the learning
      agentName = agent.name;
    }
  }
  const names: string[] = [];
  const phones: string[] = [];
  if (args.patientId) {
    const patient = await getPatientById(supabase, args.patientId).catch(() => null);
    if (patient) {
      names.push(patient.name);
      phones.push(patient.phone);
    }
  }
  return { clientId, agentName, names, phones };
}

let defaultStore: LearningStore | null = null;
function realDeps(): LearnDeps {
  defaultStore ??= createSupabaseLearningStore(supabase);
  return { store: defaultStore, loadTranscript: loadTranscriptFromSession, extract: extractWithLlm, embed: (t) => embed(t), resolveIdentity: resolveIdentityFromDb };
}

export interface LearnOutcome {
  status: "learned" | "skipped";
  reason?: string;
  merge?: MergeResult;
  rejected?: string[];
}

/**
 * Learns from one finished call: extracts grounded takeaways and merges them
 * into patient / agent / global memory. Idempotent per `callId`, safe to call
 * again for the same call. Never throws into the caller's after-call flow —
 * learning is best-effort.
 */
export async function learnFromCall(
  input: { sessionId: string; callId?: string; clientId: string; agentId?: string | null; patientId?: string | null },
  deps: LearnDeps = realDeps(),
): Promise<LearnOutcome> {
  if (!enabled()) return { status: "skipped", reason: "disabled" };
  try {
    const callId = input.callId ?? input.sessionId;
    const turns = await deps.loadTranscript(input.sessionId);
    const patientTurns = turns.filter((t) => t.role === "user");
    if (patientTurns.length === 0) return { status: "skipped", reason: "patient never spoke" };

    const who = await deps.resolveIdentity(input);
    const known = input.patientId ? await deps.store.listPatient(who.clientId, input.patientId, ["active"]) : [];
    const raw = await deps.extract({ clientId: who.clientId, turns, known, agentName: who.agentName });

    const patientText = patientTurns.map((t) => t.text).join("\n");
    const fullText = turns.map((t) => t.text).join("\n");
    const { extraction, rejected } = validateExtraction(raw, { patientText, fullText, identifiers: { names: who.names, phones: who.phones } });
    if (rejected.length) console.log(`[Learning] ${callId}: dropped ${rejected.length} ungrounded/unsafe item(s): ${rejected.slice(0, 5).join(" | ")}`);

    const merge = await applyExtraction({ embed: deps.embed, store: deps.store, clientId: who.clientId, agentId: input.agentId, patientId: input.patientId, callId, extraction });
    invalidateLearningContext(who.clientId);
    console.log(`[Learning] ${callId}: patient +${merge.patient.added} ~${merge.patient.updated} =${merge.patient.reinforced} -${merge.patient.retired}; lessons +${merge.lessons.added} =${merge.lessons.reinforced} promoted ${merge.lessons.promoted}, global ${merge.lessons.globalPromoted}`);
    return { status: "learned", merge, rejected };
  } catch (err) {
    if (err instanceof LearningTableMissingError) {
      console.warn(`[Learning] ${err.message}`);
      return { status: "skipped", reason: "migration not applied" };
    }
    console.error("[Learning] learnFromCall failed:", err);
    return { status: "skipped", reason: err instanceof Error ? err.message : "error" };
  }
}

// ── reading it back at call time ──────────────────────────────────────────────

const CACHE_TTL = 30_000;
const cache = new Map<string, { at: number; text: string | undefined }>();

export function invalidateLearningContext(clientId?: string): void {
  if (!clientId) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(`${clientId}|`)) cache.delete(k);
}

/** The prompt block for this call: the patient's learnings + this agent's + global. Cached briefly. */
export async function getLearningContext(
  args: { clientId: string; agentId?: string | null; patientId?: string | null },
  store?: LearningStore,
): Promise<string | undefined> {
  if (!enabled()) return undefined;
  const key = `${args.clientId}|${args.agentId ?? ""}|${args.patientId ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.text;
  try {
    const s = store ?? (defaultStore ??= createSupabaseLearningStore(supabase));
    const [patient, agent, global] = await Promise.all([
      args.patientId ? s.listPatient(args.clientId, args.patientId, ["active"]) : Promise.resolve([]),
      args.agentId ? s.listAgent(args.clientId, args.agentId, ["active"]) : Promise.resolve([]),
      s.listGlobal(args.clientId, ["active"]),
    ]);
    const text = buildLearningContext({ patient, agent, global });
    cache.set(key, { at: Date.now(), text });
    return text;
  } catch (err) {
    if (!(err instanceof LearningTableMissingError)) console.warn("[Learning] context unavailable:", err);
    return undefined;
  }
}
