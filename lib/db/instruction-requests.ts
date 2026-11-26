import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

/**
 * Doctor → voice-agent instructions. A doctor never edits the agent directly: they chat with the assistant
 * (lib/agent/doctor-assistant.ts), submit the result here as `pending`, and a hospital admin approves or
 * rejects it. Only `approved` rows reach the live prompt (lib/agent/care-plan.ts loadApprovedInstructions).
 */

export type InstructionStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface InstructionRequest {
  id: string;
  clientId: string;
  tenant_id: string;
  provider_id: string;
  patientId: string | null;
  title: string;
  doctor_message: string;
  proposed_instruction: string;
  transcript: unknown;
  status: InstructionStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  doctorName?: string;
  patientName?: string | null;
}

export class InstructionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const COLUMNS =
  'id, "clientId", tenant_id, provider_id, "patientId", title, doctor_message, proposed_instruction, transcript, status, review_note, reviewed_at, created_at';

export async function createInstructionRequest(
  db: SupabaseClient,
  input: {
    clientId: string;
    tenantId: string;
    providerId: string;
    userId: string;
    patientId: string | null;
    title: string;
    doctorMessage: string;
    proposedInstruction: string;
    transcript?: unknown;
  },
): Promise<InstructionRequest> {
  const { data, error } = await db
    .from("agent_instruction_requests")
    .insert({
      id: `air_${nanoid(10)}`,
      clientId: input.clientId,
      tenant_id: input.tenantId,
      provider_id: input.providerId,
      requested_by_user_id: input.userId,
      patientId: input.patientId,
      title: input.title.trim().slice(0, 120),
      doctor_message: input.doctorMessage.trim().slice(0, 2000),
      proposed_instruction: input.proposedInstruction.trim(),
      transcript: input.transcript ?? [],
      status: "pending",
      created_at: new Date().toISOString(),
    })
    .select(COLUMNS)
    .single();
  if (error || !data) throw new InstructionError(`Could not submit the request: ${error?.message ?? "unknown error"}`, 500);
  return data as unknown as InstructionRequest;
}

export async function listInstructionRequests(
  db: SupabaseClient,
  clientId: string,
  filter: { providerId?: string; status?: InstructionStatus | "all" } = {},
): Promise<InstructionRequest[]> {
  let q = db.from("agent_instruction_requests").select(COLUMNS).eq("clientId", clientId);
  if (filter.providerId) q = q.eq("provider_id", filter.providerId);
  if (filter.status && filter.status !== "all") q = q.eq("status", filter.status);
  const { data } = await q.order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as InstructionRequest[];
  if (rows.length === 0) return rows;

  const [{ data: provs }, patientRows] = await Promise.all([
    db.from("providers").select("id, name").in("id", [...new Set(rows.map((r) => r.provider_id))]),
    (async () => {
      const ids = [...new Set(rows.map((r) => r.patientId).filter((x): x is string => !!x))];
      return ids.length ? db.from("patients").select("id, name").eq("clientId", clientId).in("id", ids) : { data: [] };
    })(),
  ]);
  const pn = new Map(((provs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const patn = new Map(((patientRows.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  return rows.map((r) => ({ ...r, doctorName: pn.get(r.provider_id), patientName: r.patientId ? patn.get(r.patientId) ?? null : null }));
}

export async function reviewInstructionRequest(
  db: SupabaseClient,
  input: { clientId: string; requestId: string; reviewerUserId: string; decision: "approved" | "rejected"; note?: string | null },
): Promise<InstructionRequest> {
  const { data: cur } = await db.from("agent_instruction_requests").select(COLUMNS).eq("clientId", input.clientId).eq("id", input.requestId).maybeSingle();
  const row = cur as unknown as InstructionRequest | null;
  if (!row) throw new InstructionError("Request not found.", 404);
  if (row.status !== "pending") throw new InstructionError(`This request was already ${row.status}.`, 409);
  if (input.decision === "rejected" && !input.note?.trim()) throw new InstructionError("Tell the doctor briefly why it was rejected.");

  const { data, error } = await db
    .from("agent_instruction_requests")
    .update({
      status: input.decision,
      reviewed_by_user_id: input.reviewerUserId,
      review_note: input.note?.trim().slice(0, 500) || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", input.requestId)
    .eq("clientId", input.clientId)
    .select(COLUMNS)
    .single();
  if (error || !data) throw new InstructionError("Could not save the decision.", 500);
  return data as unknown as InstructionRequest;
}

/** The doctor can take back a request that hasn't been reviewed — or retire one that was approved. */
export async function withdrawInstructionRequest(
  db: SupabaseClient,
  input: { clientId: string; requestId: string; providerId: string },
): Promise<InstructionRequest> {
  const { data: cur } = await db.from("agent_instruction_requests").select(COLUMNS).eq("clientId", input.clientId).eq("id", input.requestId).eq("provider_id", input.providerId).maybeSingle();
  const row = cur as unknown as InstructionRequest | null;
  if (!row) throw new InstructionError("Request not found.", 404);
  if (row.status === "withdrawn" || row.status === "rejected") throw new InstructionError(`This request is already ${row.status}.`, 409);
  const { data, error } = await db
    .from("agent_instruction_requests")
    .update({ status: "withdrawn", reviewed_at: new Date().toISOString() })
    .eq("id", input.requestId)
    .eq("clientId", input.clientId)
    .select(COLUMNS)
    .single();
  if (error || !data) throw new InstructionError("Could not withdraw the request.", 500);
  return data as unknown as InstructionRequest;
}
