import { describe, expect, it } from "vitest";
import { resolveAccess } from "../../lib/auth/access";
import { createFakeDb } from "../helpers/fake-supabase";

const OWNER = "owner-1";
const seed = () =>
  createFakeDb({
    tenants: [{ id: "t1", auth_user_id: OWNER }, { id: "t2", auth_user_id: "owner-2" }],
    tenant_members: [
      { tenant_id: "t1", user_id: OWNER, role: "hospital_admin" },
      { tenant_id: "t1", user_id: "doc-1", role: "clinician" },
      { tenant_id: "t1", user_id: "coord-1", role: "care_coordinator" },
      { tenant_id: "t1", user_id: "admin-2", role: "hospital_admin" },
      { tenant_id: "t1", user_id: "weird", role: "superuser" },
    ],
    providers: [{ id: "p1", tenant_id: "t1", user_id: "doc-1" }, { id: "p2", tenant_id: "t1", user_id: null }],
  });

const run = (userId: string, fake = seed()) => {
  const ownerDb = { marker: "owner-db", from: fake.from } as never;
  const service = { marker: "service", from: fake.from } as never;
  return resolveAccess({ id: userId, email: `${userId}@x.test` }, { service, ownerDb });
};

describe("resolveAccess", () => {
  it("treats the tenant owner as hospital admin and keeps their RLS-bound client", async () => {
    const a = await run(OWNER);
    expect(a).toMatchObject({ role: "hospital_admin", tenantId: "t1", clientId: OWNER, isOwner: true });
    expect((a!.db as unknown as { marker: string }).marker).toBe("owner-db");
  });

  it("resolves a doctor to the hospital's owner id and their own provider row, on the service client", async () => {
    const a = await run("doc-1");
    expect(a).toMatchObject({ role: "clinician", tenantId: "t1", clientId: OWNER, providerId: "p1", isOwner: false });
    expect((a!.db as unknown as { marker: string }).marker).toBe("service");
  });

  it("resolves other roles without a provider", async () => {
    expect(await run("coord-1")).toMatchObject({ role: "care_coordinator", providerId: null, clientId: OWNER });
    expect(await run("admin-2")).toMatchObject({ role: "hospital_admin", isOwner: false, clientId: OWNER });
  });

  it("denies a signed-in user who belongs to no hospital", async () => {
    expect(await run("stranger")).toBeNull();
  });

  it("denies a membership row with an unknown role", async () => {
    expect(await run("weird")).toBeNull();
  });

  it("denies a member whose hospital no longer exists", async () => {
    const fake = createFakeDb({ tenants: [], tenant_members: [{ tenant_id: "gone", user_id: "u", role: "auditor" }] });
    expect(await run("u", fake)).toBeNull();
  });
});
