"use client";

import { TimeGrid, type TimeGridColumn, type TimeGridEvent } from "./TimeGrid";
import { AppointmentCard } from "./AppointmentCard";
import type { Appointment, PatientLite, Provider } from "./types";

interface DayEvent extends TimeGridEvent {
  appointment: Appointment;
}

/** Columns = the selected providers, all pinned to the single `cursorDate`
 * — the classic "hospital admin sees every doctor's day side by side"
 * view. A single-provider selection collapses this to one column, which
 * doubles as "that doctor's own agenda for today." */
export function DayGrid({
  cursorDate,
  appointments,
  providers,
  patientsById,
  onAppointmentClick,
  onSlotClick,
}: {
  cursorDate: Date;
  appointments: Appointment[];
  providers: Provider[];
  patientsById: Record<string, PatientLite>;
  onAppointmentClick: (appointment: Appointment) => void;
  onSlotClick: (providerId: string, at: Date) => void;
}) {
  const dayStart = new Date(cursorDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const columns: TimeGridColumn[] = providers.map((p) => ({
    key: p.id,
    date: cursorDate,
    title: p.name,
    subtitle: p.specialty ?? undefined,
    accentColor: p.color,
  }));

  const events: DayEvent[] = appointments
    .filter((a) => {
      const start = new Date(a.starts_at);
      return start >= dayStart && start < dayEnd;
    })
    .map((a) => ({ id: a.id, columnKey: a.provider_id, start: new Date(a.starts_at), end: new Date(a.ends_at), appointment: a }));

  return (
    <TimeGrid
      columns={columns}
      events={events}
      onSlotClick={(columnKey, at) => onSlotClick(columnKey, at)}
      emptyMessage="No providers selected — pick a doctor above to see their schedule."
      renderEvent={(ev) => (
        <AppointmentCard appointment={ev.appointment} patient={patientsById[ev.appointment.patient_id]} onClick={() => onAppointmentClick(ev.appointment)} />
      )}
    />
  );
}
