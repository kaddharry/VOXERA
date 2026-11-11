import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../../lib/db/server";
import { deleteAgent, getAgentForTenant, getTenantIdForUser, updateAgent } from "../../../../../lib/db/agents";

export const dynamic = "force-dynamic";

const UpdateAgentSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(280).nullable().optional(),
  system_prompt: z.string().max(6000).nullable().optional(),
  greeting: z.string().max(500).nullable().optional(),
  voice_persona: z.string().max(60).nullable().optional(),
  speech_provider: z.enum(["deepgram", "gnani"]).nullable().optional(),
  language: z.string().max(20).nullable().optional(),
  enabledTools: z.array(z.string()).optional(),
});

async function resolveTenant(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, tenantId: null, unauthorized: true as const };
  const tenantId = await getTenantIdForUser(supabase, user.id);
  return { supabase, tenantId, unauthorized: false as const };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenantId, unauthorized } = await resolveTenant(request);
  if (unauthorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });

  const agent = await getAgentForTenant(supabase, id, tenantId);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json({ agent });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenantId, unauthorized } = await resolveTenant(request);
  if (unauthorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = UpdateAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const agent = await updateAgent(supabase, id, tenantId, parsed.data);
  if (!agent) return NextResponse.json({ error: "Agent not found or update failed" }, { status: 404 });
  return NextResponse.json({ agent });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenantId, unauthorized } = await resolveTenant(request);
  if (unauthorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });

  const ok = await deleteAgent(supabase, id, tenantId);
  if (!ok) return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  return NextResponse.json({ success: true });
}
