"use client";

import type { Appointment, PatientLite, Provider } from "./types";
import { STATUS_META, VISIT_TYPE_META } from "./types";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** The colored, clickable block rendered inside TimeGrid's time-axis cells.
 * Two distinct visual channels, deliberately not conflated: fill color =
 * visit type, left border + status dot = urgency/status — so a glance at
 * the grid reads both "what kind of visit" and "is this actually on
 * track" at once. */
export function AppointmentCard({
  appointment,
  patient,
  provider,
  showProvider,
  onClick,
}: {
  appointment: Appointment;
  patient?: PatientLite;
  provider?: Provider;
  /** Week view aggregates multiple providers into one day column — show a
   * small provider initial so cards stay attributable without a column. */
  showProvider?: boolean;
  onClick: () => void;
}) {
  const visit = VISIT_TYPE_META[appointment.visit_type];
  const status = STATUS_META[appointment.status];
  const dimmed = appointment.status === "cancelled" || appointment.status === "no_show";

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full w-full flex-col overflow-hidden rounded-[5px] border-l-4 px-1.5 py-1 text-left shadow-sm transition-transform hover:scale-[1.02] hover:z-20"
      style={{
        backgroundColor: `color-mix(in oklab, ${visit.color} ${dimmed ? 14 : 30}%, var(--color-bg-elevated))`,
        borderLeftColor: status.color,
        opacity: dimmed ? 0.6 : 1,
      }}
      title={`${patient?.name ?? "Patient"} — ${visit.label} — ${status.label}`}
    >
      <div className="flex items-center gap-1 min-w-0">
        {showProvider && provider && (
          <span
            className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full text-[8px] font-bold text-black"
            style={{ backgroundColor: provider.color }}
          >
            {provider.name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="truncate text-[11.5px] font-semibold text-[var(--color-text-primary)]">{patient?.name ?? "Patient"}</span>
        {appointment.status === "cancelled" && <span className="flex-none text-[9px] text-[var(--color-text-muted)] line-through">cancelled</span>}
      </div>
      <span className="truncate font-mono text-[10px] text-[var(--color-text-secondary)]">
        {formatTime(appointment.starts_at)} · {visit.label}
      </span>
    </button>
  );
}
