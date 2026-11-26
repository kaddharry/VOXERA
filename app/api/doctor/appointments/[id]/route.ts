import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDoctorScope } from "../../../../../lib/auth/doctor-scope";
import { getMyAppointment } from "../../../../../lib/db/doctor";
import { completeAppointment, confirmAppointment, markNoShow } from "../../../../../lib/db/appointments";
import { cancelAppointmentFully } from "../../../../../lib/db/appointment-cancel";
import { getProviderById } from "../../../../../lib/db/providers";

export const dynamic = "force-dynamic";

const Schema = z.union([
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(3).max(500), notifyPatient: z.boolean().default(true) }),
  z.object({ action: z.enum(["confirm", "complete", "no_show"]) }),
]);

/**
 * PATCH /api/doctor/appointments/[id]
 *   { action: "cancel", reason, notifyPatient } — the doctor drops a visit that isn't important compared with others.
 *   { action: "confirm" | "complete" | "no_show" } — normal status changes.
 * Only appointments on the doctor's OWN calendar; anything else is a 404.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireDoctorScope();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const { access, scope } = guard;

  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give a short reason for cancelling (at least 3 characters).", issues: parsed.error.issues }, { status: 400 });

  const appt = await getMyAppointment(access.db, scope, id);
  if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  if (["cancelled", "completed", "no_show"].includes(appt.status)) return NextResponse.json({ error: `This appointment is already ${appt.status}.` }, { status: 409 });

  if (parsed.data.action === "cancel") {
    const provider = await getProviderById(access.db, scope.providerId);
    const result = await cancelAppointmentFully(access.db, {
      appointmentId: id,
      clientId: scope.clientId,
      reason: parsed.data.reason,
      actor: { userId: access.userId, role: "doctor" },
      notifyPatient: parsed.data.notifyPatient,
      doctorName: provider?.name ?? null,
    });
    if (!result) return NextResponse.json({ error: "Could not cancel the appointment" }, { status: 500 });
    return NextResponse.json({ appointment: result.appointment, patientNotified: result.notified });
  }

  const updated =
    parsed.data.action === "confirm"
      ? await confirmAppointment(access.db, id, scope.clientId)
      : parsed.data.action === "complete"
        ? await completeAppointment(access.db, id, scope.clientId)
        : await markNoShow(access.db, id, scope.clientId);
  if (!updated) return NextResponse.json({ error: "Could not update the appointment" }, { status: 500 });
  return NextResponse.json({ appointment: updated });
}
