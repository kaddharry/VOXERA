import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { getTenantIdForUser, listAgentsForTenant } from "../../../../lib/db/agents";

export const dynamic = "force-dynamic";

const PHONE_RE = /^\+?[1-9]\d{7,14}$/;

/**
 * GET /api/settings/phone-numbers
 *
 * Lists this tenant's registered phone numbers, each with the agent
 * currently assigned to handle its inbound calls (if any), plus the full
 * agent roster so the UI can populate a picker without a second request.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: numbers, error } = await supabase
    .from("phone_numbers")
    .select("id, phoneNumber, friendlyName, active, agentId, createdAt")
    .eq("clientId", user.id)
    .order("createdAt", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tenantId = await getTenantIdForUser(supabase, user.id);
  const agents = tenantId ? await listAgentsForTenant(supabase, tenantId) : [];

  return NextResponse.json({ numbers: numbers ?? [], agents });
}

/**
 * POST /api/settings/phone-numbers
 *
 * Registers a Twilio number against this tenant so /api/telephony/incoming
 * can resolve it to a clientId (and optionally a specific agent). Body:
 * { phoneNumber: string, friendlyName?: string, agentId?: string | null }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const phoneNumber = String(body.phoneNumber ?? "").trim();
  const friendlyName = body.friendlyName ? String(body.friendlyName).trim() : null;
  const agentId = body.agentId ? String(body.agentId) : null;

  if (!PHONE_RE.test(phoneNumber)) {
    return NextResponse.json({ error: "Enter a valid phone number in E.164 format, e.g. +15551234567" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("phone_numbers")
    .insert([{ clientId: user.id, phoneNumber, friendlyName, agentId, active: true }])
    .select("id, phoneNumber, friendlyName, active, agentId, createdAt")
    .single();

  if (error) {
    // Postgres unique_violation on the phoneNumber column
    const status = error.code === "23505" ? 409 : 500;
    const message = status === 409 ? "This number is already registered." : error.message;
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ number: data });
}

/**
 * PATCH /api/settings/phone-numbers
 *
 * Updates which agent handles a number's inbound calls (or toggles it
 * active/inactive). Body: { id: number, agentId?: string | null, active?: boolean }
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const id = body.id;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if ("agentId" in body) updates.agentId = body.agentId ? String(body.agentId) : null;
  if ("active" in body) updates.active = !!body.active;

  const { data, error } = await supabase
    .from("phone_numbers")
    .update(updates)
    .eq("id", id)
    .eq("clientId", user.id) // scope the update to this tenant's own rows
    .select("id, phoneNumber, friendlyName, active, agentId, createdAt")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ number: data });
}

/**
 * DELETE /api/settings/phone-numbers?id=123
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const { error } = await supabase
    .from("phone_numbers")
    .delete()
    .eq("id", id)
    .eq("clientId", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
