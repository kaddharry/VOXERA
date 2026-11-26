"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RiskBadge } from "../../../components/admin/patients/RiskBadge";
import { Card, ErrorNote, Loading, Pill, inputCls, useApi } from "../../../components/doctor/ui";
import type { RiskLevel } from "../../../lib/db/patients";

interface Row {
  id: string;
  name: string;
  phone: string;
  condition: string | null;
  riskLevel: RiskLevel;
  relation: "primary" | "appointment" | "referral";
  medicationCount: number;
  adherencePct: number | null;
  adherenceAtRisk: boolean;
}
const WEIGHT: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export default function DoctorPatientsPage() {
  const { data, error, loading } = useApi<{ patients: Row[] }>("/api/doctor/patients");
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      (data?.patients ?? [])
        .filter((p) => `${p.name} ${p.condition ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => WEIGHT[b.riskLevel] - WEIGHT[a.riskLevel] || a.name.localeCompare(b.name)),
    [data, q],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-[22px] font-semibold">My patients</h1><p className="text-[13px] text-[var(--color-text-muted)]">Highest risk first.</p></div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or condition…" className={`${inputCls} max-w-xs`} />
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : (
        <Card className="overflow-hidden !p-0">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[var(--color-border-subtle)] text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
              <tr><th className="px-4 py-3">Patient</th><th className="px-4 py-3">Condition</th><th className="px-4 py-3">Risk</th><th className="px-4 py-3">Medication taken</th><th className="px-4 py-3">Why mine</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-elevated)]/40">
                  <td className="px-4 py-3"><Link href={`/doctor/patients/${p.id}`} className="font-medium hover:underline">{p.name}</Link><p className="text-[12px] text-[var(--color-text-muted)]">{p.phone}</p></td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">{p.condition ?? "—"}</td>
                  <td className="px-4 py-3"><RiskBadge level={p.riskLevel} /></td>
                  <td className="px-4 py-3">{p.medicationCount === 0 ? <span className="text-[var(--color-text-muted)]">No medicines</span> : p.adherencePct == null ? <span className="text-[var(--color-text-muted)]">Not reported yet</span> : <Pill tone={p.adherenceAtRisk ? "bad" : p.adherencePct >= 80 ? "ok" : "warn"}>{p.adherencePct}%</Pill>}</td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)] capitalize">{p.relation === "primary" ? "Primary doctor" : p.relation === "referral" ? "Referred to me" : "Has appointments"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--color-text-muted)]">No patients yet. Your hospital admin assigns patients to you.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
