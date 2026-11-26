import { NextResponse } from "next/server";
import { requireDoctorScope } from "../../../../lib/auth/doctor-scope";
import { createClient } from "../../../../lib/db/server";
import { getProviderById } from "../../../../lib/db/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const provider = await getProviderById(guard.access.db, guard.scope.providerId);
  const cookieDb = await createClient();
  const { data: { user } } = await cookieDb.auth.getUser();
  return NextResponse.json({
    email: guard.access.email,
    provider: provider ? { id: provider.id, name: provider.name, specialty: provider.specialty, color: provider.color } : null,
    mustChangePassword: !!user?.user_metadata?.must_change_password,
  });
}
