import { requireDoctor, type Access } from "./access";
import type { NextResponse } from "next/server";
import type { DoctorScope } from "../db/doctor";

/** Guard for /api/doctor/*: a doctor login linked to a provider, plus the scope every query is limited to. */
export async function requireDoctorScope(): Promise<{ ok: true; access: Access; scope: DoctorScope } | { ok: false; response: NextResponse }> {
  const guard = await requireDoctor();
  if (!guard.ok) return guard;
  return {
    ok: true,
    access: guard.access,
    scope: { clientId: guard.access.clientId, tenantId: guard.access.tenantId, providerId: guard.providerId! },
  };
}
