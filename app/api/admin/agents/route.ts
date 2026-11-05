import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../lib/db/server";
import { createAgent, getTenantIdForUser, listAgentsForTenant } from "../../../../lib/db/agents";

export const dynamic = "force-dynamic";

const CreateAgentSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  system_prompt: z.string().max(6000).optional(),
  greeting: z.string().max(500).optional(),
  voice_persona: z.string().max(60).optional(),
  speech_provider: z.enum(["deepgram", "gnani"]).nullable().optional(),
  language: z.string().max(20).nullable().optional(),
});

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = await getTenantIdForUser(supabase, user.id);
  if (!tenantId) {
    return NextResponse.json({ agents: [] });
  }

  const agents = await listAgentsForTenant(supabase, tenantId);
  return NextResponse.json({ agents });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = await getTenantIdForUser(supabase, user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant found for this account — complete onboarding first." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = CreateAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const agent = await createAgent(supabase, tenantId, parsed.data);
  if (!agent) {
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
  }
  return NextResponse.json({ agent }, { status: 201 });
}
