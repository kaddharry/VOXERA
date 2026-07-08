import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { supabase } from "../../../../lib/db/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseServer = await createClient();
  const { data: { user } } = await supabaseServer.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = user.id;

  try {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id")
      .eq("auth_user_id", clientId)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const { data: settings } = await supabase
      .from("business_settings")
      .select("sms_recovery_enabled, sms_recovery_template, sms_recovery_link, greeting")
      .eq("tenant_id", tenant.id)
      .single();

    return NextResponse.json(settings || { sms_recovery_enabled: false, sms_recovery_template: "", sms_recovery_link: "", greeting: "" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const supabaseServer = await createClient();
  const { data: { user } } = await supabaseServer.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = user.id;

  try {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id")
      .eq("auth_user_id", clientId)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const body = await request.json();
    const { enabled, template, link, greeting } = body;

    const updateData: any = {};
    if (enabled !== undefined) updateData.sms_recovery_enabled = enabled;
    if (template !== undefined) updateData.sms_recovery_template = template;
    if (link !== undefined) updateData.sms_recovery_link = link;
    if (greeting !== undefined) updateData.greeting = greeting;

    await supabase
      .from("business_settings")
      .update(updateData)
      .eq("tenant_id", tenant.id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
