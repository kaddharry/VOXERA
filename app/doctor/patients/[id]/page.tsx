"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft, MessageSquareText, Repeat2 } from "lucide-react";
import { RiskBadge } from "../../../../components/admin/patients/RiskBadge";
import { Card, ErrorNote, Loading, Pill, SEVERITY_TONE, ago, btnGhost, btnPrimary, fmtDateTime, inputCls, send, useApi } from "../../../../components/doctor/ui";
import type { RiskLevel } from "../../../../lib/db/patients";

interface Detail {
  patient: { id: string; name: string; phone: string; condition: string | null; riskLevel: RiskLevel; notes: string; doNotContact: boolean };
  calls: Array<{ id: string; startedAt: number | null; durationMs: number | null; status: string; summary: null | { sentimentTrajectory: string | null; flaggedConcerns: string[]; recommendedAction: string | null; painReported: null | { present: boolean; location: string | null; score: number | null; description: string | null } } }>;
  pain: Array<{ at: number; callId: string; present: boolean; location: string | null; score: number | null; description: string | null }>;
  medications: Array<{ id: string; name: string; dosage: string | null; frequency: string; instructions: string | null; status: string }>;
  adherence: { overallPct: number | null; atRisk: boolean; medications: Array<{ medicationId: string; name: string; adherencePct: number | null; reports: number; missed: number; missedStreak: number; lastStatus: string | null; lastReportedAt: number | null; atRisk: boolean }> };
  appointments: Array<{ id: string; starts_at: string; status: string; visit_type: string; severity: keyof typeof SEVERITY_TONE; severity_reason: string | null }>;
  alerts: Array<{ id: string; reason: string; priority: string }>;
  referrals: Array<{ id: string; fromName?: string; toName?: string; status: string; reason: string; urgency: string }>;
  instructions: Array<{ id: string; title: string; proposed_instruction: string; status: string }>;
}

export default function DoctorPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useApi<Detail>(`/api/doctor/patients/${id}`);
  if (loading && !data) return <Loading />;
  if (!data) return <div className="space-y-3"><Link href="/doctor/patients" className="text-[13px] text-[var(--color-accent-cyan)]">← My patients</Link><ErrorNote message={error} /></div>;
  const { patient } = data;
  const adherenceById = new Map(data.adherence.medications.map((a) => [a.medicationId, a]));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/doctor/patients" className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"><ArrowLeft className="h-3.5 w-3.5" /> My patients</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold">{patient.name}</h1>
          <p className="text-[13px] text-[var(--color-text-muted)]">{patient.phone}{patient.condition ? ` · ${patient.condition}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RiskBadge level={patient.riskLevel} />
          <Link href={`/doctor/assistant?patientId=${patient.id}`} className={`${btnGhost} flex items-center gap-1.5`}><MessageSquareText className="h-3.5 w-3.5" /> Instruct the agent</Link>
        </div>
      </div>

      {data.alerts.length > 0 && (
        <Card title="Open alerts">
          <ul className="space-y-1.5 text-[13px]">{data.alerts.map((a) => <li key={a.id} className="flex items-center gap-2"><Pill tone={a.priority === "high" ? "bad" : "warn"}>{a.priority}</Pill>{a.reason}</li>)}</ul>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Pain reported on calls">
          {data.pain.filter((p) => p.present).length === 0 ? <p className="text-[13px] text-[var(--color-text-muted)]">No pain reported in recent calls. The agent asks about it on the next call if any was mentioned.</p> : (
            <ol className="space-y-2">
              {[...data.pain].reverse().filter((p) => p.present).map((p) => (
                <li key={p.callId} className="flex items-start gap-3 text-[13px]">
                  <span className="mt-0.5 w-12 flex-none text-right text-[18px] font-semibold" style={{ color: (p.score ?? 0) >= 7 ? "var(--risk-critical)" : (p.score ?? 0) >= 4 ? "var(--risk-medium)" : "var(--risk-low)" }}>{p.score != null ? `${p.score}/10` : "—"}</span>
                  <div><p className="font-medium">{p.location ?? "Pain"}</p><p className="text-[12.5px] text-[var(--color-text-secondary)]">{p.description ?? "No detail given"} · {ago(p.at)}</p></div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <MedicationsCard patientId={patient.id} data={data} adherenceById={adherenceById} onChanged={reload} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <AppointmentsCard patientId={patient.id} appointments={data.appointments} onChanged={reload} />
        <ReferralCard patientId={patient.id} referrals={data.referrals} onChanged={reload} />
      </div>

      <Card title="Recent calls">
        {data.calls.length === 0 ? <p className="text-[13px] text-[var(--color-text-muted)]">No calls yet.</p> : (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {data.calls.map((c) => (
              <li key={c.id} className="py-3 text-[13px]">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{fmtDateTime(c.startedAt)}</span><Pill tone={c.status === "completed" ? "ok" : "default"}>{c.status}</Pill></div>
                {c.summary ? (
                  <div className="mt-1 space-y-0.5 text-[12.5px] text-[var(--color-text-secondary)]">
                    {c.summary.recommendedAction && <p>{c.summary.recommendedAction}</p>}
                    {c.summary.flaggedConcerns.length > 0 && <p className="text-[var(--risk-medium)]">Concerns: {c.summary.flaggedConcerns.join("; ")}</p>}
                    {c.summary.painReported?.present && <p>Pain: {c.summary.painReported.location ?? "reported"}{c.summary.painReported.score != null ? ` (${c.summary.painReported.score}/10)` : ""}</p>}
                  </div>
                ) : <p className="mt-1 text-[12.5px] text-[var(--color-text-muted)]">No summary.</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.instructions.length > 0 && (
        <Card title="Instructions you gave the agent">
          <ul className="space-y-2 text-[13px]">{data.instructions.map((i) => <li key={i.id} className="flex items-start justify-between gap-3"><span><strong>{i.title}</strong> — {i.proposed_instruction}</span><Pill tone={i.status === "approved" ? "ok" : i.status === "pending" ? "warn" : "default"}>{i.status}</Pill></li>)}</ul>
        </Card>
      )}
    </div>
  );
}

function MedicationsCard({ patientId, data, adherenceById, onChanged }: { patientId: string; data: Detail; adherenceById: Map<string, Detail["adherence"]["medications"][number]>; onChanged: () => void }) {
  const [form, setForm] = useState({ name: "", dosage: "", frequency: "once daily", timesPerDay: 1, instructions: "" });
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const active = data.medications.filter((m) => m.status === "active");

  async function add() {
    setErr(null);
    const r = await send(`/api/doctor/patients/${patientId}/medications`, "POST", { name: form.name, dosage: form.dosage || null, frequency: form.frequency, timesPerDay: form.timesPerDay, instructions: form.instructions || null });
    if (!r.ok) return setErr(r.data.error ?? "Could not add the medicine.");
    setForm({ name: "", dosage: "", frequency: "once daily", timesPerDay: 1, instructions: "" });
    setAdding(false);
    onChanged();
  }
  async function patch(body: unknown) {
    const r = await send(`/api/doctor/patients/${patientId}/medications`, "PATCH", body);
    if (!r.ok) setErr(r.data.error ?? "Could not update.");
    onChanged();
  }

  return (
    <Card title={<span>Medication{data.adherence.overallPct != null ? <span className="ml-2 text-[12.5px] font-normal text-[var(--color-text-muted)]">{data.adherence.overallPct}% taken as reported</span> : null}</span>} action={<button className={btnGhost} onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "+ Prescribe"}</button>}>
      <ErrorNote message={err} />
      {adding && (
        <div className="mb-4 grid gap-2 rounded-lg border border-[var(--color-border-subtle)] p-3 sm:grid-cols-2">
          <input className={inputCls} placeholder="Medicine (e.g. Metformin)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inputCls} placeholder="Dose (e.g. 500 mg)" value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} />
          <input className={inputCls} placeholder="How often (e.g. twice a day after food)" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} />
          <input className={inputCls} type="number" min={1} max={6} value={form.timesPerDay} onChange={(e) => setForm({ ...form, timesPerDay: Number(e.target.value) || 1 })} aria-label="Times per day" />
          <input className={`${inputCls} sm:col-span-2`} placeholder="Notes for the agent (optional)" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
          <div className="sm:col-span-2"><button className={btnPrimary} disabled={form.name.trim().length < 2} onClick={add}>Save medicine</button></div>
        </div>
      )}
      {active.length === 0 ? <p className="text-[13px] text-[var(--color-text-muted)]">No active medicines. Once you add one, the agent asks about it on calls and records the answer.</p> : (
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {active.map((m) => {
            const a = adherenceById.get(m.id);
            return (
              <li key={m.id} className="py-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="font-medium">{m.name}{m.dosage ? ` ${m.dosage}` : ""}</p><p className="text-[12px] text-[var(--color-text-muted)]">{m.frequency}</p></div>
                  <div className="flex items-center gap-1.5">
                    {a?.atRisk && <Pill tone="bad">often missed</Pill>}
                    {a?.adherencePct != null ? <Pill tone={a.atRisk ? "bad" : a.adherencePct >= 80 ? "ok" : "warn"}>{a.adherencePct}% · {a.reports} reports</Pill> : <Pill>not reported</Pill>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
                  <span className="mr-1 self-center text-[var(--color-text-muted)]">Log from clinic:</span>
                  {(["taken", "partial", "missed"] as const).map((s) => <button key={s} className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 capitalize hover:border-[var(--color-border-active)]" onClick={() => patch({ medicationId: m.id, adherence: s })}>{s}</button>)}
                  <button className="ml-auto rounded-md px-2 py-1 text-[var(--color-text-muted)] hover:text-red-400" onClick={() => confirm(`Stop ${m.name}?`) && patch({ medicationId: m.id, status: "stopped" })}>Stop</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function AppointmentsCard({ patientId, appointments, onChanged }: { patientId: string; appointments: Detail["appointments"]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [severity, setSeverity] = useState("moderate");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function book() {
    setErr(null);
    const r = await send("/api/doctor/appointments", "POST", { patientId, startsAt: new Date(when).toISOString(), durationMinutes: minutes, visitType: "follow_up", severity, notes: notes || null });
    if (!r.ok) return setErr(r.data.error ?? "Could not book.");
    setOpen(false); setWhen(""); setNotes("");
    onChanged();
  }
  return (
    <Card title="Appointments with me" action={<button className={btnGhost} onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ Book follow-up"}</button>}>
      <ErrorNote message={err} />
      {open && (
        <div className="mb-4 grid gap-2 rounded-lg border border-[var(--color-border-subtle)] p-3 sm:grid-cols-2">
          <input className={inputCls} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Date and time" />
          <select className={inputCls} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Length">{[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}</select>
          <select className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="How important"><option value="routine">Routine</option><option value="moderate">Moderate</option><option value="serious">Serious</option></select>
          <input className={inputCls} placeholder="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="sm:col-span-2"><button className={btnPrimary} disabled={!when} onClick={book}>Book</button></div>
        </div>
      )}
      {appointments.length === 0 ? <p className="text-[13px] text-[var(--color-text-muted)]">None.</p> : (
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {appointments.slice(0, 8).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2.5 text-[13px]">
              <div><p>{fmtDateTime(a.starts_at)}</p>{a.severity_reason && <p className="max-w-xs truncate text-[12px] text-[var(--color-text-muted)]" title={a.severity_reason}>{a.severity_reason}</p>}</div>
              <div className="flex items-center gap-1.5"><Pill tone={SEVERITY_TONE[a.severity]}>{a.severity}</Pill><Pill tone={a.status === "cancelled" ? "bad" : "default"}>{a.status}</Pill></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReferralCard({ patientId, referrals, onChanged }: { patientId: string; referrals: Detail["referrals"]; onChanged: () => void }) {
  const colleagues = useApi<{ colleagues: Array<{ id: string; name: string; specialty: string | null }> }>("/api/doctor/colleagues");
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [urgency, setUrgency] = useState("routine");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function refer() {
    setErr(null);
    const r = await send("/api/doctor/referrals", "POST", { patientId, toProviderId: to, reason, urgency });
    if (!r.ok) return setErr(r.data.error ?? "Could not refer.");
    setOpen(false); setReason(""); setTo("");
    onChanged();
  }
  return (
    <Card title="Referrals" action={<button className={`${btnGhost} flex items-center gap-1.5`} onClick={() => setOpen((o) => !o)}><Repeat2 className="h-3.5 w-3.5" />{open ? "Close" : "Refer to a doctor"}</button>}>
      <ErrorNote message={err} />
      {open && (
        <div className="mb-4 space-y-2 rounded-lg border border-[var(--color-border-subtle)] p-3">
          <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Refer to"><option value="">Choose a doctor…</option>{colleagues.data?.colleagues.map((c) => <option key={c.id} value={c.id}>{c.name}{c.specialty ? ` — ${c.specialty}` : ""}</option>)}</select>
          <select className={inputCls} value={urgency} onChange={(e) => setUrgency(e.target.value)} aria-label="Urgency"><option value="routine">Routine</option><option value="soon">Soon</option><option value="urgent">Urgent</option></select>
          <textarea className={inputCls} rows={3} placeholder="Why are you referring this patient?" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className={btnPrimary} disabled={!to || reason.trim().length < 5} onClick={refer}>Send referral</button>
        </div>
      )}
      {referrals.length === 0 ? <p className="text-[13px] text-[var(--color-text-muted)]">No referrals for this patient.</p> : (
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {referrals.map((r) => <li key={r.id} className="py-2.5 text-[13px]"><div className="flex items-center justify-between gap-2"><span>{r.fromName} → {r.toName}</span><Pill tone={r.status === "accepted" || r.status === "completed" ? "ok" : r.status === "declined" || r.status === "cancelled" ? "bad" : "warn"}>{r.status}</Pill></div><p className="text-[12.5px] text-[var(--color-text-secondary)]">{r.reason}</p></li>)}
        </ul>
      )}
    </Card>
  );
}
