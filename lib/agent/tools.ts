import { checkAvailability, createBooking, cancelBooking, modifyBooking } from "../db/reservations";
import { logSessionEvent, makeEvent } from "../logging/session-logger";
import { supabase as supabaseService } from "../db/supabase";
import { getTenantIdForUser } from "../db/agents";
import { getPatientById } from "../db/patients";
import { getProviderById } from "../db/providers";
import {
  AppointmentConflictError,
  bookAppointment,
  cancelAppointment,
  confirmAppointment,
  getAppointmentByIdUnscoped,
  rescheduleAppointment,
} from "../db/appointments";
import { computeDaySlots } from "../calendar/availability";
import { cancelAppointmentReminders, scheduleAppointmentReminders, triggerWaitlistBackfill } from "../scheduler/appointment-reminders";

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** The original, hardcoded restaurant-demo tools — unchanged, still the
 * default for the legacy/demo call path (see getToolsForAgent below). */
export const RESERVATION_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Check if a specific date and time slot is available for booking.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          time: { type: "string", description: "Time in HH:MM format (24-hour)" },
        },
        required: ["date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description: "Create a new reservation for a customer.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM" },
          partySize: { type: "number" },
          customerEmail: { type: "string", description: "Customer email address for notifications" },
          customerName: { type: "string", description: "Customer full name" },
          customerPhone: { type: "string", description: "Customer contact phone number" },
        },
        required: ["userId", "date", "time", "partySize", "customerEmail"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modify_booking",
      description: "Modify an existing reservation date, time, party size, or contact details.",
      parameters: {
        type: "object",
        properties: {
          bookingId: { type: "string", description: "The ID of the reservation to modify (e.g. BKG-XXXXXX)" },
          newDate: { type: "string", description: "New date in YYYY-MM-DD format" },
          newTime: { type: "string", description: "New time in HH:MM format" },
          newPartySize: { type: "number", description: "New party size/guests count" },
          customerName: { type: "string", description: "Updated customer name" },
          customerEmail: { type: "string", description: "Updated customer email" },
          customerPhone: { type: "string", description: "Updated customer phone" },
        },
        required: ["bookingId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_booking",
      description: "Cancel an existing reservation by ID.",
      parameters: {
        type: "object",
        properties: {
          bookingId: { type: "string", description: "The ID of the reservation to cancel" },
        },
        required: ["bookingId"],
      },
    },
  },
];

/** Clinical appointment tools (migration_v30.sql's `appointments` table) —
 * only reachable by an agent whose `enabledTools` allowlist names them
 * (see getToolsForAgent below and migration_v29.sql's header comment for
 * why this is an allowlist, not a global on/off switch). */
export const APPOINTMENT_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "check_appointment_availability",
      description: "Check open appointment slots for a provider (doctor) on a given date.",
      parameters: {
        type: "object",
        properties: {
          providerId: { type: "string", description: "The provider's id" },
          date: { type: "string", description: "YYYY-MM-DD" },
          timezone: { type: "string", description: "IANA timezone, e.g. Asia/Kolkata. Defaults to UTC." },
        },
        required: ["providerId", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_appointment",
      description: "Book a new appointment for the caller (already-identified patient) with a provider.",
      parameters: {
        type: "object",
        properties: {
          providerId: { type: "string" },
          startsAt: { type: "string", description: "ISO 8601 datetime, e.g. 2026-03-05T14:30:00+05:30" },
          durationMinutes: { type: "number", description: "Appointment length in minutes, e.g. 30" },
          visitType: { type: "string", description: "consultation | follow_up | procedure | telehealth | other" },
          notes: { type: "string" },
        },
        required: ["providerId", "startsAt", "durationMinutes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_appointment",
      description: "Move an existing appointment to a new date/time.",
      parameters: {
        type: "object",
        properties: {
          appointmentId: { type: "string" },
          newStartsAt: { type: "string", description: "ISO 8601 datetime" },
          newDurationMinutes: { type: "number" },
        },
        required: ["appointmentId", "newStartsAt", "newDurationMinutes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_appointment",
      description: "Cancel an existing appointment.",
      parameters: {
        type: "object",
        properties: {
          appointmentId: { type: "string" },
          reason: { type: "string" },
        },
        required: ["appointmentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_appointment",
      description: "Mark an appointment as confirmed — use when the patient says they'll be there.",
      parameters: {
        type: "object",
        properties: {
          appointmentId: { type: "string" },
        },
        required: ["appointmentId"],
      },
    },
  },
];

/** The legacy demo path's unconditional tool set — unchanged behavior. */
export const TOOLS: ToolDef[] = RESERVATION_TOOLS;

/** Filters the combined tool catalog down to a specific agent's allowlist
 * (agents."enabledTools", migration_v29.sql). Returns [] for an agent with
 * no tools enabled — generateReply (lib/agent/llm.ts) treats an empty tool
 * list the same as tools being off entirely. This is the fix for the bug
 * documented at lib/agent/orchestrator.ts's `useTools` call sites: every
 * custom Agent Builder agent used to get either all of RESERVATION_TOOLS or
 * nothing, decided by a single global flag — now each agent gets exactly
 * the tools a hospital admin opted it into, nothing implied by which call
 * path it's on. */
export function getToolsForAgent(enabledTools: string[] | undefined | null): ToolDef[] {
  if (!enabledTools || enabledTools.length === 0) return [];
  const catalog = [...RESERVATION_TOOLS, ...APPOINTMENT_TOOLS];
  return catalog.filter((t) => enabledTools.includes(t.function.name));
}

export interface ToolCallContext {
  clientId: string;
  sessionId?: string;
  userId?: string;
  /** Roster patient (lib/db/patients.ts) already identified for this call —
   * set for outbound calls placed from the Patients page. When absent (a
   * real inbound call), appointment tools resolve the patient from
   * `callerNumber` instead, and refuse to act if that lookup is ambiguous. */
  patientId?: string;
  /** The caller's phone number, as captured by the telephony layer
   * (lib/telephony/stream-handler.ts). Used only to verify patient identity
   * before an appointment tool writes anything — never trusted blindly. */
  callerNumber?: string;
}

/** Resolves which patient an appointment tool is acting on, verifying
 * identity before anything gets written. Never guesses: an inbound call
 * from a number matching zero or more-than-one patient record is refused
 * rather than silently picked, since a wrong guess here means booking
 * (or worse, cancelling) a stranger's appointment. */
async function resolveVerifiedPatient(
  context: ToolCallContext,
): Promise<{ ok: true; patientId: string; doNotContact: boolean } | { ok: false; error: string }> {
  if (context.patientId) {
    const patient = await getPatientById(supabaseService, context.patientId);
    if (!patient) return { ok: false, error: "The patient on this call could not be found." };
    return { ok: true, patientId: patient.id, doNotContact: patient.doNotContact };
  }
  if (!context.callerNumber) {
    return { ok: false, error: "Could not verify the caller's identity — please have them call the front desk directly." };
  }
  const { data, error } = await supabaseService
    .from("patients")
    .select('id, "doNotContact"')
    .eq("clientId", context.clientId)
    .eq("phone", context.callerNumber);
  if (error || !data || data.length !== 1) {
    return { ok: false, error: "Could not verify the caller's identity — please have them call the front desk directly." };
  }
  return { ok: true, patientId: data[0].id, doNotContact: data[0].doNotContact };
}

export async function dispatchToolCall(name: string, args: Record<string, any>, context: ToolCallContext): Promise<string> {
  const { clientId, sessionId, userId } = context;
  try {
    let result: string;
    switch (name) {
      case "check_availability": {
        const isAvail = await checkAvailability(args.date, args.time, clientId);
        result = JSON.stringify({ available: isAvail });
        break;
      }
      
      case "create_booking": {
        const booking = await createBooking({
          userId: args.userId,
          clientId: clientId,
          date: args.date,
          time: args.time,
          partySize: args.partySize,
          customerEmail: args.customerEmail,
          customerName: args.customerName,
          customerPhone: args.customerPhone,
        });

        // Log calendar and email outcomes as session events if context is present
        if (sessionId && userId) {
          await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "calendar_sync", {
            bookingId: booking.id,
            status: "synced",
            eventId: booking.calendarEventId || "MOCK",
          }));
          await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "email_dispatch", {
            bookingId: booking.id,
            email: booking.customerEmail,
            status: "sent",
          }));
        }

        result = JSON.stringify({ success: true, booking });
        break;
      }

      case "modify_booking": {
        const booking = await modifyBooking(
          args.bookingId,
          {
            date: args.newDate,
            time: args.newTime,
            partySize: args.newPartySize,
            customerName: args.customerName,
            customerEmail: args.customerEmail,
            customerPhone: args.customerPhone,
          },
          clientId
        );

        if (sessionId && userId) {
          await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "calendar_sync", {
            bookingId: booking.id,
            status: "updated",
            eventId: booking.calendarEventId || "MOCK",
          }));
          if (booking.customerEmail) {
            await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "email_dispatch", {
              bookingId: booking.id,
              email: booking.customerEmail,
              status: "sent_update",
            }));
          }
        }

        result = JSON.stringify({ success: true, booking });
        break;
      }

      case "cancel_booking": {
        const success = await cancelBooking(args.bookingId, clientId);

        if (success && sessionId && userId) {
          await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "calendar_sync", {
            bookingId: args.bookingId,
            status: "deleted",
          }));
          await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "email_dispatch", {
            bookingId: args.bookingId,
            status: "sent_cancellation",
          }));
        }

        result = JSON.stringify({ success });
        break;
      }

      case "check_appointment_availability": {
        const provider = await getProviderById(supabaseService, args.providerId);
        if (!provider) {
          result = JSON.stringify({ error: "Unknown provider." });
          break;
        }
        const timezone = args.timezone || "UTC";
        const dayStart = new Date(`${args.date}T00:00:00Z`);
        const { data: existingRows } = await supabaseService
          .from("appointments")
          .select("starts_at, ends_at, status")
          .eq("provider_id", args.providerId)
          .lt("starts_at", new Date(dayStart.getTime() + 48 * 3600_000).toISOString())
          .gt("ends_at", new Date(dayStart.getTime() - 24 * 3600_000).toISOString());
        const slots = computeDaySlots({
          dateKey: args.date,
          timezone,
          slotMinutes: provider.default_slot_minutes,
          workingHours: provider.working_hours as any,
          existingRanges: (existingRows ?? [])
            .filter((r: any) => r.status !== "cancelled" && r.status !== "no_show")
            .map((r: any) => ({ startsAt: r.starts_at, endsAt: r.ends_at })),
        });
        result = JSON.stringify({ slots: slots.filter((s) => s.available).map((s) => ({ start: s.start, end: s.end })) });
        break;
      }

      case "book_appointment": {
        const verified = await resolveVerifiedPatient(context);
        if (!verified.ok) {
          result = JSON.stringify({ error: verified.error });
          break;
        }
        if (verified.doNotContact) {
          result = JSON.stringify({ error: "This patient has asked not to be contacted — a booking can't be made on this call." });
          break;
        }
        const tenantId = await getTenantIdForUser(supabaseService, clientId);
        if (!tenantId) {
          result = JSON.stringify({ error: "Could not resolve the hospital's account — please try again later." });
          break;
        }
        const startsAt = new Date(args.startsAt);
        const endsAt = new Date(startsAt.getTime() + Number(args.durationMinutes) * 60_000);
        try {
          const appointment = await bookAppointment(supabaseService, {
            tenantId,
            clientId,
            providerId: args.providerId,
            patientId: verified.patientId,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            visitType: args.visitType,
            notes: args.notes,
            bookedVia: "ai_call",
            bookedBySessionId: sessionId ?? null,
          });
          await scheduleAppointmentReminders(supabaseService, appointment, tenantId).catch((err) =>
            console.error("[tools] scheduleAppointmentReminders failed:", err),
          );
          result = JSON.stringify({ success: true, appointment });
        } catch (err) {
          result = JSON.stringify({ error: err instanceof AppointmentConflictError ? err.message : "Failed to book the appointment." });
        }
        break;
      }

      case "reschedule_appointment": {
        const verified = await resolveVerifiedPatient(context);
        if (!verified.ok) {
          result = JSON.stringify({ error: verified.error });
          break;
        }
        const appointment = await getAppointmentByIdUnscoped(supabaseService, args.appointmentId);
        if (!appointment || appointment.patient_id !== verified.patientId) {
          result = JSON.stringify({ error: "Could not find that appointment for this caller." });
          break;
        }
        const newStartsAt = new Date(args.newStartsAt);
        const newEndsAt = new Date(newStartsAt.getTime() + Number(args.newDurationMinutes) * 60_000);
        try {
          const updated = await rescheduleAppointment(supabaseService, args.appointmentId, clientId, newStartsAt.toISOString(), newEndsAt.toISOString());
          if (updated) {
            await cancelAppointmentReminders(supabaseService, appointment);
            await scheduleAppointmentReminders(supabaseService, updated, updated.tenant_id).catch((err) =>
              console.error("[tools] scheduleAppointmentReminders failed:", err),
            );
          }
          result = JSON.stringify({ success: true, appointment: updated });
        } catch (err) {
          result = JSON.stringify({ error: err instanceof AppointmentConflictError ? err.message : "Failed to reschedule the appointment." });
        }
        break;
      }

      case "cancel_appointment": {
        const verified = await resolveVerifiedPatient(context);
        if (!verified.ok) {
          result = JSON.stringify({ error: verified.error });
          break;
        }
        const appointment = await getAppointmentByIdUnscoped(supabaseService, args.appointmentId);
        if (!appointment || appointment.patient_id !== verified.patientId) {
          result = JSON.stringify({ error: "Could not find that appointment for this caller." });
          break;
        }
        const cancelled = await cancelAppointment(supabaseService, args.appointmentId, clientId, args.reason);
        if (cancelled) {
          await cancelAppointmentReminders(supabaseService, cancelled);
          await triggerWaitlistBackfill(supabaseService, {
            tenantId: cancelled.tenant_id,
            clientId: cancelled.client_id,
            providerId: cancelled.provider_id,
          }).catch((err) => console.error("[tools] triggerWaitlistBackfill failed:", err));
        }
        result = JSON.stringify({ success: !!cancelled, appointment: cancelled });
        break;
      }

      case "confirm_appointment": {
        const verified = await resolveVerifiedPatient(context);
        if (!verified.ok) {
          result = JSON.stringify({ error: verified.error });
          break;
        }
        const appointment = await getAppointmentByIdUnscoped(supabaseService, args.appointmentId);
        if (!appointment || appointment.patient_id !== verified.patientId) {
          result = JSON.stringify({ error: "Could not find that appointment for this caller." });
          break;
        }
        const confirmed = await confirmAppointment(supabaseService, args.appointmentId, clientId);
        result = JSON.stringify({ success: !!confirmed, appointment: confirmed });
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    if (sessionId && userId) {
      await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "tool_invocation", {
        tool: name,
        arguments: args,
        success: true,
      }));
    }

    return result;
  } catch (err: any) {
    const errMsg = err.message || "Tool execution failed";
    if (sessionId && userId) {
      await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "tool_invocation", {
        tool: name,
        arguments: args,
        success: false,
        error: errMsg,
      }));
    }
    return JSON.stringify({ error: errMsg });
  }
}
