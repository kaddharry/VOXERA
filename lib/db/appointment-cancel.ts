import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelAppointment, setCancelledBy, type AppointmentRecord } from "./appointments";
import { getPatientById } from "./patients";
import { cancelAppointmentReminders, triggerWaitlistBackfill } from "../scheduler/appointment-reminders";
import { sendSMS } from "../telephony/sms";
import { formatSlotLabel } from "../calendar/availability";

/**
 * One cancellation path for staff, doctors and the agent: marks the visit cancelled (with who did it and why),
 * removes its pending reminder calls, offers the freed slot to the waitlist, and — if asked — texts the patient.
 */
export async function cancelAppointmentFully(
  db: SupabaseClient,
  input: {
    appointmentId: string;
    clientId: string;
    reason?: string | null;
    actor: { userId: string | null; role: string };
    notifyPatient?: boolean;
    doctorName?: string | null;
  },
): Promise<{ appointment: AppointmentRecord; notified: boolean } | null> {
  const appointment = await cancelAppointment(db, input.appointmentId, input.clientId, input.reason ?? undefined);
  if (!appointment) return null;

  await setCancelledBy(db, appointment.id, input.actor.userId, input.actor.role);
  await cancelAppointmentReminders(db, appointment).catch((err) => console.error("[appointment-cancel] reminders:", err));
  await triggerWaitlistBackfill(db, { tenantId: appointment.tenant_id, clientId: appointment.client_id, providerId: appointment.provider_id }).catch((err) =>
    console.error("[appointment-cancel] waitlist:", err),
  );

  let notified = false;
  if (input.notifyPatient) {
    const patient = await getPatientById(db, appointment.patient_id).catch(() => null);
    if (patient && patient.phone && !patient.doNotContact) {
      const who = input.doctorName ? `with ${input.doctorName} ` : "";
      // The reason stays internal (it can be clinical); the patient is told the visit was cancelled and how to rebook.
      await sendSMS({
        to: patient.phone,
        body: `Hello ${patient.name.split(" ")[0]}, your appointment ${who}on ${formatSlotLabel(appointment.starts_at)} has been cancelled by the hospital. Please call us if you would like to rebook.`,
      })
        .then(() => {
          notified = true;
        })
        .catch((err) => console.error("[appointment-cancel] sms:", err));
    }
  }
  return { appointment, notified };
}
