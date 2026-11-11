"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { ProviderFilterBar } from "../../../components/admin/calendar/ProviderFilterBar";
import { AddProviderDialog } from "../../../components/admin/calendar/AddProviderDialog";
import { WeekGrid } from "../../../components/admin/calendar/WeekGrid";
import { DayGrid } from "../../../components/admin/calendar/DayGrid";
import { StatRow } from "../../../components/admin/calendar/StatRow";
import { CreateAppointmentDialog } from "../../../components/admin/calendar/CreateAppointmentDialog";
import { AppointmentDetailDialog } from "../../../components/admin/calendar/AppointmentDetailDialog";
import type { Appointment, PatientLite, Provider } from "../../../components/admin/calendar/types";

type View = "day" | "week";

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

export default function CalendarPage() {
  const [view, setView] = useState<View>("week");
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(new Set());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [createDialog, setCreateDialog] = useState<{ open: boolean; providerId: string | null; at: Date | null }>({
    open: false,
    providerId: null,
    at: null,
  });
  const [activeAppointment, setActiveAppointment] = useState<Appointment | null>(null);

  useEffect(() => {
    fetch("/api/admin/providers")
      .then((r) => r.json())
      .then((data) => {
        const list: Provider[] = data.providers ?? [];
        setProviders(list);
        setSelectedProviderIds(new Set(list.map((p) => p.id)));
      })
      .catch(() => setProviders([]));

    fetch("/api/admin/patients")
      .then((r) => r.json())
      .then((data) => setPatients((data.patients ?? []).map((p: any) => ({ id: p.id, name: p.name, phone: p.phone, riskLevel: p.riskLevel }))))
      .catch(() => setPatients([]));
  }, []);

  const range = useMemo(() => {
    if (view === "day") {
      const from = new Date(cursorDate);
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      return { from, to };
    }
    const from = startOfWeek(cursorDate);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    return { from, to };
  }, [view, cursorDate]);

  const loadAppointments = useCallback(() => {
    setLoadingAppointments(true);
    fetch(`/api/admin/appointments?from=${range.from.toISOString()}&to=${range.to.toISOString()}`)
      .then((r) => r.json())
      .then((data) => setAppointments(data.appointments ?? []))
      .catch(() => setAppointments([]))
      .finally(() => setLoadingAppointments(false));
  }, [range]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  const patientsById = useMemo(() => Object.fromEntries(patients.map((p) => [p.id, p])), [patients]);
  const selectedProviders = useMemo(() => (providers ?? []).filter((p) => selectedProviderIds.has(p.id)), [providers, selectedProviderIds]);

  const step = (dir: 1 | -1) => {
    const next = new Date(cursorDate);
    next.setDate(next.getDate() + dir * (view === "day" ? 1 : 7));
    setCursorDate(next);
  };

  const rangeLabel = useMemo(() => {
    if (view === "day") return cursorDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const end = new Date(range.to);
    end.setDate(end.getDate() - 1);
    const sameMonth = range.from.getMonth() === end.getMonth();
    return `${range.from.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", sameMonth ? { day: "numeric", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" })}`;
  }, [view, cursorDate, range]);

  const openCreateFromSlot = (providerId: string | null, at: Date) => {
    setCreateDialog({ open: true, providerId, at });
  };

  return (
    <div className="flex h-full flex-col font-body">
      <header className="flex flex-none flex-wrap items-center justify-between gap-y-1.5 gap-x-4 border-b border-[var(--color-border-subtle)] px-6 py-1.5 md:px-10">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarDays className="h-4 w-4 flex-none text-[var(--color-accent-violet)]" />
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Appointments</span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button onClick={() => step(-1)} className="p-1 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCursorDate(new Date())}
            className="px-2 py-0.5 rounded-md text-[12px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Today
          </button>
          <button onClick={() => step(1)} className="p-1 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="ml-1.5 whitespace-nowrap font-mono text-[12.5px] font-semibold text-[var(--color-text-primary)]">{rangeLabel}</span>
          {loadingAppointments && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-text-muted)]" />}
        </div>

        <div className="flex flex-none items-center gap-2">
          <div className="flex gap-0.5 rounded-md border border-[var(--color-border-subtle)] p-0.5">
            {(["day", "week"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2.5 py-0.5 rounded text-[12px] font-semibold capitalize transition-colors ${
                  view === v ? "bg-[var(--color-accent-violet)] text-white" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCreateDialog({ open: true, providerId: selectedProviders[0]?.id ?? null, at: null })}
            className="flex flex-none items-center gap-1.5 rounded-md btn-gradient px-3 py-1 text-[12.5px] font-semibold text-white transition-all hover:scale-[1.02]"
          >
            <Plus className="w-3.5 h-3.5" /> New appointment
          </button>
        </div>
      </header>

      <StatRow appointments={appointments} />

      {providers !== null && (
        <ProviderFilterBar
          providers={providers}
          selectedIds={selectedProviderIds}
          onToggle={(id) =>
            setSelectedProviderIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onSelectAll={() => setSelectedProviderIds(new Set(providers.map((p) => p.id)))}
          onSelectOnly={(id) => setSelectedProviderIds(new Set([id]))}
          onAddProvider={() => setShowAddProvider(true)}
        />
      )}

      {providers !== null && providers.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
          <CalendarDays className="w-8 h-8 text-[var(--color-text-muted)]" />
          <p className="text-[14px] text-[var(--color-text-secondary)]">No doctors on the calendar yet.</p>
          <button onClick={() => setShowAddProvider(true)} className="flex items-center gap-1.5 rounded-lg btn-gradient px-4 py-2 text-[13px] font-semibold text-white transition-all hover:scale-[1.02]">
            <Plus className="w-3.5 h-3.5" /> Add your first doctor
          </button>
        </div>
      ) : view === "week" ? (
        <WeekGrid
          cursorDate={cursorDate}
          appointments={appointments}
          providers={selectedProviders}
          patientsById={patientsById}
          onAppointmentClick={setActiveAppointment}
          onSlotClick={openCreateFromSlot}
        />
      ) : (
        <DayGrid
          cursorDate={cursorDate}
          appointments={appointments}
          providers={selectedProviders}
          patientsById={patientsById}
          onAppointmentClick={setActiveAppointment}
          onSlotClick={openCreateFromSlot}
        />
      )}

      <AddProviderDialog
        open={showAddProvider}
        onClose={() => setShowAddProvider(false)}
        onCreated={(p) => {
          setProviders((prev) => [...(prev ?? []), p]);
          setSelectedProviderIds((prev) => new Set(prev).add(p.id));
        }}
      />

      <CreateAppointmentDialog
        open={createDialog.open}
        onClose={() => setCreateDialog({ open: false, providerId: null, at: null })}
        providers={providers ?? []}
        patients={patients}
        initialProviderId={createDialog.providerId}
        initialAt={createDialog.at}
        onCreated={() => loadAppointments()}
      />

      <AppointmentDetailDialog
        open={!!activeAppointment}
        onClose={() => setActiveAppointment(null)}
        appointment={activeAppointment}
        patient={activeAppointment ? patientsById[activeAppointment.patient_id] : undefined}
        provider={(providers ?? []).find((p) => p.id === activeAppointment?.provider_id)}
        onUpdated={(updated) => {
          setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
          setActiveAppointment(updated);
        }}
      />
    </div>
  );
}
