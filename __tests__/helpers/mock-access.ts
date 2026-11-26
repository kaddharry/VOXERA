import { NextResponse } from "next/server";

/**
 * Stand-in for lib/auth/access in route tests that already mock lib/db/server's createClient():
 * the signed-in "user" is whatever that mocked client's auth.getUser() returns, and they are treated
 * as the hospital owner/admin. Use inside the factory:
 *   vi.mock("../../lib/auth/access", async () => (await import("../helpers/mock-access")).mockAccessModule());
 */
export function mockAccessModule() {
  return {
    requireAccess: async () => {
      const { createClient } = await import("../../lib/db/server");
      const db = await createClient();
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
      return {
        ok: true,
        access: { userId: user.id, email: null, role: "hospital_admin", tenantId: "tenant-1", clientId: user.id, providerId: null, isOwner: true, db },
      };
    },
  };
}
