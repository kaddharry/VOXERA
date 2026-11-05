"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, User } from "lucide-react";
import { Dialog } from "../Dialog";
import { SingleDateTimePicker, defaultSingleDateTimeValue, singleDateTimeToRange, toDateKey, type SingleDateTimeValue } from "./SingleDateTimePicker";
import type { Appointment, AppointmentVisitType, PatientLite, Provider } from "./types";
import { VISIT_TYPE_META } from "./types";

type EventKind = "event" | "task" | "appointment";

const VISIT_TYPES = Object.keys(VISIT_TYPE_META) as AppointmentVisitType[];

/** Reproduces the reference dashboard's tabbed "Create event" modal — Event
 * and Task tabs are shown (so the UI matches that reference) but disabled:
 * Voxera's calendar is appointment-only in this build, and showing a tab
 * that silently does nothing would be worse than not having it. */
export function CreateAppointmentDialog({
  open,
  onClose,
  providers,
  patients,
  initialProviderId,
  initialAt,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  providers: Provider[];
  patients: PatientLite[];
  initialProviderId?: string | null;
  initialAt?: Date | null;
  onCreated: (appointment: Appointment) => void;
}) {
  const [kind] = useState<EventKind>("appointment");
  const [providerId, setProviderId] = useState<string>("");
  const [patientQuery, setPatientQuery] = useState("");
  const [patientId, setPatientId] = useState<string>("");
  const [visitType, setVisitType] = useState<AppointmentVisitType>("consultation");
  const [notes, setNotes] = useState("");
  const [dateTime, setDateTime] = useState<SingleDateTimeValue>(defaultSingleDateTimeValue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const fallbackProvider = initialProviderId ?? providers[0]?.id ?? "";
    setProviderId(fallbackProvider);
    const provider = providers.find((p) => p.id === fallbackProvider);
    setDateTime(
      initialAt
        ? { ...defaultSingleDateTimeValue(provider?.default_slot_minutes ?? 30), ...fromDate(initialAt), durationMinutes: provider?.default_slot_minutes ?? 30 }
        : defaultSingleDateTimeValue(provider?.default_slot_minutes ?? 30),
    );
    setPatientId("");
    setPatientQuery("");
    setVisitType("consultation");
    setNotes("");
    setError(null);
  }, [open, initialProviderId, initialAt, providers]);

  const filteredPatients = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    if (!q) return patients.slice(0, 8);
    return patients.filter((p) => p.name.toLowerCase().includes(q) || p.phone.includes(q)).slice(0, 8);
  }, [patients, patientQuery]);

  const selectedPatient = patients.find((p) => p.id === patientId);

  const handleSave = async () => {
    if (!providerId) {
      setError("Pick a doctor.");
      return;
    }
    if (!patientId) {
      setError("Pick a patient.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { startsAt } = singleDateTimeToRange(dateTime);
      const res = await fetch("/api/admin/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          patientId,
          startsAt: startsAt.toISOString(),
          durationMinutes: dateTime.durationMinutes,
          visitType,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to book appointment");
      onCreated(data.appointment);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create event"
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg btn-gradient text-[13px] font-semibold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Book appointment
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex gap-1.5 p-1 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)]">
          {(["event", "task", "appointment"] as EventKind[]).map((k) => (
            <button
              key={k}
              type="button"
              disabled={k !== "appointment"}
              title={k !== "appointment" ? "Not available yet" : undefined}
              className={`flex-1 px-3 py-1.5 rounded-md text-[13px] font-semibold capitalize transition-colors ${
                k === kind ? "bg-[var(--color-accent-violet)] text-white" : "text-[var(--color-text-muted)] disabled:opacity-40"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        {error && <p className="text-[12.5px] text-[var(--risk-critical)]">{error}</p>}

        <div>
          <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Time &amp; Date</label>
          <SingleDateTimePicker value={dateTime} onChange={setDateTime} />
        </div>

        <div>
          <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Patient</label>
          {selectedPatient ? (
            <div className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2">
              <span className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
                <User className="w-3.5 h-3.5 text-[var(--color-text-muted)]" /> {selectedPatient.name} · {selectedPatient.phone}
              </span>
              <button onClick={() => setPatientId("")} className="text-[12px] text-[var(--color-accent-violet)] font-semibold hover:underline">
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              <input
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
                placeholder="Search patients by name or phone…"
                className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg pl-9 pr-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
              />
              {filteredPatients.length > 0 && (
                <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                  {filteredPatients.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPatientId(p.id)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
                    >
                      <span>{p.name}</span>
                      <span className="text-[11.5px] text-[var(--color-text-muted)]">{p.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Location (doctor &amp; visit type)</label>
          <div className="grid grid-cols-2 gap-3">
            <select
              value={providerId}
              onChange={(e) => {
                const p = providers.find((pr) => pr.id === e.target.value);
                setProviderId(e.target.value);
                if (p) setDateTime((v) => ({ ...v, durationMinutes: p.default_slot_minutes }));
              }}
              className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
            >
              {providers.length === 0 && <option value="">No doctors yet</option>}
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.specialty ? ` · ${p.specialty}` : ""}
                </option>
              ))}
            </select>
            <select
              value={visitType}
              onChange={(e) => setVisitType(e.target.value as AppointmentVisitType)}
              className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
            >
              {VISIT_TYPES.map((v) => (
                <option key={v} value={v}>
                  {VISIT_TYPE_META[v].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50 resize-none"
          />
        </div>
      </div>
    </Dialog>
  );
}

function fromDate(d: Date): { dateKey: string; hour12: number; minute: number; meridiem: "AM" | "PM" } {
  const hour24 = d.getHours();
  return {
    dateKey: toDateKey(d),
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute: d.getMinutes(),
    meridiem: hour24 >= 12 ? "PM" : "AM",
  };
}
