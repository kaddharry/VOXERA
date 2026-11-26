"use client";

import Link from "next/link";
import { AlertTriangle, CalendarClock, Pill as PillIcon } from "lucide-react";
import { Card, ErrorNote, Loading, Pill, SEVERITY_TONE, Stat, fmtDateTime, useApi } from "../../components/doctor/ui";

interface Overview {
  counts: { patients: number; today: number; thisWeek: number; openAlerts: number; adherenceRisks: number; pendingReferrals: number; pendingRequests: number; lowPriority: number };
  upcoming: Array<{ id: string; patient_id: string; patientName?: string; starts_at: string; visit_type: string; severity: keyof typeof SEVERITY_TONE; lowPriority: boolean }>;
  alerts: Array<{ id: string; patientId: string | null; patientName: string; reason: string; priority: string }>;
  adherenceRisks: Array<{ patientId: string; patientName: string; overallPct: number | null; medications: Array<{ name: string; missedStreak: number; adherencePct: number | null }> }>;
  referralsIn: Array<{ id: string; patientName?: string; fromName?: string; urgency: string; reason: string }>;
}

export default function DoctorOverviewPage() {
  const { data, error, loading } = useApi<Overview>("/api/doctor/overview");
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote message={error} />;
  const c = data.counts;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold">Today</h1>
        <p className="text-[13px] text-[var(--color-text-muted)]">Your patients, your calendar — nothing from other doctors.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="My patients" value={c.patients} />
        <Stat label="Appointments today" value={c.today} />
        <Stat label="Open alerts" value={c.openAlerts} tone={c.openAlerts ? "bad" : "default"} />
        <Stat label="Missing medication" value={c.adherenceRisks} tone={c.adherenceRisks ? "warn" : "default"} />
      </div>

      {(c.pendingReferrals > 0 || c.lowPriority > 0) && (
        <div className="flex flex-wrap gap-3 text-[13px]">
          {c.pendingReferrals > 0 && <Link href="/doctor/referrals" className="rounded-lg border border-[var(--color-border-active)] px-3 py-2">{c.pendingReferrals} referral{c.pendingReferrals > 1 ? "s" : ""} waiting for your answer →</Link>}
          {c.lowPriority > 0 && <Link href="/doctor/appointments" className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2">{c.lowPriority} low-priority visit{c.lowPriority > 1 ? "s" : ""} you could cancel →</Link>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Next appointments</span>} action={<Link href="/doctor/appointments" className="text-[12.5px] text-[var(--color-accent-cyan)]">All</Link>}>
          {data.upcoming.length === 0 ? <p className="text-[13px] text-[var(--color-text-muted)]">Nothing booked this week.</p> : (
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {data.upcoming.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                  <div className="min-w-0"><Link href={`/doctor/patients/${a.patient_id}`} className="font-medium hover:underline">{a.patientName}</Link><p className="text-[12px] text-[var(--color-text-muted)]">{fmtDateTime(a.starts_at)} · {a.visit_type.replace("_", " ")}</p></div>
                  <div className="flex items-center gap-1.5">{a.lowPriority && <Pill tone="warn">low priority</Pill>}<Pill tone={SEVERITY_TONE[a.severity]}>{a.severity}</Pill></div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Alerts on my patients</span>}>
          {data.alerts.length === 0 ? <p className="text-[13px] text-[var(--color-text-muted)]">No open alerts.</p> : (
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {data.alerts.map((a) => (
                <li key={a.id} className="py-2.5 text-[13px]">
                  <div className="flex items-center justify-between gap-2"><Link href={a.patientId ? `/doctor/patients/${a.patientId}` : "#"} className="font-medium hover:underline">{a.patientName}</Link><Pill tone={a.priority === "high" ? "bad" : a.priority === "normal" ? "warn" : "default"}>{a.priority}</Pill></div>
                  <p className="text-[12.5px] text-[var(--color-text-secondary)]">{a.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2"><PillIcon className="h-4 w-4" /> Medication not being taken</span>}>
          {data.adherenceRisks.length === 0 ? <p className="text-[13px] text-[var(--color-text-muted)]">Everyone who reported is on track.</p> : (
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {data.adherenceRisks.map((r) => (
                <li key={r.patientId} className="py-2.5 text-[13px]">
                  <Link href={`/doctor/patients/${r.patientId}`} className="font-medium hover:underline">{r.patientName}</Link>
                  <p className="text-[12.5px] text-[var(--color-text-secondary)]">{r.medications.map((m) => `${m.name}${m.missedStreak >= 2 ? ` (missed ${m.missedStreak} in a row)` : m.adherencePct != null ? ` (${m.adherencePct}%)` : ""}`).join(", ")}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Referrals to me" action={<Link href="/doctor/referrals" className="text-[12.5px] text-[var(--color-accent-cyan)]">Open</Link>}>
          {data.referralsIn.length === 0 ? <p className="text-[13px] text-[var(--color-text-muted)]">No pending referrals.</p> : (
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {data.referralsIn.map((r) => (
                <li key={r.id} className="py-2.5 text-[13px]"><span className="font-medium">{r.patientName}</span> from {r.fromName} <Pill tone={r.urgency === "urgent" ? "bad" : r.urgency === "soon" ? "warn" : "default"}>{r.urgency}</Pill><p className="text-[12.5px] text-[var(--color-text-secondary)]">{r.reason}</p></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
