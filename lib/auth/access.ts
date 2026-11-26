import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "../db/server";
import { supabase as serviceDb } from "../db/supabase";
import { can, isHospitalRole, type HospitalRole, type Permission } from "./permissions";

/**
 * Who is calling, and what may they touch.
 *
 * The tenant owner (tenants.auth_user_id) is always hospital_admin and keeps using the cookie-bound,
 * RLS-protected client exactly as before. Every other member (doctor, coordinator, auditor, extra
 * admin) cannot pass the owner-only RLS policies, so their requests run on the service-role client
 * AFTER the role check — every query must then be scoped by `clientId`/`tenantId`/`providerId` from
 * this object, never by anything the browser sent.
 */
export interface Access {
  userId: string;
  email: string | null;
  role: HospitalRole;
  tenantId: string;
  /** The tenant owner's auth id — the `clientId` every tenant-scoped table is keyed by. */
  clientId: string;
  /** The doctor row (providers.id) linked to this login, if any. */
  providerId: string | null;
  isOwner: boolean;
  db: SupabaseClient;
}

export interface ResolveDeps {
  /** Service-role client used to read tenants/memberships/providers (always allowed to). */
  service: SupabaseClient;
  /** Client handed back as `access.db` for the tenant owner. */
  ownerDb: SupabaseClient;
}

export async function resolveAccess(user: { id: string; email?: string | null }, deps: ResolveDeps): Promise<Access | null> {
  const { service, ownerDb } = deps;

  const { data: owned } = await service.from("tenants").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (owned) {
    const providerId = await providerFor(service, owned.id as string, user.id);
    return {
      userId: user.id,
      email: user.email ?? null,
      role: "hospital_admin",
      tenantId: owned.id as string,
      clientId: user.id,
      providerId,
      isOwner: true,
      db: ownerDb,
    };
  }

  const { data: member } = await service.from("tenant_members").select("tenant_id, role").eq("user_id", user.id).limit(1).maybeSingle();
  if (!member || !isHospitalRole(member.role)) return null;
  const { data: tenant } = await service.from("tenants").select("id, auth_user_id").eq("id", member.tenant_id).maybeSingle();
  if (!tenant?.auth_user_id) return null;

  return {
    userId: user.id,
    email: user.email ?? null,
    role: member.role,
    tenantId: tenant.id as string,
    clientId: tenant.auth_user_id as string,
    providerId: await providerFor(service, tenant.id as string, user.id),
    isOwner: false,
    db: service,
  };
}

async function providerFor(service: SupabaseClient, tenantId: string, userId: string): Promise<string | null> {
  const { data } = await service.from("providers").select("id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Current request's access, or null when signed out / not a member of any hospital. */
export async function getAccess(): Promise<Access | null> {
  const cookieDb = await createClient();
  const {
    data: { user },
  } = await cookieDb.auth.getUser();
  if (!user) return null;
  return resolveAccess(user, { service: serviceDb, ownerDb: cookieDb });
}

export type AccessResult = { ok: true; access: Access } | { ok: false; response: NextResponse };

/** Route guard: 401 when signed out, 403 when the role lacks `permission`. */
export async function requireAccess(permission: Permission): Promise<AccessResult> {
  const access = await getAccess();
  if (!access) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!can(access.role, permission)) {
    return { ok: false, response: NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 }) };
  }
  return { ok: true, access };
}

/** Route guard for /api/doctor/*: must be a doctor login linked to a provider. */
export async function requireDoctor(): Promise<AccessResult & { providerId?: string }> {
  const access = await getAccess();
  if (!access) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (access.role !== "clinician" || !access.providerId) {
    return { ok: false, response: NextResponse.json({ error: "Doctor access only." }, { status: 403 }) };
  }
  return { ok: true, access, providerId: access.providerId };
}
