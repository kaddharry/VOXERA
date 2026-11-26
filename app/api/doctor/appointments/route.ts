import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDoctorScope } from "../../../../lib/auth/doctor-scope";
import { isMyPatient, listMyAppointments } from "../../../../lib/db/doctor";
import { AppointmentConflictError, bookAppointment, setAppointmentSeverity } from "../../../../lib/db/appointments";
import { scheduleAppointmentReminders } from "../../../../lib/scheduler/appointment-reminders";
import { priorityScoreFor, SEVERITIES } from "../../../../lib/agent/triage";

export const dynamic = "force-dynamic";

/** GET /api/doctor/appointments?from=&to= — this doctor's calendar, with a priority flag on visits they could cancel. */
export async function GET(request: NextRequest) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const now = new Date();
  const from = request.nextUrl.searchParams.get("from") ?? new Date(now.getTime() - 86_400_000).toISOString();
  const to = request.nextUrl.searchParams.get("to") ?? new Date(now.getTime() + 30 * 86_400_000).toISOString();
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return NextResponse.json({ error: "from/to must be ISO dates" }, { status: 400 });
  const appointments = await listMyAppointments(guard.access.db, guard.scope, { from, to });
  return NextResponse.json({ appointments });
}

const CreateSchema = z.object({
  patientId: z.string().min(1),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(5).max(240).default(30),
  visitType: z.enum(["consultation", "follow_up", "procedure", "telehealth", "other"]).default("follow_up"),
  severity: z.enum(SEVERITIES as unknown as [string, ...string[]]).default("moderate"),
  notes: z.string().max(1000).nullable().optional(),
});

/** POST — a doctor books a visit on their OWN calendar for one of their patients (e.g. after accepting a referral). */
export async function POST(request: NextRequest) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { access, scope } = guard;
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  const body = parsed.data;
  if (!(await isMyPatient(access.db, scope, body.patientId))) return NextResponse.json({ error: "Patient not found" }, { status: 404 });

  const startsAt = new Date(body.startsAt);
  if (startsAt.getTime() < Date.now() - 5 * 60_000) return NextResponse.json({ error: "Pick a time in the future." }, { status: 400 });
  const endsAt = new Date(startsAt.getTime() + body.durationMinutes * 60_000);

  try {
    const appointment = await bookAppointment(access.db, {
      tenantId: scope.tenantId,
      clientId: scope.clientId,
      providerId: scope.providerId,
      patientId: body.patientId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      visitType: body.visitType,
      notes: body.notes ?? null,
      bookedVia: "staff",
      createdByUserId: access.userId,
    });
    const severity = body.severity as (typeof SEVERITIES)[number];
    await setAppointmentSeverity(access.db, appointment.id, { severity, reason: "Booked by the doctor", priorityScore: priorityScoreFor(severity, "low", null) });
    await scheduleAppointmentReminders(access.db, appointment, scope.tenantId).catch((err) => console.error("[api/doctor/appointments] reminders:", err));
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (err) {
    if (err instanceof AppointmentConflictError) return NextResponse.json({ error: "You already have an appointment in that window." }, { status: 409 });
    console.error("[api/doctor/appointments] POST failed:", err);
    return NextResponse.json({ error: "Failed to book the appointment" }, { status: 500 });
  }
}
