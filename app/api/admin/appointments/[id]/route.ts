import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccess } from "../../../../../lib/auth/access";
import type { Permission } from "../../../../../lib/auth/permissions";
import {
  AppointmentConflictError,
  cancelAppointment,
  setCancelledBy,
  checkInAppointment,
  completeAppointment,
  confirmAppointment,
  getAppointmentById,
  markNoShow,
  rescheduleAppointment,
  updateAppointmentNotes,
} from "../../../../../lib/db/appointments";
import { cancelAppointmentReminders, scheduleAppointmentReminders, triggerWaitlistBackfill } from "../../../../../lib/scheduler/appointment-reminders";

export const dynamic = "force-dynamic";

const UpdateAppointmentSchema = z.object({
  startsAt: z.string().datetime({ offset: true }).optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  status: z.enum(["scheduled", "confirmed", "checked_in", "completed", "no_show", "cancelled"]).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

async function resolveClient(permission: Permission) {
  const guard = await requireAccess(permission);
  if (!guard.ok) return { supabase: null as never, clientId: null as string | null, unauthorized: true as const, denied: guard.response, actor: { userId: null as string | null, role: "staff" } };
  return { supabase: guard.access.db, clientId: guard.access.clientId, unauthorized: false as const, denied: null, actor: { userId: guard.access.userId as string | null, role: guard.access.role as string } };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, clientId, unauthorized, denied } = await resolveClient("appointments.read");
  if (unauthorized || !clientId) return denied!;

  const appointment = await getAppointmentById(supabase, id, clientId);
  if (!appointment) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  return NextResponse.json({ appointment });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, clientId, unauthorized, denied, actor } = await resolveClient("appointments.write");
  if (unauthorized || !clientId) return denied!;

  const body = await request.json().catch(() => null);
  const parsed = UpdateAppointmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }
  const { startsAt, durationMinutes, status, notes } = parsed.data;

  try {
    let appointment = null;

    if (startsAt) {
      if (!durationMinutes) {
        return NextResponse.json({ error: "durationMinutes is required when rescheduling (changing startsAt)" }, { status: 400 });
      }
      const previous = await getAppointmentById(supabase, id, clientId);
      const newStartsAt = new Date(startsAt);
      const newEndsAt = new Date(newStartsAt.getTime() + durationMinutes * 60_000);
      appointment = await rescheduleAppointment(supabase, id, clientId, newStartsAt.toISOString(), newEndsAt.toISOString());
      if (appointment) {
        if (previous) await cancelAppointmentReminders(supabase, previous);
        await scheduleAppointmentReminders(supabase, appointment, appointment.tenant_id).catch((err) =>
          console.error("[api/admin/appointments/[id]] scheduleAppointmentReminders failed:", err),
        );
      }
    }

    if (notes !== undefined) {
      appointment = await updateAppointmentNotes(supabase, id, clientId, notes);
    }

    if (status) {
      switch (status) {
        case "confirmed":
          appointment = await confirmAppointment(supabase, id, clientId);
          break;
        case "checked_in":
          appointment = await checkInAppointment(supabase, id, clientId);
          break;
        case "completed":
          appointment = await completeAppointment(supabase, id, clientId);
          break;
        case "no_show":
          appointment = await markNoShow(supabase, id, clientId);
          break;
        case "cancelled":
          appointment = await cancelAppointment(supabase, id, clientId);
          if (appointment) {
            await setCancelledBy(supabase, id, actor.userId, actor.role);
            await cancelAppointmentReminders(supabase, appointment);
            await triggerWaitlistBackfill(supabase, {
              tenantId: appointment.tenant_id,
              clientId: appointment.client_id,
              providerId: appointment.provider_id,
            }).catch((err) => console.error("[api/admin/appointments/[id]] triggerWaitlistBackfill failed:", err));
          }
          break;
        case "scheduled":
          // No direct transition back to "scheduled" outside of a reschedule
          // (which already sets it); nothing to do here.
          break;
      }
    }

    if (!appointment) return NextResponse.json({ error: "Appointment not found or update failed" }, { status: 404 });
    return NextResponse.json({ appointment });
  } catch (err) {
    if (err instanceof AppointmentConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[api/admin/appointments/[id]] PATCH failed:", err);
    return NextResponse.json({ error: "Failed to update appointment" }, { status: 500 });
  }
}

const CancelSchema = z.object({ reason: z.string().max(500).optional() });

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, clientId, unauthorized, denied, actor } = await resolveClient("appointments.cancel");
  if (unauthorized || !clientId) return denied!;

  const body = await request.json().catch(() => ({}));
  const parsed = CancelSchema.safeParse(body);
  const reason = parsed.success ? parsed.data.reason : undefined;

  const appointment = await cancelAppointment(supabase, id, clientId, reason);
  if (!appointment) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  await setCancelledBy(supabase, id, actor.userId, actor.role);
  await cancelAppointmentReminders(supabase, appointment);
  await triggerWaitlistBackfill(supabase, {
    tenantId: appointment.tenant_id,
    clientId: appointment.client_id,
    providerId: appointment.provider_id,
  }).catch((err) => console.error("[api/admin/appointments/[id]] triggerWaitlistBackfill failed:", err));
  return NextResponse.json({ success: true, appointment });
}
