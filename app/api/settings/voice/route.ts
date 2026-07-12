import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { cloneVoiceElevenLabs } from "../../../../lib/tts/voice-clone";

export const dynamic = "force-dynamic";

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

    const { data: settings } = await supabaseServer
      .from("business_settings")
      .select("voice_provider, custom_voice_id, voice_persona, greeting")
      .eq("tenant_id", tenant.id)
      .single();

    return NextResponse.json(settings || { voice_provider: null, custom_voice_id: null, voice_persona: "female-friendly", greeting: null });
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
    const { data: tenant } = await supabaseServer
      .from("tenants")
      .select("id")
      .eq("auth_user_id", clientId)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const action = formData.get("action") as string;

    if (action === "clear") {
      await supabaseServer
        .from("business_settings")
        .update({
          voice_provider: null,
          custom_voice_id: null,
          voice_persona: "female-friendly",
        })
        .eq("tenant_id", tenant.id);

      return NextResponse.json({ success: true });
    }

    if (action === "select-persona") {
      const persona = formData.get("persona") as string;
      await supabaseServer
        .from("business_settings")
        .update({
          voice_provider: null,
          custom_voice_id: null,
          voice_persona: persona,
        })
        .eq("tenant_id", tenant.id);

      return NextResponse.json({ success: true });
    }

    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const voiceName = `Custom Voice - ${tenant.id.substring(0, 8)}`;

    const voiceId = await cloneVoiceElevenLabs({
      name: voiceName,
      fileBuffer,
      fileName: file.name,
      mimeType: file.type,
    });

    await supabaseServer
      .from("business_settings")
      .update({
        voice_provider: "elevenlabs",
        custom_voice_id: voiceId,
        voice_persona: "custom",
      })
      .eq("tenant_id", tenant.id);

    return NextResponse.json({ success: true, voiceId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
