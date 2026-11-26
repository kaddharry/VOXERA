import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccess } from "../../../../../lib/auth/access";
import { ALL_ROLES } from "../../../../../lib/auth/permissions";
import { changeMemberRole, removeMember, resetMemberPassword, TeamError } from "../../../../../lib/db/team";
import { supabase as service } from "../../../../../lib/db/supabase";

export const dynamic = "force-dynamic";

const PatchSchema = z.union([
  z.object({ action: z.literal("reset_password") }),
  z.object({ action: z.literal("set_role"), role: z.enum(ALL_ROLES as unknown as [string, ...string[]]) }),
]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireAccess("team.manage");
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  try {
    if (parsed.data.action === "reset_password") {
      const tempPassword = await resetMemberPassword(service, guard.access.tenantId, userId);
      return NextResponse.json({ tempPassword });
    }
    await changeMemberRole(service, guard.access.tenantId, guard.access.clientId, userId, parsed.data.role as (typeof ALL_ROLES)[number]);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof TeamError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/admin/team/[userId]] PATCH failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireAccess("team.manage");
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  try {
    await removeMember(service, guard.access.tenantId, guard.access.clientId, userId);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof TeamError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
