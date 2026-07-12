import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { encrypt } from "../../../../lib/util/crypto";

export const dynamic = "force-dynamic";

// GET — Retrieve masked credentials
export async function GET() {
  const supabaseServer = await createClient();
  const { data: { user } } = await supabaseServer.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = user.id;

  try {
    const { data: tenant } = await supabaseServer
      .from("tenants")
      .select("id")
      .eq("auth_user_id", clientId)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const { data: creds } = await supabaseServer
      .from("tenant_credentials")
      .select("google_service_account_email, google_private_key, google_calendar_id")
      .eq("tenant_id", tenant.id)
      .single();

    return NextResponse.json({
      email: creds?.google_service_account_email || "",
      hasPrivateKey: !!creds?.google_private_key,
      privateKey: creds?.google_private_key ? "••••••••••••••••" : "",
      calendarId: creds?.google_calendar_id || "",
    });
  } catch (err: any) {
    // If table/record doesn't exist yet, return empty defaults
    return NextResponse.json({ email: "", hasPrivateKey: false, privateKey: "", calendarId: "" });
  }
}

// POST — Upsert credentials (encrypting key)
export async function POST(request: NextRequest) {
  const supabaseServer = await createClient();
  const { data: { user } } = await supabaseServer.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = user.id;

  try {
    const { data: tenant } = await supabaseServer
      .from("tenants")
      .select("id")
      .eq("auth_user_id", clientId)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const body = await request.json();
    const { email, privateKey, calendarId } = body;

    // Fetch existing credentials to check if private key changed
    let existingCreds: any = null;
    try {
      const { data } = await supabaseServer
        .from("tenant_credentials")
        .select("*")
        .eq("tenant_id", tenant.id)
        .single();
      existingCreds = data;
    } catch (_) {}

    let encryptedKey = existingCreds?.google_private_key || "";
    // Only encrypt if it's a real new private key value and not the masked placeholder
    if (privateKey && privateKey !== "••••••••••••••••") {
      encryptedKey = encrypt(privateKey);
    }

    const upsertData = {
      tenant_id: tenant.id,
      google_service_account_email: email || null,
      google_private_key: encryptedKey || null,
      google_calendar_id: calendarId || null,
      updated_at: new Date().toISOString(),
    };

    if (existingCreds) {
      const { error } = await supabaseServer
        .from("tenant_credentials")
        .update(upsertData)
        .eq("tenant_id", tenant.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseServer
        .from("tenant_credentials")
        .insert(upsertData);
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
