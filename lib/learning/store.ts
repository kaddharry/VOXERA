import type { SupabaseClient } from "@supabase/supabase-js";
import type { Learning, LearningStatus, LearningStore } from "./types";

/** Thrown-away error type: the migration hasn't been applied yet. Learning then quietly does nothing. */
export class LearningTableMissingError extends Error {
  constructor() {
    super("call_learnings table not found — run sql/migration_v36.sql to turn on call learning.");
  }
}

function missingTable(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(error.message ?? ""));
}

const DEFAULT_STATUSES: LearningStatus[] = ["active"];

export function createSupabaseLearningStore(db: SupabaseClient): LearningStore {
  const unwrap = <T>(res: { data: T; error: { code?: string; message?: string } | null }, what: string): T => {
    if (missingTable(res.error)) throw new LearningTableMissingError();
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    return res.data;
  };

  return {
    async listPatient(clientId, patientId, statuses = DEFAULT_STATUSES) {
      const data = unwrap(
        await db.from("call_learnings").select("*").eq("clientId", clientId).eq("scope", "patient").eq("patientId", patientId).in("status", statuses),
        "Reading patient learnings",
      );
      return (data ?? []) as Learning[];
    },
    async listAgent(clientId, agentId, statuses = DEFAULT_STATUSES) {
      const data = unwrap(
        await db.from("call_learnings").select("*").eq("clientId", clientId).eq("scope", "agent").eq("agentId", agentId).in("status", statuses),
        "Reading agent learnings",
      );
      return (data ?? []) as Learning[];
    },
    async listGlobal(clientId, statuses = DEFAULT_STATUSES) {
      const data = unwrap(
        await db.from("call_learnings").select("*").eq("clientId", clientId).eq("scope", "global").in("status", statuses),
        "Reading global learnings",
      );
      return (data ?? []) as Learning[];
    },
    async listAllPatient(clientId, limit = 300) {
      const data = unwrap(
        await db.from("call_learnings").select("*").eq("clientId", clientId).eq("scope", "patient").eq("status", "active").order("updatedAt", { ascending: false }).limit(limit),
        "Reading patient learnings",
      );
      return (data ?? []) as Learning[];
    },
    async listAllAgentLessons(clientId) {
      const data = unwrap(
        await db.from("call_learnings").select("*").eq("clientId", clientId).eq("scope", "agent").in("status", ["active", "pending"]),
        "Reading agent lessons",
      );
      return (data ?? []) as Learning[];
    },
    async insert(row) {
      unwrap(await db.from("call_learnings").insert(row), "Saving a learning");
    },
    async update(id, patch) {
      unwrap(await db.from("call_learnings").update(patch).eq("id", id), "Updating a learning");
    },
    async remove(id) {
      unwrap(await db.from("call_learnings").delete().eq("id", id), "Deleting a learning");
    },
  };
}

/** In-memory store with the same semantics — for tests and offline runs. */
export function createMemoryLearningStore(): LearningStore & { rows: Learning[] } {
  const rows: Learning[] = [];
  const pick = (pred: (l: Learning) => boolean, statuses: LearningStatus[]) => rows.filter((l) => statuses.includes(l.status) && pred(l)).map((l) => ({ ...l }));
  return {
    rows,
    async listPatient(clientId, patientId, statuses = DEFAULT_STATUSES) {
      return pick((l) => l.clientId === clientId && l.scope === "patient" && l.patientId === patientId, statuses);
    },
    async listAgent(clientId, agentId, statuses = DEFAULT_STATUSES) {
      return pick((l) => l.clientId === clientId && l.scope === "agent" && l.agentId === agentId, statuses);
    },
    async listGlobal(clientId, statuses = DEFAULT_STATUSES) {
      return pick((l) => l.clientId === clientId && l.scope === "global", statuses);
    },
    async listAllPatient(clientId, limit = 300) {
      return pick((l) => l.clientId === clientId && l.scope === "patient", ["active"]).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    },
    async listAllAgentLessons(clientId) {
      return pick((l) => l.clientId === clientId && l.scope === "agent", ["active", "pending"]);
    },
    async insert(row) {
      rows.push({ ...row });
    },
    async update(id, patch) {
      const i = rows.findIndex((l) => l.id === id);
      if (i >= 0) rows[i] = { ...rows[i], ...patch };
    },
    async remove(id) {
      const i = rows.findIndex((l) => l.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
  };
}
