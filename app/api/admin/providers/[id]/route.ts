import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../../lib/db/server";
import { getTenantIdForUser } from "../../../../../lib/db/agents";
import { deleteProvider, getProviderForTenant, updateProvider } from "../../../../../lib/db/providers";

export const dynamic = "force-dynamic";

const UpdateProviderSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  specialty: z.string().max(120).nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  color: z.string().max(20).optional(),
  defaultSlotMinutes: z.number().int().min(5).max(480).optional(),
  workingHours: z.record(z.string(), z.array(z.tuple([z.string(), z.string()]))).nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

async function resolveTenant() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, tenantId: null, unauthorized: true as const };
  const tenantId = await getTenantIdForUser(supabase, user.id);
  return { supabase, tenantId, unauthorized: false as const };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenantId, unauthorized } = await resolveTenant();
  if (unauthorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });

  const provider = await getProviderForTenant(supabase, id, tenantId);
  if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  return NextResponse.json({ provider });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenantId, unauthorized } = await resolveTenant();
  if (unauthorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = UpdateProviderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const provider = await updateProvider(supabase, id, tenantId, {
    name: parsed.data.name,
    specialty: parsed.data.specialty,
    photo_url: parsed.data.photoUrl,
    color: parsed.data.color,
    default_slot_minutes: parsed.data.defaultSlotMinutes,
    working_hours: parsed.data.workingHours,
    status: parsed.data.status,
  });
  if (!provider) return NextResponse.json({ error: "Provider not found or update failed" }, { status: 404 });
  return NextResponse.json({ provider });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenantId, unauthorized } = await resolveTenant();
  if (unauthorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });

  const result = await deleteProvider(supabase, id, tenantId);
  if (result === "has_appointments") {
    return NextResponse.json(
      { error: "This provider still has active appointments. Reassign or cancel them first." },
      { status: 409 },
    );
  }
  if (result === "error") return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  return NextResponse.json({ success: true });
}
