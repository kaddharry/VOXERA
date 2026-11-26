import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccess } from "../../../../lib/auth/access";
import { ALL_ROLES } from "../../../../lib/auth/permissions";
import { inviteMember, listTeam, TeamError } from "../../../../lib/db/team";
import { supabase as service } from "../../../../lib/db/supabase";

export const dynamic = "force-dynamic";

const InviteSchema = z.object({
  email: z.string().min(3).max(200),
  role: z.enum(ALL_ROLES as unknown as [string, ...string[]]),
  providerId: z.string().uuid().nullable().optional(),
  name: z.string().max(120).optional(),
  specialty: z.string().max(120).nullable().optional(),
});

/** GET /api/admin/team — everyone with a login for this hospital. */
export async function GET() {
  const guard = await requireAccess("team.manage");
  if (!guard.ok) return guard.response;
  const members = await listTeam(service, guard.access.tenantId, guard.access.clientId);
  return NextResponse.json({ members });
}

/** POST /api/admin/team — create a login. The temp password is returned once and never stored. */
export async function POST(request: NextRequest) {
  const guard = await requireAccess("team.manage");
  if (!guard.ok) return guard.response;
  const parsed = InviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  try {
    const result = await inviteMember(service, {
      tenantId: guard.access.tenantId,
      ownerUserId: guard.access.clientId,
      email: parsed.data.email,
      role: parsed.data.role as (typeof ALL_ROLES)[number],
      providerId: parsed.data.providerId ?? null,
      name: parsed.data.name,
      specialty: parsed.data.specialty ?? null,
    });
    return NextResponse.json({ member: result }, { status: 201 });
  } catch (err) {
    if (err instanceof TeamError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/admin/team] POST failed:", err);
    return NextResponse.json({ error: "Failed to create the login" }, { status: 500 });
  }
}
