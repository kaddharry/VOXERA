import { describe, expect, it } from "vitest";
import { changeMemberRole, generateTempPassword, inviteMember, listTeam, removeMember, resetMemberPassword, TeamError } from "../../lib/db/team";
import { createFakeDb } from "../helpers/fake-supabase";

function setup(extraUsers: { id: string; email: string }[] = []) {
  const fake = createFakeDb({
    tenants: [{ id: "t1", auth_user_id: "owner-1" }, { id: "t2", auth_user_id: "owner-2" }],
    tenant_members: [{ tenant_id: "t1", user_id: "owner-1", role: "hospital_admin" }, { tenant_id: "t2", user_id: "other-staff", role: "auditor" }],
    providers: [
      { id: "p1", tenant_id: "t1", user_id: null, name: "Dr. Rao", status: "active" },
      { id: "p2", tenant_id: "t1", user_id: "doc-existing", name: "Dr. Shah", status: "active" },
    ],
  });
  const users = [{ id: "owner-1", email: "owner@h.test" }, { id: "other-staff", email: "other@h2.test" }, { id: "owner-2", email: "owner2@h2.test" }, ...extraUsers];
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const db = {
    ...fake,
    auth: {
      admin: {
        createUser: async (args: { email: string }) => {
          const user = { id: `new-${users.length}`, email: args.email };
          users.push(user);
          created.push(args);
          return { data: { user }, error: null };
        },
        updateUserById: async (id: string, attrs: Record<string, unknown>) => (updated.push({ id, ...attrs }), { data: {}, error: null }),
        getUserById: async (id: string) => ({ data: { user: users.find((u) => u.id === id) ?? null }, error: null }),
        listUsers: async () => ({ data: { users }, error: null }),
      },
    },
  } as never;
  return { db, fake, created, updated, users };
}
const base = { tenantId: "t1", ownerUserId: "owner-1" };

describe("temporary passwords", () => {
  it("are long, unambiguous and different every time", () => {
    const a = generateTempPassword();
    expect(a).toHaveLength(14);
    expect(a).not.toMatch(/[0OlI1]/);
    expect(generateTempPassword()).not.toBe(a);
  });
});

describe("inviteMember", () => {
  it("creates a doctor login linked to an existing doctor profile, with a forced password change", async () => {
    const { db, fake, created } = setup();
    const r = await inviteMember(db, { ...base, email: " Dr.Rao@Hospital.test ", role: "clinician", providerId: "p1" });
    expect(r).toMatchObject({ email: "dr.rao@hospital.test", role: "clinician", providerId: "p1", existingAccount: false });
    expect(r.tempPassword).toHaveLength(14);
    expect(created[0]).toMatchObject({ email_confirm: true, user_metadata: { must_change_password: true } });
    expect(fake.tables.tenant_members.find((m) => m.user_id === r.userId)).toMatchObject({ tenant_id: "t1", role: "clinician" });
    expect(fake.tables.providers.find((p) => p.id === "p1")!.user_id).toBe(r.userId);
  });

  it("creates the doctor profile too when only a name is given", async () => {
    const { db, fake } = setup();
    const r = await inviteMember(db, { ...base, email: "new.doc@h.test", role: "clinician", name: "Dr. New", specialty: "ENT" });
    const provider = fake.tables.providers.find((p) => p.id === r.providerId)!;
    expect(provider).toMatchObject({ name: "Dr. New", specialty: "ENT", tenant_id: "t1", user_id: r.userId });
  });

  it("refuses a doctor that already has a login, or one from another hospital", async () => {
    const { db } = setup();
    await expect(inviteMember(db, { ...base, email: "a@h.test", role: "clinician", providerId: "p2" })).rejects.toMatchObject({ status: 409 });
    await expect(inviteMember(db, { ...base, email: "a@h.test", role: "clinician", providerId: "nope" })).rejects.toMatchObject({ status: 404 });
  });

  it("needs a doctor or a name for the Doctor role, and a real email", async () => {
    const { db } = setup();
    await expect(inviteMember(db, { ...base, email: "a@h.test", role: "clinician" })).rejects.toBeInstanceOf(TeamError);
    await expect(inviteMember(db, { ...base, email: "not-an-email", role: "auditor" })).rejects.toThrow(/valid email/);
  });

  it("refuses the owner, another hospital's owner, and another hospital's staff", async () => {
    const { db } = setup();
    await expect(inviteMember(db, { ...base, email: "owner@h.test", role: "auditor" })).rejects.toMatchObject({ status: 409 });
    await expect(inviteMember(db, { ...base, email: "owner2@h2.test", role: "auditor" })).rejects.toMatchObject({ status: 409 });
    await expect(inviteMember(db, { ...base, email: "other@h2.test", role: "auditor" })).rejects.toMatchObject({ status: 409 });
  });

  it("adds a coordinator without a doctor profile", async () => {
    const { db, fake } = setup();
    const r = await inviteMember(db, { ...base, email: "front.desk@h.test", role: "care_coordinator" });
    expect(r.providerId).toBeNull();
    expect(fake.tables.providers).toHaveLength(2);
  });
});

describe("managing the team", () => {
  it("lists everyone with email, role and doctor profile, owner first", async () => {
    const { db } = setup();
    const invited = await inviteMember(db, { ...base, email: "dr.rao@h.test", role: "clinician", providerId: "p1" });
    const team = await listTeam(db, "t1", "owner-1");
    expect(team.map((m) => m.email)).toEqual(["owner@h.test", "dr.rao@h.test"]);
    expect(team.find((m) => m.userId === invited.userId)).toMatchObject({ role: "clinician", providerName: "Dr. Rao", isOwner: false });
  });

  it("resets a password only for someone on this team", async () => {
    const { db, updated } = setup();
    const invited = await inviteMember(db, { ...base, email: "a@h.test", role: "auditor" });
    const pw = await resetMemberPassword(db, "t1", invited.userId);
    expect(updated[0]).toMatchObject({ id: invited.userId, password: pw, user_metadata: { must_change_password: true } });
    await expect(resetMemberPassword(db, "t1", "other-staff")).rejects.toMatchObject({ status: 404 });
  });

  it("removing a doctor unlinks their profile but keeps the doctor on the calendar", async () => {
    const { db, fake } = setup();
    const invited = await inviteMember(db, { ...base, email: "a@h.test", role: "clinician", providerId: "p1" });
    await removeMember(db, "t1", "owner-1", invited.userId);
    expect(fake.tables.tenant_members.some((m) => m.user_id === invited.userId)).toBe(false);
    expect(fake.tables.providers.find((p) => p.id === "p1")).toMatchObject({ user_id: null });
  });

  it("never removes or demotes the owner", async () => {
    const { db } = setup();
    await expect(removeMember(db, "t1", "owner-1", "owner-1")).rejects.toMatchObject({ status: 409 });
    await expect(changeMemberRole(db, "t1", "owner-1", "owner-1", "auditor")).rejects.toMatchObject({ status: 409 });
  });

  it("changes a role, and won't turn a non-doctor into a doctor without a calendar", async () => {
    const { db, fake } = setup();
    const invited = await inviteMember(db, { ...base, email: "a@h.test", role: "auditor" });
    await changeMemberRole(db, "t1", "owner-1", invited.userId, "care_coordinator");
    expect(fake.tables.tenant_members.find((m) => m.user_id === invited.userId)!.role).toBe("care_coordinator");
    await expect(changeMemberRole(db, "t1", "owner-1", invited.userId, "clinician")).rejects.toThrow(/Doctor role/);
  });
});
