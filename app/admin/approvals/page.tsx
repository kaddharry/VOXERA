"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck, X } from "lucide-react";
import { GlassCard } from "../../_components/GlassCard";

interface Req {
  id: string;
  title: string;
  doctor_message: string;
  proposed_instruction: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  review_note: string | null;
  created_at: string;
  doctorName?: string;
  patientName?: string | null;
}

const TABS = ["pending", "approved", "rejected", "all"] as const;

export default function ApprovalsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("pending");
  const [items, setItems] = useState<Req[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    const res = await fetch(`/api/admin/approvals?status=${tab}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Could not load requests."); setItems([]); return; }
    setError(null);
    setItems(data.requests ?? []);
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusy(id); setError(null);
    const res = await fetch(`/api/admin/approvals/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note: notes[id] }) });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setError(data.error ?? "Could not save the decision.");
    await load();
  }

  return (
    <div className="flex h-full flex-col font-body">
      <header className="flex flex-none items-center gap-2 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
        <ShieldCheck className="h-4 w-4 text-[var(--color-accent-cyan)]" />
        <span className="text-[13px] font-semibold">Doctor Requests</span>
        <span className="hidden text-[12px] text-[var(--color-text-muted)] sm:inline">· instructions doctors want the voice agent to follow — nothing goes live until you approve it</span>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6 md:px-10">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-[12.5px] capitalize ${tab === t ? "bg-[var(--color-bg-elevated)] font-semibold" : "text-[var(--color-text-secondary)]"}`}>{t}</button>
          ))}
        </div>
        {error && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">{error}</p>}
        {items === null && <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {items?.length === 0 && <GlassCard className="p-8 text-center text-[13px] text-[var(--color-text-muted)]">Nothing here.</GlassCard>}
        {items?.map((r) => (
          <GlassCard key={r.id} className="space-y-3 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[14px] font-semibold">{r.title}</h2>
              <span className="text-[12px] text-[var(--color-text-muted)]">{r.doctorName ?? "Doctor"} · {r.patientName ? `for ${r.patientName}` : "all their patients"} · {new Date(r.created_at).toLocaleString()}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div><p className="mb-1 text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">Doctor wrote</p><p className="text-[13px] text-[var(--color-text-secondary)]">{r.doctor_message}</p></div>
              <div><p className="mb-1 text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">The agent would be told</p><p className="text-[13px]">{r.proposed_instruction}</p></div>
            </div>
            {r.status === "pending" ? (
              <div className="flex flex-wrap items-center gap-2">
                <input value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} placeholder="Note to the doctor (required to reject)" className="min-w-[14rem] flex-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-[13px]" />
                <button disabled={busy === r.id} onClick={() => decide(r.id, "rejected")} className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-[13px] text-red-300 disabled:opacity-40"><X className="h-3.5 w-3.5" /> Reject</button>
                <button disabled={busy === r.id} onClick={() => decide(r.id, "approved")} className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent-violet)] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"><Check className="h-3.5 w-3.5" /> Approve</button>
              </div>
            ) : (
              <p className="text-[12.5px] text-[var(--color-text-muted)]">Status: <strong className="capitalize">{r.status}</strong>{r.review_note ? ` — ${r.review_note}` : ""}</p>
            )}
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
