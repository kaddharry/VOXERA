import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../lib/db/server";
import { getTenantIdForUser } from "../../../../lib/db/agents";
import { AppointmentConflictError, bookAppointment, listAppointmentsForRange } from "../../../../lib/db/appointments";
import { scheduleAppointmentReminders } from "../../../../lib/scheduler/appointment-reminders";

export const dynamic = "force-dynamic";

const CreateAppointmentSchema = z.object({
  providerId: z.string().uuid(),
  patientId: z.string().min(1),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(5).max(480),
  visitType: z.enum(["consultation", "follow_up", "procedure", "telehealth", "other"]).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from and to query params are required (ISO 8601)" }, { status: 400 });
  const providerId = request.nextUrl.searchParams.get("providerId") ?? undefined;

  const appointments = await listAppointmentsForRange(supabase, user.id, { from, to, providerId });
  return NextResponse.json({ appointments });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getTenantIdForUser(supabase, user.id);
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = CreateAppointmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = new Date(startsAt.getTime() + parsed.data.durationMinutes * 60_000);

  try {
    const appointment = await bookAppointment(supabase, {
      tenantId,
      clientId: user.id,
      providerId: parsed.data.providerId,
      patientId: parsed.data.patientId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      visitType: parsed.data.visitType,
      notes: parsed.data.notes,
      bookedVia: "staff",
      createdByUserId: user.id,
    });
    await scheduleAppointmentReminders(supabase, appointment, tenantId).catch((err) =>
      console.error("[api/admin/appointments] scheduleAppointmentReminders failed:", err),
    );
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (err) {
    if (err instanceof AppointmentConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[api/admin/appointments] POST failed:", err);
    return NextResponse.json({ error: "Failed to book appointment" }, { status: 500 });
  }
}
