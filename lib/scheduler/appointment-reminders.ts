import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelFollowUpTasksByIds, createFollowUpTask, getFollowUpTaskRoutingInfo } from "../db/follow-up-tasks";
import { getPatientById } from "../db/patients";
import { cancelAppointment, confirmAppointment, type AppointmentRecord } from "../db/appointments";
import { getWaitlistEntryById, listWaitlistEntries, setWaitlistEntryStatus } from "../db/waitlist";

/**
 * Reminder-call scheduling and waitlist backfill for the appointment
 * calendar (migration_v31.sql) — built entirely on top of the existing
 * follow_up_tasks dispatch loop (lib/scheduler/dispatcher.ts), not a
 * parallel scheduler. See that migration's header comment for why.
 */

const REMINDER_OFFSETS_HOURS = { reminder_72h_task_id: 72, reminder_24h_task_id: 24, reminder_2h_task_id: 2 } as const;

async function resolveTenantTimezone(db: SupabaseClient, tenantId: string): Promise<string> {
  const { data } = await db.from("tenants").select("timezone").eq("id", tenantId).maybeSingle();
  return data?.timezone || "UTC";
}

/** Creates up to three reminder calls (72h/24h/2h before the visit) for a
 * freshly-booked appointment, and stores their task ids back onto the
 * appointment row so cancel/reschedule can find and cancel them directly.
 * An offset that would already be in the past (e.g. booking same-day) is
 * simply skipped — never backfilled as an immediate call, which would
 * otherwise fire 2-3 reminder calls back-to-back the moment a near-term
 * appointment is booked. */
export async function scheduleAppointmentReminders(db: SupabaseClient, appointment: AppointmentRecord, tenantId: string): Promise<void> {
  const [timezone, patient] = await Promise.all([resolveTenantTimezone(db, tenantId), getPatientById(db, appointment.patient_id)]);
  if (patient?.doNotContact) return;

  const startsAtMs = new Date(appointment.starts_at).getTime();
  const taskIdColumns: Partial<Record<keyof typeof REMINDER_OFFSETS_HOURS, string>> = {};

  for (const [column, hoursBefore] of Object.entries(REMINDER_OFFSETS_HOURS) as [keyof typeof REMINDER_OFFSETS_HOURS, number][]) {
    const scheduledAt = startsAtMs - hoursBefore * 3_600_000;
    if (scheduledAt <= Date.now()) continue;
    const task = await createFollowUpTask(db, appointment.client_id, {
      patientId: appointment.patient_id,
      agentId: patient?.assignedAgentId ?? null,
      scheduledAt,
      timezone,
      kind: "appointment_reminder",
      appointmentId: appointment.id,
      maxAttempts: 2,
    });
    if (task) taskIdColumns[column] = task.id;
  }

  if (Object.keys(taskIdColumns).length > 0) {
    await db.from("appointments").update(taskIdColumns).eq("id", appointment.id);
  }
}

/** Cancels an appointment's still-pending reminder calls — called whenever
 * the appointment itself is cancelled or rescheduled (a reschedule follows
 * this with a fresh scheduleAppointmentReminders call off the new time). */
export async function cancelAppointmentReminders(db: SupabaseClient, appointment: AppointmentRecord): Promise<void> {
  const ids = [appointment.reminder_72h_task_id, appointment.reminder_24h_task_id, appointment.reminder_2h_task_id].filter(
    (id): id is string => !!id,
  );
  if (ids.length === 0) return;
  await cancelFollowUpTasksByIds(db, ids, appointment.client_id, "appointment_changed");
}

/** Offers a cancelled/opened slot to the next open waitlist entry for that
 * provider by placing a single outbound call "right now" (the dispatcher
 * picks it up on its next ~30s poll) — the call itself uses the same
 * check_appointment_availability/book_appointment agent tools as any other
 * booking, so if the patient accepts, applyAppointmentCallOutcome below
 * marks the waitlist entry booked; if not, it tries the next candidate. */
export async function triggerWaitlistBackfill(
  db: SupabaseClient,
  args: { tenantId: string; clientId: string; providerId: string; excludeEntryIds?: string[] },
): Promise<void> {
  const entries = await listWaitlistEntries(db, args.clientId, { providerId: args.providerId, status: "open" });
  const exclude = new Set(args.excludeEntryIds ?? []);
  const next = entries.find((e) => !exclude.has(e.id));
  if (!next) return;

  const patient = await getPatientById(db, next.patient_id);
  if (patient?.doNotContact) {
    await setWaitlistEntryStatus(db, next.id, "expired");
    return triggerWaitlistBackfill(db, { ...args, excludeEntryIds: [...exclude, next.id] });
  }

  const task = await createFollowUpTask(db, args.clientId, {
    patientId: next.patient_id,
    agentId: patient?.assignedAgentId ?? null,
    scheduledAt: Date.now(),
    kind: "waitlist_offer",
    waitlistId: next.id,
    maxAttempts: 2,
  });
  if (task) await setWaitlistEntryStatus(db, next.id, "offered");
}

/**
 * Routes a finished call's outcome back to the appointment/waitlist entry
 * it was placed about — called from app/api/telephony/status/route.ts
 * alongside its existing applyDoNotContactRequest handling, using the same
 * post-call summary (lib/agent/call-summary.ts's appointmentConfirmed/
 * appointmentCancelRequested fields). A no-op for an ordinary ("manual")
 * follow-up call, or if migration_v31 hasn't been run yet.
 */
export async function applyAppointmentCallOutcome(
  db: SupabaseClient,
  args: { taskId: string; sessionId: string | null; appointmentConfirmed: boolean; appointmentCancelRequested: boolean },
): Promise<void> {
  const routing = await getFollowUpTaskRoutingInfo(db, args.taskId);
  if (!routing) return;

  if (routing.kind === "appointment_reminder" && routing.appointmentId) {
    if (args.appointmentCancelRequested) {
      const cancelled = await cancelAppointment(db, routing.appointmentId, routing.clientId, "Patient asked to cancel during a reminder call.");
      if (cancelled) {
        await cancelAppointmentReminders(db, cancelled);
        await triggerWaitlistBackfill(db, { tenantId: cancelled.tenant_id, clientId: cancelled.client_id, providerId: cancelled.provider_id });
      }
    } else if (args.appointmentConfirmed) {
      await confirmAppointment(db, routing.appointmentId, routing.clientId);
    }
    return;
  }

  if (routing.kind === "waitlist_offer" && routing.waitlistId) {
    const booked = args.sessionId ? await wasAppointmentBookedThisSession(db, routing.clientId, args.sessionId) : null;
    if (booked) {
      await setWaitlistEntryStatus(db, routing.waitlistId, "booked");
      return;
    }
    await setWaitlistEntryStatus(db, routing.waitlistId, "expired");
    const entry = await getWaitlistEntryById(db, routing.waitlistId);
    if (entry?.provider_id) {
      await triggerWaitlistBackfill(db, {
        tenantId: entry.tenant_id,
        clientId: entry.client_id,
        providerId: entry.provider_id,
        excludeEntryIds: [entry.id],
      });
    }
  }
}

async function wasAppointmentBookedThisSession(db: SupabaseClient, clientId: string, sessionId: string): Promise<boolean> {
  const { data } = await db.from("appointments").select("id").eq("client_id", clientId).eq("booked_by_session_id", sessionId).limit(1);
  return (data?.length ?? 0) > 0;
}
