import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { createFollowUpTask, type FollowUpTaskRecord } from "./follow-up-tasks";

/** Shared DB access for follow_up_programmes (migration_v19.sql) — the
 * "minimal reusable template model" spec §10.1 allows for the first
 * release, in place of a full clinical pathway authoring system. */

export interface ProgrammeStep {
  dayOffset: number;
  label: string;
}

export interface FollowUpProgrammeRecord {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  steps: ProgrammeStep[];
  agentId: string | null;
  maxAttempts: number;
  retryDelayMinutes: number;
  windowStartMinute: number | null;
  windowEndMinute: number | null;
  createdAt: number;
}

const PROGRAMME_COLUMNS =
  'id, "clientId", name, description, steps, "agentId", "maxAttempts", "retryDelayMinutes", "windowStartMinute", "windowEndMinute", "createdAt"';

export async function listProgrammes(db: SupabaseClient, clientId: string): Promise<FollowUpProgrammeRecord[]> {
  const { data, error } = await db
    .from("follow_up_programmes")
    .select(PROGRAMME_COLUMNS)
    .eq("clientId", clientId)
    .order("createdAt", { ascending: false });
  if (error || !data) return [];
  return data as unknown as FollowUpProgrammeRecord[];
}

export async function createProgramme(
  db: SupabaseClient,
  clientId: string,
  fields: {
    name: string;
    description?: string | null;
    steps: ProgrammeStep[];
    agentId?: string | null;
    maxAttempts?: number;
    retryDelayMinutes?: number;
    windowStartMinute?: number | null;
    windowEndMinute?: number | null;
  },
): Promise<FollowUpProgrammeRecord | null> {
  const { data, error } = await db
    .from("follow_up_programmes")
    .insert({
      id: nanoid(12),
      clientId,
      name: fields.name,
      description: fields.description ?? null,
      steps: fields.steps,
      agentId: fields.agentId ?? null,
      maxAttempts: fields.maxAttempts ?? 3,
      retryDelayMinutes: fields.retryDelayMinutes ?? 30,
      windowStartMinute: fields.windowStartMinute ?? null,
      windowEndMinute: fields.windowEndMinute ?? null,
      createdAt: Date.now(),
    })
    .select(PROGRAMME_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[lib/db/follow-up-programmes] createProgramme failed:", error?.message);
    return null;
  }
  return data as unknown as FollowUpProgrammeRecord;
}

export async function deleteProgramme(db: SupabaseClient, id: string, clientId: string): Promise<boolean> {
  const { error } = await db.from("follow_up_programmes").delete().eq("id", id).eq("clientId", clientId);
  return !error;
}

/**
 * Enrolls one patient in a programme: reads the template ONCE, then writes
 * one ordinary follow_up_tasks row per step — the programme is never
 * consulted again after this (see migration_v19.sql's doc comment on why
 * that's the versioning guarantee spec §16.6 asks for, in its simplest
 * possible form).
 */
export async function enrollPatientInProgramme(
  db: SupabaseClient,
  clientId: string,
  input: { programmeId: string; patientId: string; startAt: number; timezone: string; patientAssignedAgentId?: string | null },
): Promise<FollowUpTaskRecord[]> {
  const { data: programme, error } = await db
    .from("follow_up_programmes")
    .select(PROGRAMME_COLUMNS)
    .eq("id", input.programmeId)
    .eq("clientId", clientId)
    .single();
  if (error || !programme) return [];

  const steps = (programme.steps as ProgrammeStep[]) ?? [];
  const created: FollowUpTaskRecord[] = [];
  for (const step of steps) {
    const scheduledAt = input.startAt + step.dayOffset * 24 * 60 * 60 * 1000;
    const task = await createFollowUpTask(db, clientId, {
      patientId: input.patientId,
      agentId: programme.agentId ?? input.patientAssignedAgentId ?? null,
      scheduledAt,
      timezone: input.timezone,
      windowStartMinute: programme.windowStartMinute,
      windowEndMinute: programme.windowEndMinute,
      maxAttempts: programme.maxAttempts,
      retryDelayMinutes: programme.retryDelayMinutes,
    });
    if (task) {
      await db.from("follow_up_tasks").update({ programmeId: programme.id, programmeStepLabel: step.label }).eq("id", task.id);
      created.push(task);
    }
  }
  return created;
}
