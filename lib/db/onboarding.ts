import { supabase } from "./supabase";

export interface OnboardingPayload {
  businessName: string;
  industry: string;
  workflow: string;
  callGoal: string;
  escalation: string;
  openingTime: string;
  closingTime: string;
  language: string;
  tone: string;
  greeting: string;
}
export async function processOnboarding(userId: string, payload: OnboardingPayload) {
  // 1. Check if tenant already exists for this user
  let tenantId: string;
  
  const { data: existingTenant, error: tErr } = await supabase
    .from("tenants")
    .select("id")
    .eq("auth_user_id", userId)
    .single();

  if (tErr && tErr.code !== "PGRST116") { // Ignore "not found" error
    throw new Error(`Failed to check tenant: ${tErr.message}`);
  }

  if (existingTenant) {
    tenantId = existingTenant.id;
    // Update industry if changed
    await supabase.from("tenants").update({ industry: payload.industry }).eq("id", tenantId);
  } else {
    // Create new tenant
    const { data: newTenant, error: insertErr } = await supabase
      .from("tenants")
      .insert({
        auth_user_id: userId,
        name: payload.businessName,
        industry: payload.industry,
      })
      .select("id")
      .single();

    if (insertErr || !newTenant) {
      throw new Error(`Failed to create tenant: ${insertErr?.message}`);
    }
    tenantId = newTenant.id;
  }

  // 2. Upsert business settings
  const { error: bsErr } = await supabase
    .from("business_settings")
    .upsert(
      {
        tenant_id: tenantId,
        business_name: payload.businessName,
        workflow_type: payload.workflow,
        call_goal: payload.callGoal,
        escalation_policy: payload.escalation,
        opening_time: payload.openingTime,
        closing_time: payload.closingTime,
        language: payload.language,
        tone: payload.tone,
        greeting: payload.greeting,
      },
      { onConflict: "tenant_id" }
    );

  if (bsErr) {
    throw new Error(`Failed to save business settings: ${bsErr.message}`);
  }

  // 3. Create a draft Agent representing this setup
  const agentName = payload.workflow === "aftercare" ? "Aftercare Agent" 
                  : payload.workflow === "booking" ? "Booking Agent"
                  : payload.workflow === "sales" ? "Qualification Agent"
                  : "Receptionist Agent";

  // Only create if one doesn't exist
  const { data: existingAgents } = await supabase
    .from("agents")
    .select("id")
    .eq("tenant_id", tenantId);

  if (!existingAgents || existingAgents.length === 0) {
    await supabase.from("agents").insert({
      tenant_id: tenantId,
      name: agentName,
      type: payload.workflow,
      status: "draft",

      opening_time: payload.openingTime,
      closing_time: payload.closingTime,

      greeting: payload.greeting,
    });
  }

  return { tenantId, success: true };
}
