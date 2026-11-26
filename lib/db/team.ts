import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { colorForProviderIndex } from "./providers";
import { isHospitalRole, type HospitalRole } from "../auth/permissions";

/**
 * Hospital staff logins. The admin creates the account (Supabase admin API, email pre-confirmed) and
 * hands over a one-time temporary password; the person must change it on first sign-in
 * (user_metadata.must_change_password). Doctors (role=clinician) are tied to a `providers` row via
 * providers.user_id so the doctor portal knows which calendar and patients are theirs.
 */

export interface TeamMember {
  userId: string;
  email: string;
  role: HospitalRole;
  isOwner: boolean;
  providerId: string | null;
  providerName: string | null;
  createdAt: string | null;
}

export class TeamError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** 14 chars from an unambiguous alphabet (no 0/O, 1/l/I) — readable over the phone. */
export function generateTempPassword(length = 14): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  return out;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type AdminAuth = {
  createUser(args: Record<string, unknown>): Promise<{ data: { user: { id: string; email?: string } | null }; error: { message: string } | null }>;
  updateUserById(id: string, attrs: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  getUserById(id: string): Promise<{ data: { user: { id: string; email?: string; created_at?: string } | null }; error: { message: string } | null }>;
  listUsers(args?: { page?: number; perPage?: number }): Promise<{ data: { users: { id: string; email?: string }[] }; error: { message: string } | null }>;
};

function adminAuth(db: SupabaseClient): AdminAuth {
  return (db.auth as unknown as { admin: AdminAuth }).admin;
}

async function findUserByEmail(db: SupabaseClient, email: string): Promise<{ id: string; email?: string } | null> {
  // Page through users; hospitals have a handful of staff, but the auth project is shared across tenants.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await adminAuth(db).listUsers({ page, perPage: 200 });
    if (error) throw new TeamError(`Could not look up users: ${error.message}`, 500);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function listTeam(db: SupabaseClient, tenantId: string, ownerUserId: string): Promise<TeamMember[]> {
  const { data: members } = await db.from("tenant_members").select("user_id, role, created_at").eq("tenant_id", tenantId);
  const { data: providers } = await db.from("providers").select("id, name, user_id").eq("tenant_id", tenantId);
  const providerByUser = new Map((providers ?? []).filter((p) => p.user_id).map((p) => [p.user_id as string, p]));

  const rows = (members ?? []) as { user_id: string; role: string; created_at?: string }[];
  if (!rows.some((m) => m.user_id === ownerUserId)) rows.unshift({ user_id: ownerUserId, role: "hospital_admin" });

  const out: TeamMember[] = [];
  for (const m of rows) {
    if (!isHospitalRole(m.role)) continue;
    const { data } = await adminAuth(db).getUserById(m.user_id);
    const provider = providerByUser.get(m.user_id);
    out.push({
      userId: m.user_id,
      email: data.user?.email ?? "(unknown)",
      role: m.role,
      isOwner: m.user_id === ownerUserId,
      providerId: (provider?.id as string | undefined) ?? null,
      providerName: (provider?.name as string | undefined) ?? null,
      createdAt: m.created_at ?? data.user?.created_at ?? null,
    });
  }
  return out;
}

export interface InviteInput {
  tenantId: string;
  ownerUserId: string;
  email: string;
  role: HospitalRole;
  /** Link to an existing doctor (clinician only). */
  providerId?: string | null;
  /** Create a new doctor row with this name (clinician only, when providerId is absent). */
  name?: string;
  specialty?: string | null;
}

export interface InviteResult {
  userId: string;
  email: string;
  role: HospitalRole;
  providerId: string | null;
  /** Shown once to the admin. Null when an existing account was linked (they keep their own password). */
  tempPassword: string | null;
  existingAccount: boolean;
}

export async function inviteMember(db: SupabaseClient, input: InviteInput): Promise<InviteResult> {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new TeamError("Enter a valid email address.");
  if (!isHospitalRole(input.role)) throw new TeamError("Unknown role.");

  let providerId: string | null = null;
  if (input.role === "clinician") {
    if (input.providerId) {
      const { data: provider } = await db.from("providers").select("id, user_id").eq("id", input.providerId).eq("tenant_id", input.tenantId).maybeSingle();
      if (!provider) throw new TeamError("That doctor doesn't belong to this hospital.", 404);
      if (provider.user_id) throw new TeamError("This doctor already has a login. Reset the password instead.", 409);
      providerId = provider.id as string;
    } else if (!input.name?.trim()) {
      throw new TeamError("Choose an existing doctor or enter the doctor's name.");
    }
  }

  const existingUser = await findUserByEmail(db, email);
  if (existingUser) {
    if (existingUser.id === input.ownerUserId) throw new TeamError("That is the hospital owner's own login.", 409);
    const { data: ownsTenant } = await db.from("tenants").select("id").eq("auth_user_id", existingUser.id).maybeSingle();
    if (ownsTenant) throw new TeamError("That email already runs its own hospital account, so it can't also join this one.", 409);
    const { data: elsewhere } = await db.from("tenant_members").select("tenant_id").eq("user_id", existingUser.id).limit(1).maybeSingle();
    if (elsewhere && elsewhere.tenant_id !== input.tenantId) throw new TeamError("That email already belongs to another hospital.", 409);
  }

  let userId: string;
  let tempPassword: string | null = null;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    tempPassword = generateTempPassword();
    const { data, error } = await adminAuth(db).createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { must_change_password: true, invited_role: input.role },
    });
    if (error || !data.user) throw new TeamError(`Could not create the login: ${error?.message ?? "unknown error"}`, 500);
    userId = data.user.id;
  }

  const { data: already } = await db.from("tenant_members").select("role").eq("tenant_id", input.tenantId).eq("user_id", userId).maybeSingle();
  if (already) {
    const { error } = await db.from("tenant_members").update({ role: input.role }).eq("tenant_id", input.tenantId).eq("user_id", userId);
    if (error) throw new TeamError(`Could not update the role: ${error.message}`, 500);
  } else {
    const { error } = await db.from("tenant_members").insert({ tenant_id: input.tenantId, user_id: userId, role: input.role });
    if (error) throw new TeamError(`Could not add the team member: ${error.message}`, 500);
  }

  if (input.role === "clinician") {
    if (providerId) {
      const { error } = await db.from("providers").update({ user_id: userId }).eq("id", providerId).eq("tenant_id", input.tenantId);
      if (error) throw new TeamError(`Could not link the doctor: ${error.message}`, 500);
    } else {
      const { data: all } = await db.from("providers").select("id").eq("tenant_id", input.tenantId);
      const { data: created, error } = await db
        .from("providers")
        .insert({
          tenant_id: input.tenantId,
          user_id: userId,
          name: input.name!.trim(),
          specialty: input.specialty ?? null,
          color: colorForProviderIndex((all ?? []).length),
          status: "active",
          default_slot_minutes: 30,
        })
        .select("id")
        .single();
      if (error || !created) throw new TeamError(`Could not create the doctor: ${error?.message ?? "unknown error"}`, 500);
      providerId = created.id as string;
    }
  }

  return { userId, email, role: input.role, providerId, tempPassword, existingAccount: !!existingUser };
}

export async function resetMemberPassword(db: SupabaseClient, tenantId: string, userId: string): Promise<string> {
  const { data: member } = await db.from("tenant_members").select("role").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (!member) throw new TeamError("That person isn't on your team.", 404);
  const tempPassword = generateTempPassword();
  const { error } = await adminAuth(db).updateUserById(userId, { password: tempPassword, user_metadata: { must_change_password: true } });
  if (error) throw new TeamError(`Could not reset the password: ${error.message}`, 500);
  return tempPassword;
}

export async function changeMemberRole(db: SupabaseClient, tenantId: string, ownerUserId: string, userId: string, role: HospitalRole): Promise<void> {
  if (userId === ownerUserId) throw new TeamError("The hospital owner is always an admin.", 409);
  if (!isHospitalRole(role)) throw new TeamError("Unknown role.");
  const { data: member } = await db.from("tenant_members").select("role").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (!member) throw new TeamError("That person isn't on your team.", 404);
  if (member.role === "clinician" && role !== "clinician") {
    await db.from("providers").update({ user_id: null }).eq("tenant_id", tenantId).eq("user_id", userId);
  }
  if (role === "clinician" && member.role !== "clinician") {
    throw new TeamError("To make someone a doctor, add them with the Doctor role so they get a calendar.", 400);
  }
  const { error } = await db.from("tenant_members").update({ role }).eq("tenant_id", tenantId).eq("user_id", userId);
  if (error) throw new TeamError(`Could not update the role: ${error.message}`, 500);
}

export async function removeMember(db: SupabaseClient, tenantId: string, ownerUserId: string, userId: string): Promise<void> {
  if (userId === ownerUserId) throw new TeamError("The hospital owner can't be removed.", 409);
  await db.from("providers").update({ user_id: null }).eq("tenant_id", tenantId).eq("user_id", userId);
  const { error } = await db.from("tenant_members").delete().eq("tenant_id", tenantId).eq("user_id", userId);
  if (error) throw new TeamError(`Could not remove the team member: ${error.message}`, 500);
}
