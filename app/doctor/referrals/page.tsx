"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, ErrorNote, Loading, Pill, btnGhost, btnPrimary, fmtDateTime, inputCls, send, useApi } from "../../../components/doctor/ui";

interface Ref {
  id: string;
  patientId: string;
  patientName?: string;
  fromName?: string;
  toName?: string;
  from_provider_id: string;
  to_provider_id: string;
  reason: string;
  urgency: "routine" | "soon" | "urgent";
  status: "pending" | "accepted" | "declined" | "completed" | "cancelled";
  response_note: string | null;
  created_at: string;
}

const STATUS_TONE = { pending: "warn", accepted: "ok", completed: "ok", declined: "bad", cancelled: "default" } as const;

export default function DoctorReferralsPage() {
  const { data, error, loading, reload } = useApi<{ referrals: Ref[]; me: string }>("/api/doctor/referrals");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  async function act(r: Ref, action: "accept" | "decline" | "complete" | "cancel") {
    setErr(null);
    const res = await send(`/api/doctor/referrals/${r.id}`, "PATCH", { action, note: notes[r.id] || undefined });
    if (!res.ok) setErr(res.data.error ?? "Could not update the referral.");
    await reload();
  }

  const me = data?.me;
  const incoming = (data?.referrals ?? []).filter((r) => r.to_provider_id === me);
  const outgoing = (data?.referrals ?? []).filter((r) => r.from_provider_id === me);

  const card = (r: Ref, mine: "in" | "out") => (
    <li key={r.id} className="space-y-2 py-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium"><Link href={`/doctor/patients/${r.patientId}`} className="hover:underline">{r.patientName}</Link> <span className="font-normal text-[var(--color-text-muted)]">· {mine === "in" ? `from ${r.fromName}` : `to ${r.toName}`} · {fmtDateTime(r.created_at)}</span></p>
        <div className="flex gap-1.5"><Pill tone={r.urgency === "urgent" ? "bad" : r.urgency === "soon" ? "warn" : "default"}>{r.urgency}</Pill><Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill></div>
      </div>
      <p className="text-[12.5px] text-[var(--color-text-secondary)]">{r.reason}</p>
      {r.response_note && <p className="text-[12.5px] text-[var(--color-text-muted)]">Reply: {r.response_note}</p>}
      {mine === "in" && r.status === "pending" && (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${inputCls} max-w-sm`} placeholder="Note (required to decline)" value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
          <button className={btnGhost} onClick={() => act(r, "decline")}>Decline</button>
          <button className={btnPrimary} onClick={() => act(r, "accept")}>Accept</button>
        </div>
      )}
      {mine === "in" && r.status === "accepted" && <button className={btnGhost} onClick={() => act(r, "complete")}>Mark complete</button>}
      {mine === "out" && r.status === "pending" && <button className={btnGhost} onClick={() => act(r, "cancel")}>Withdraw</button>}
    </li>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div><h1 className="text-[22px] font-semibold">Referrals</h1><p className="text-[13px] text-[var(--color-text-muted)]">Accepting a referral adds the patient to your list so you can see their history. Start one from a patient&apos;s page.</p></div>
      <ErrorNote message={error ?? err} />
      {loading && !data ? <Loading /> : (
        <>
          <Card title={`Sent to me (${incoming.length})`}>{incoming.length === 0 ? <p className="text-[13px] text-[var(--color-text-muted)]">None.</p> : <ul className="divide-y divide-[var(--color-border-subtle)]">{incoming.map((r) => card(r, "in"))}</ul>}</Card>
          <Card title={`Sent by me (${outgoing.length})`}>{outgoing.length === 0 ? <p className="text-[13px] text-[var(--color-text-muted)]">None.</p> : <ul className="divide-y divide-[var(--color-border-subtle)]">{outgoing.map((r) => card(r, "out"))}</ul>}</Card>
        </>
      )}
    </div>
  );
}
