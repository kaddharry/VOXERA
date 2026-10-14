import type { SupabaseClient } from "@supabase/supabase-js";

export type HospitalRole = "hospital_admin" | "care_coordinator" | "clinician" | "auditor";

export interface Membership {
  tenantId: string;
  role: HospitalRole;
}

/**
 * Resolves the logged-in user's hospital membership (tenant_members, added
 * in migration_v16.sql). Every pre-v16 tenant owner was backfilled as
 * hospital_admin of their own tenant, so this should never be null for an
 * existing user — null means either a brand-new signup that hasn't created
 * a tenant yet, or the migration hasn't been run.
 *
 * A user can in principle belong to more than one tenant (the schema
 * supports it for a future multi-hospital-staff case), but nothing in the
 * product yet lets a user pick which one — this returns the first row,
 * matching the current one-tenant-per-user reality.
 */
export async function getCurrentMembership(
  db: SupabaseClient,
  userId: string,
): Promise<Membership | null> {
  const { data, error } = await db
    .from("tenant_members")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { tenantId: data.tenant_id, role: data.role as HospitalRole };
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}
