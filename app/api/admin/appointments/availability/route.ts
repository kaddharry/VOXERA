import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../lib/db/server";
import { getTenantIdForUser } from "../../../../../lib/db/agents";
import { getProviderForTenant } from "../../../../../lib/db/providers";
import { listAppointmentsForRange } from "../../../../../lib/db/appointments";
import { computeDaySlots } from "../../../../../lib/calendar/availability";

export const dynamic = "force-dynamic";

/** GET /api/admin/appointments/availability?providerId=&date=YYYY-MM-DD&timezone=
 * Staff-side slot grid for one provider/day — the same computation the
 * check_appointment_availability agent tool uses (lib/agent/tools.ts), so
 * a hospital admin and the voice agent always see the same open slots. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getTenantIdForUser(supabase, user.id);
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });

  const providerId = request.nextUrl.searchParams.get("providerId");
  const dateKey = request.nextUrl.searchParams.get("date");
  const timezone = request.nextUrl.searchParams.get("timezone") || "UTC";
  if (!providerId || !dateKey) {
    return NextResponse.json({ error: "providerId and date (YYYY-MM-DD) query params are required" }, { status: 400 });
  }

  const provider = await getProviderForTenant(supabase, providerId, tenantId);
  if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });

  // Pad the lookup range by a day on each side so a slot near midnight in
  // `timezone` still sees appointments that land on the adjacent UTC date.
  const dayStart = new Date(`${dateKey}T00:00:00Z`);
  const from = new Date(dayStart.getTime() - 24 * 3600_000).toISOString();
  const to = new Date(dayStart.getTime() + 48 * 3600_000).toISOString();
  const existing = await listAppointmentsForRange(supabase, user.id, { from, to, providerId });

  const slots = computeDaySlots({
    dateKey,
    timezone,
    slotMinutes: provider.default_slot_minutes,
    workingHours: provider.working_hours as any,
    existingRanges: existing
      .filter((a) => a.status !== "cancelled" && a.status !== "no_show")
      .map((a) => ({ startsAt: a.starts_at, endsAt: a.ends_at })),
  });

  return NextResponse.json({ slots });
}
