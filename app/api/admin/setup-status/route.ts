import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { getTenantIdForUser } from "../../../../lib/db/agents";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/setup-status — real completion checks for the Overview
 * dashboard's onboarding checklist, replacing what used to be hardcoded
 * `done={true}`/`done={false}` literals regardless of actual state (spec
 * explicitly warns against a false "all configured" status for workflows
 * that were actually skipped).
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = await getTenantIdForUser(supabase, user.id);

  const [businessSettings, agents, phoneNumbers, knowledge, patients] = await Promise.all([
    tenantId
      ? supabase.from("business_settings").select("id").eq("tenant_id", tenantId).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    tenantId
      ? supabase.from("agents").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)
      : Promise.resolve({ count: 0 }),
    supabase.from("phone_numbers").select("id", { count: "exact", head: true }).eq("clientId", user.id),
    supabase.from("knowledge_documents").select("id", { count: "exact", head: true }).eq("clientId", user.id),
    supabase.from("patients").select("id", { count: "exact", head: true }).eq("clientId", user.id),
  ]);

  return NextResponse.json({
    hasBusinessProfile: !!businessSettings.data,
    hasAgent: (agents.count ?? 0) > 0,
    hasPhoneNumber: (phoneNumbers.count ?? 0) > 0,
    hasKnowledge: (knowledge.count ?? 0) > 0,
    hasPatient: (patients.count ?? 0) > 0,
  });
}
