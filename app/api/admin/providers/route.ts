import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../lib/db/server";
import { createProvider, listProvidersForTenant } from "../../../../lib/db/providers";
import { getTenantIdForUser } from "../../../../lib/db/agents";

export const dynamic = "force-dynamic";

const CreateProviderSchema = z.object({
  name: z.string().min(1).max(120),
  specialty: z.string().max(120).nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  color: z.string().max(20).optional(),
  defaultSlotMinutes: z.number().int().min(5).max(480).optional(),
  workingHours: z.record(z.string(), z.array(z.tuple([z.string(), z.string()]))).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getTenantIdForUser(supabase, user.id);
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });

  const statusParam = request.nextUrl.searchParams.get("status");
  const providers = await listProvidersForTenant(supabase, tenantId, {
    status: statusParam === "active" || statusParam === "inactive" ? statusParam : undefined,
  });
  return NextResponse.json({ providers });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getTenantIdForUser(supabase, user.id);
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = CreateProviderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const provider = await createProvider(supabase, tenantId, {
    name: parsed.data.name,
    specialty: parsed.data.specialty ?? null,
    photo_url: parsed.data.photoUrl ?? null,
    color: parsed.data.color,
    default_slot_minutes: parsed.data.defaultSlotMinutes,
    working_hours: parsed.data.workingHours ?? null,
  });
  if (!provider) return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  return NextResponse.json({ provider }, { status: 201 });
}
