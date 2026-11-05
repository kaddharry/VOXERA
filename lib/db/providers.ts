import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared DB access for the `providers` table (migration_v29.sql) — the
 * calendar's clinical identities (doctors/clinicians), tenant-scoped like
 * `agents` (see lib/db/agents.ts's getTenantIdForUser), not clientId-scoped
 * like patients/appointments. A provider does NOT require a Supabase auth
 * login (user_id is nullable) — see migration_v29.sql's header comment.
 */

export type ProviderStatus = "active" | "inactive";

export interface ProviderRecord {
  id: string;
  tenant_id: string;
  user_id: string | null;
  name: string;
  specialty: string | null;
  photo_url: string | null;
  color: string;
  status: ProviderStatus;
  default_slot_minutes: number;
  working_hours: Record<string, [string, string][]> | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderFields {
  name: string;
  specialty?: string | null;
  photo_url?: string | null;
  color?: string;
  default_slot_minutes?: number;
  working_hours?: Record<string, [string, string][]> | null;
  status?: ProviderStatus;
}

const PROVIDER_COLUMNS =
  "id, tenant_id, user_id, name, specialty, photo_url, color, status, default_slot_minutes, working_hours, created_at, updated_at";

/** A rotating set of distinct provider tints — drawn entirely from the
 * admin theme's own existing tokens (app/globals.css's .voxera-admin-dark
 * block: the accent pair, the risk ramp, and the chart palette), not fresh
 * hex guesses, so a new provider's color always matches a shade already in
 * use elsewhere in the dashboard. Stored as the CSS var reference itself
 * (not a frozen hex snapshot) so a provider dot stays in sync if the
 * underlying token ever changes. */
const PROVIDER_COLOR_PALETTE = [
  "var(--color-accent-violet)", // #A78BFA
  "var(--risk-high)", // #F97316
  "var(--chart-2)", // #3B82F6
  "var(--risk-low)", // #10B981
  "var(--color-accent-cyan)", // #60A5FA
  "var(--risk-medium)", // #EAB308
  "var(--chart-1)", // #FF8A4C
  "var(--risk-critical)", // #EF4444
];

export function colorForProviderIndex(index: number): string {
  return PROVIDER_COLOR_PALETTE[index % PROVIDER_COLOR_PALETTE.length];
}

export async function listProvidersForTenant(
  db: SupabaseClient,
  tenantId: string,
  options?: { status?: ProviderStatus },
): Promise<ProviderRecord[]> {
  let query = db.from("providers").select(PROVIDER_COLUMNS).eq("tenant_id", tenantId).order("created_at", { ascending: true });
  if (options?.status) query = query.eq("status", options.status);
  const { data, error } = await query;
  if (error || !data) {
    if (error) console.error("[lib/db/providers] listProvidersForTenant failed:", error.message);
    return [];
  }
  return data as unknown as ProviderRecord[];
}

export async function getProviderForTenant(db: SupabaseClient, providerId: string, tenantId: string): Promise<ProviderRecord | null> {
  const { data, error } = await db.from("providers").select(PROVIDER_COLUMNS).eq("id", providerId).eq("tenant_id", tenantId).single();
  if (error || !data) return null;
  return data as unknown as ProviderRecord;
}

/** Unscoped by tenant — used server-side (agent tool handlers resolving a
 * providerId named in a live call) where the caller is trusted
 * infrastructure, mirroring lib/db/patients.ts's getPatientById. */
export async function getProviderById(db: SupabaseClient, providerId: string): Promise<ProviderRecord | null> {
  const { data, error } = await db.from("providers").select(PROVIDER_COLUMNS).eq("id", providerId).single();
  if (error || !data) return null;
  return data as unknown as ProviderRecord;
}

export async function createProvider(db: SupabaseClient, tenantId: string, fields: ProviderFields): Promise<ProviderRecord | null> {
  const { count } = await db.from("providers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const payload: Record<string, unknown> = {
    tenant_id: tenantId,
    name: fields.name,
    specialty: fields.specialty ?? null,
    photo_url: fields.photo_url ?? null,
    color: fields.color ?? colorForProviderIndex(count ?? 0),
    default_slot_minutes: fields.default_slot_minutes ?? 30,
    working_hours: fields.working_hours ?? null,
    status: fields.status ?? "active",
  };
  const { data, error } = await db.from("providers").insert(payload).select(PROVIDER_COLUMNS).single();
  if (error || !data) {
    console.error("[lib/db/providers] createProvider failed:", error?.message);
    return null;
  }
  return data as unknown as ProviderRecord;
}

export async function updateProvider(
  db: SupabaseClient,
  providerId: string,
  tenantId: string,
  fields: Partial<ProviderFields>,
): Promise<ProviderRecord | null> {
  const payload = { ...fields, updated_at: new Date().toISOString() };
  const { data, error } = await db
    .from("providers")
    .update(payload)
    .eq("id", providerId)
    .eq("tenant_id", tenantId)
    .select(PROVIDER_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[lib/db/providers] updateProvider failed:", error?.message);
    return null;
  }
  return data as unknown as ProviderRecord;
}

/** Postgres' FK-violation SQLSTATE — the specific signal that this
 * provider still has appointments referencing it (ON DELETE RESTRICT in
 * migration_v30.sql), as opposed to some other delete failure. */
function isForeignKeyViolation(error: { code?: string } | null): boolean {
  return error?.code === "23503";
}

/** Returns "has_appointments" instead of throwing when the provider can't
 * be deleted because non-cancelled appointments still reference it — the
 * caller (the API route) turns that into a 409 asking staff to reassign or
 * cancel those appointments first, rather than a generic 500. */
export async function deleteProvider(
  db: SupabaseClient,
  providerId: string,
  tenantId: string,
): Promise<"deleted" | "has_appointments" | "error"> {
  const { error } = await db.from("providers").delete().eq("id", providerId).eq("tenant_id", tenantId);
  if (!error) return "deleted";
  if (isForeignKeyViolation(error)) return "has_appointments";
  console.error("[lib/db/providers] deleteProvider failed:", error.message);
  return "error";
}
