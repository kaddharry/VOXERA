"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Dialog } from "../../../components/admin/Dialog";
import { Card, ErrorNote, Loading, Pill, SEVERITY_TONE, btnGhost, btnPrimary, fmtDateTime, fmtDay, inputCls, send, useApi } from "../../../components/doctor/ui";

interface Appt {
  id: string;
  patient_id: string;
  patientName?: string;
  starts_at: string;
  ends_at: string;
  status: string;
  visit_type: string;
  severity: keyof typeof SEVERITY_TONE;
  severity_reason: string | null;
  priority_score: number;
  booked_via: string;
  lowPriority: boolean;
  lowPriorityNote: string | null;
}

export default function DoctorAppointmentsPage() {
  const { data, error, loading, reload } = useApi<{ appointments: Appt[] }>("/api/doctor/appointments");
  const [cancelTarget, setCancelTarget] = useState<Appt | null>(null);
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"day" | "priority">("day");

  const active = useMemo(() => (data?.appointments ?? []).filter((a) => !["cancelled", "completed", "no_show"].includes(a.status)), [data]);
  const past = useMemo(() => (data?.appointments ?? []).filter((a) => ["cancelled", "completed", "no_show"].includes(a.status)).reverse().slice(0, 10), [data]);
  const byDay = useMemo(() => {
    const m = new Map<string, Appt[]>();
    for (const a of active) m.set(a.starts_at.slice(0, 10), [...(m.get(a.starts_at.slice(0, 10)) ?? []), a]);
    return [...m.entries()];
  }, [active]);
  const byPriority = useMemo(() => [...active].sort((a, b) => a.priority_score - b.priority_score), [active]);

  function openCancel(a: Appt) {
    setCancelTarget(a);
    setReason(a.lowPriorityNote ?? "");
    setNotify(true);
    setErr(null);
  }

  async function cancel() {
    if (!cancelTarget) return;
    setBusy(true);
    setErr(null);
    const r = await send<{ patientNotified?: boolean }>(`/api/doctor/appointments/${cancelTarget.id}`, "PATCH", { action: "cancel", reason, notifyPatient: notify });
    setBusy(false);
    if (!r.ok) return setErr(r.data.error ?? "Could not cancel.");
    setNotice(`Cancelled ${cancelTarget.patientName}'s visit.${r.data.patientNotified ? " The patient was texted." : ""} The slot was offered to the waitlist.`);
    setCancelTarget(null);
    await reload();
  }

  async function act(a: Appt, action: "confirm" | "complete" | "no_show") {
    const r = await send(`/api/doctor/appointments/${a.id}`, "PATCH", { action });
    if (!r.ok) setErr(r.data.error ?? "Could not update.");
    await reload();
  }

  const row = (a: Appt) => (
    <li key={a.id} className={`flex flex-wrap items-center justify-between gap-3 py-3 text-[13px] ${a.lowPriority ? "bg-[var(--risk-medium)]/5" : ""}`}>
      <div className="min-w-0">
        <p className="font-medium"><Link href={`/doctor/patients/${a.patient_id}`} className="hover:underline">{a.patientName}</Link> <span className="font-normal text-[var(--color-text-muted)]">· {fmtDateTime(a.starts_at)} · {a.visit_type.replace("_", " ")}</span></p>
        {a.severity_reason && <p className="max-w-xl truncate text-[12px] text-[var(--color-text-muted)]" title={a.severity_reason}>{a.severity_reason}</p>}
        {a.lowPriority && <p className="text-[12px] text-[var(--risk-medium)]">⚠ {a.lowPriorityNote}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={SEVERITY_TONE[a.severity]}>{a.severity} · {a.priority_score}</Pill>
        {a.booked_via === "ai_call" && <Pill tone="info">booked by agent</Pill>}
        {a.status === "scheduled" && <button className={btnGhost} onClick={() => act(a, "confirm")}>Confirm</button>}
        <button className={btnGhost} onClick={() => act(a, "complete")}>Done</button>
        <button className={`${btnGhost} hover:!text-red-300`} onClick={() => openCancel(a)}>Cancel…</button>
      </div>
    </li>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-[22px] font-semibold">Appointments</h1><p className="text-[13px] text-[var(--color-text-muted)]">Visits the agent booked are scored by how serious the call was. Cancel the ones that matter least to make room.</p></div>
        <div className="flex rounded-lg border border-[var(--color-border-subtle)] p-0.5 text-[12.5px]">
          {(["day", "priority"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 ${view === v ? "bg-[var(--color-bg-elevated)] font-semibold" : "text-[var(--color-text-secondary)]"}`}>{v === "day" ? "By day" : "Least important first"}</button>)}
        </div>
      </div>
      <ErrorNote message={error ?? err} />
      {notice && <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300">{notice}</p>}
      {loading && !data ? <Loading /> : active.length === 0 ? <Card><p className="text-[13px] text-[var(--color-text-muted)]">No upcoming appointments.</p></Card> : view === "day" ? (
        byDay.map(([day, list]) => <Card key={day} title={fmtDay(list[0].starts_at)}><ul className="divide-y divide-[var(--color-border-subtle)]">{list.map(row)}</ul></Card>)
      ) : (
        <Card><ul className="divide-y divide-[var(--color-border-subtle)]">{byPriority.map(row)}</ul></Card>
      )}
      {past.length > 0 && (
        <Card title="Recently closed"><ul className="divide-y divide-[var(--color-border-subtle)] text-[13px]">{past.map((a) => <li key={a.id} className="flex items-center justify-between py-2"><span>{a.patientName} · {fmtDateTime(a.starts_at)}</span><Pill tone={a.status === "cancelled" ? "bad" : "default"}>{a.status}</Pill></li>)}</ul></Card>
      )}

      <Dialog open={!!cancelTarget} onClose={() => setCancelTarget(null)} title={`Cancel ${cancelTarget?.patientName ?? ""}'s visit?`} subtitle={cancelTarget ? fmtDateTime(cancelTarget.starts_at) : undefined} size="sm"
        footer={<><button className={btnGhost} onClick={() => setCancelTarget(null)}>Keep it</button><button className={btnPrimary} disabled={busy || reason.trim().length < 3} onClick={cancel}>{busy ? "Cancelling…" : "Cancel appointment"}</button></>}>
        <div className="space-y-3">
          {cancelTarget && cancelTarget.priority_score >= 60 && <p className="rounded-md border border-[var(--risk-medium)]/40 bg-[var(--risk-medium)]/10 px-3 py-2 text-[12.5px] text-[var(--risk-medium)]">This looks important ({cancelTarget.severity}). Check the patient before cancelling.</p>}
          <label className="block text-[12px]">Reason (kept internal)<textarea className={`${inputCls} mt-1`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Text the patient that the visit was cancelled</label>
          <ErrorNote message={err} />
        </div>
      </Dialog>
    </div>
  );
}
