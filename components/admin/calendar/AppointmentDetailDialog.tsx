"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Loader2, LogIn, Phone, UserX, XCircle } from "lucide-react";
import { Dialog } from "../Dialog";
import { SingleDateTimePicker, singleDateTimeToRange, toDateKey, type SingleDateTimeValue } from "./SingleDateTimePicker";
import type { Appointment, PatientLite, Provider } from "./types";
import { STATUS_META, VISIT_TYPE_META } from "./types";

function toPickerValue(appointment: Appointment): SingleDateTimeValue {
  const start = new Date(appointment.starts_at);
  const end = new Date(appointment.ends_at);
  const hour24 = start.getHours();
  return {
    dateKey: toDateKey(start),
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute: start.getMinutes(),
    meridiem: hour24 >= 12 ? "PM" : "AM",
    durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
  };
}

export function AppointmentDetailDialog({
  open,
  onClose,
  appointment,
  patient,
  provider,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  appointment: Appointment | null;
  patient?: PatientLite;
  provider?: Provider;
  onUpdated: (appointment: Appointment) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [draftTime, setDraftTime] = useState<SingleDateTimeValue | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // This dialog instance is reused across different appointments (the
  // parent always renders it, just swapping `appointment`) — reset any
  // in-progress reschedule/cancel UI left over from a previously-viewed
  // appointment instead of carrying it into the next one.
  useEffect(() => {
    setRescheduling(false);
    setCancelling(false);
    setCancelReason("");
    setError(null);
  }, [appointment?.id]);

  if (!appointment) return null;
  const status = STATUS_META[appointment.status];
  const visit = VISIT_TYPE_META[appointment.visit_type];
  const isFinal = appointment.status === "cancelled" || appointment.status === "completed" || appointment.status === "no_show";

  const patch = async (body: Record<string, unknown>, action: string) => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      onUpdated(data.appointment);
      if (action === "reschedule") setRescheduling(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    setBusy("cancel");
    setError(null);
    try {
      const res = await fetch(`/api/admin/appointments/${appointment.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Cancel failed");
      onUpdated(data.appointment);
      setCancelling(false);
      setCancelReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const ActionButton = ({ action, icon: Icon, label, className }: { action: string; icon: typeof CheckCircle2; label: string; className: string }) => (
    <button
      onClick={() => patch({ status: action }, action)}
      disabled={!!busy}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-all disabled:opacity-40 ${className}`}
    >
      {busy === action ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
      {label}
    </button>
  );

  return (
    <Dialog open={open} onClose={onClose} title={patient?.name ?? "Appointment"} subtitle={`${visit.label} with ${provider?.name ?? "—"}`} size="md">
      <div className="flex flex-col gap-4">
        {error && <p className="text-[12.5px] text-[var(--risk-critical)]">{error}</p>}

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-black" style={{ backgroundColor: status.color }}>
            {status.label}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ color: visit.color, backgroundColor: `color-mix(in oklab, ${visit.color} 24%, transparent)` }}>
            {visit.label}
          </span>
          {appointment.booked_via === "ai_call" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] text-[var(--color-text-muted)]">
              Booked by AI agent
            </span>
          )}
        </div>

        {!rescheduling ? (
          <div className="flex items-center gap-2 text-[13.5px] text-[var(--color-text-primary)]">
            <CalendarClock className="w-4 h-4 text-[var(--color-text-muted)]" />
            {new Date(appointment.starts_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            {" · "}
            {new Date(appointment.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} –{" "}
            {new Date(appointment.ends_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            {!isFinal && (
              <button
                onClick={() => {
                  setDraftTime(toPickerValue(appointment));
                  setRescheduling(true);
                }}
                className="text-[12px] font-semibold text-[var(--color-accent-violet)] hover:underline ml-2"
              >
                Reschedule
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {draftTime && <SingleDateTimePicker value={draftTime} onChange={setDraftTime} />}
            <div className="flex gap-2">
              <button
                onClick={() => setRescheduling(false)}
                className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!draftTime) return;
                  const { startsAt, endsAt } = singleDateTimeToRange(draftTime);
                  patch(
                    { startsAt: startsAt.toISOString(), durationMinutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000) },
                    "reschedule",
                  );
                }}
                disabled={busy === "reschedule"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg btn-gradient text-[12.5px] font-semibold text-white transition-all disabled:opacity-50"
              >
                {busy === "reschedule" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save new time
              </button>
            </div>
          </div>
        )}

        {patient && (
          <div className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2.5">
            <span className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
              <Phone className="w-3.5 h-3.5 text-[var(--color-text-muted)]" /> {patient.phone}
            </span>
            <Link href={`/admin/patients/${patient.id}`} className="text-[12.5px] font-semibold text-[var(--color-accent-violet)] hover:underline">
              View patient
            </Link>
          </div>
        )}

        {appointment.notes && <p className="text-[13px] text-[var(--color-text-secondary)] whitespace-pre-wrap">{appointment.notes}</p>}

        {!isFinal && !rescheduling && !cancelling && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
            {appointment.status === "scheduled" && (
              <ActionButton action="confirmed" icon={CheckCircle2} label="Confirm" className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25" />
            )}
            {(appointment.status === "scheduled" || appointment.status === "confirmed") && (
              <ActionButton action="checked_in" icon={LogIn} label="Check in" className="bg-[var(--color-accent-cyan)]/15 border border-[var(--color-accent-cyan)]/30 text-[var(--color-accent-cyan)] hover:bg-[var(--color-accent-cyan)]/25" />
            )}
            {appointment.status === "checked_in" && (
              <ActionButton action="completed" icon={CheckCircle2} label="Complete" className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:border-[var(--color-border-active)]" />
            )}
            <ActionButton action="no_show" icon={UserX} label="No-show" className="bg-[var(--risk-high)]/15 border border-[var(--risk-high)]/30 text-[var(--risk-high)] hover:bg-[var(--risk-high)]/25" />
            <button
              onClick={() => setCancelling(true)}
              disabled={!!busy}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold bg-[var(--risk-critical)]/15 border border-[var(--risk-critical)]/30 text-[var(--risk-critical)] hover:bg-[var(--risk-critical)]/25 transition-all disabled:opacity-40"
            >
              <XCircle className="w-3.5 h-3.5" />
              Cancel
            </button>
          </div>
        )}

        {cancelling && (
          <div className="flex flex-col gap-3 pt-2 border-t border-[var(--color-border-subtle)]">
            <div>
              <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
                Reason for cancelling (optional)
              </label>
              <input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                autoFocus
                className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setCancelling(false);
                  setCancelReason("");
                }}
                className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Keep appointment
              </button>
              <button
                onClick={handleCancel}
                disabled={busy === "cancel"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold bg-[var(--risk-critical)]/15 border border-[var(--risk-critical)]/30 text-[var(--risk-critical)] hover:bg-[var(--risk-critical)]/25 transition-all disabled:opacity-40"
              >
                {busy === "cancel" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                Confirm cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
