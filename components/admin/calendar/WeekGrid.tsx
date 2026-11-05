"use client";

import { TimeGrid, type TimeGridColumn, type TimeGridEvent } from "./TimeGrid";
import { AppointmentCard } from "./AppointmentCard";
import type { Appointment, PatientLite, Provider } from "./types";

interface WeekEvent extends TimeGridEvent {
  appointment: Appointment;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

/** Columns = the 7 days of the week containing `cursorDate` — every
 * selected provider's appointments are aggregated into each day column
 * (color-coded per provider via the card's small avatar), which is how a
 * hospital admin's cross-provider view and a single doctor's own agenda
 * end up on the same component (the caller just filters `appointments`/
 * `providers` to one provider for the latter). */
export function WeekGrid({
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
  onSlotClick: (providerId: string | null, at: Date) => void;
}) {
  const weekStart = startOfWeek(cursorDate);
  const providerById = Object.fromEntries(providers.map((p) => [p.id, p]));
  const multipleProviders = providers.length > 1;

  const columns: TimeGridColumn[] = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    const isToday = dateKey(date) === dateKey(new Date());
    return {
      key: dateKey(date),
      date,
      title: date.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }),
      subtitle: date.toLocaleDateString("en-US", { month: "short" }),
      accentColor: isToday ? "var(--color-accent-violet)" : undefined,
    };
  });

  const events: WeekEvent[] = appointments
    .filter((a) => providerById[a.provider_id])
    .map((a) => ({ id: a.id, columnKey: dateKey(new Date(a.starts_at)), start: new Date(a.starts_at), end: new Date(a.ends_at), appointment: a }));

  return (
    <TimeGrid
      columns={columns}
      events={events}
      onSlotClick={(columnKey, at) => onSlotClick(providers.length === 1 ? providers[0].id : null, at)}
      emptyMessage="No providers selected — pick a doctor above to see their schedule."
      renderEvent={(ev) => (
        <AppointmentCard
          appointment={ev.appointment}
          patient={patientsById[ev.appointment.patient_id]}
          provider={providerById[ev.appointment.provider_id]}
          showProvider={multipleProviders}
          onClick={() => onAppointmentClick(ev.appointment)}
        />
      )}
    />
  );
}
