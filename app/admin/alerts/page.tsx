"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShieldAlert, Loader2, CheckCircle2, PhoneOff, ExternalLink, ArrowLeft } from "lucide-react";
import { GlassCard } from "../../_components/GlassCard";

/**
 * Alerts (spec walkthrough): reached from the Overview page's notification
 * banner, not a permanent sidebar item — Follow-up Schedule and Calls &
 * Insights were merged into Overview, and this page absorbs the old
 * schedule page's "Needs Attention" list, restructured into the two
 * groupings that were actually useful on a call floor: alerts on calls the
 * patient *picked up* (sub-split by priority, since "picked up but
 * confused" and "picked up and distressed" need different urgency), and
 * alerts where the patient was never reached at all.
 */

interface Alert {
  id: string;
  patientId: string | null;
  patientName: string;
  sessionId: string | null;
  reason: string;
  priority: "low" | "normal" | "high";
  status: "open" | "resolved";
  pickedUp: boolean;
  createdAt: number;
}

const PRIORITY_ORDER: Alert["priority"][] = ["high", "normal", "low"];
const PRIORITY_LABEL: Record<Alert["priority"], string> = { high: "High priority", normal: "Medium priority", low: "Low priority" };
const PRIORITY_STYLE: Record<Alert["priority"], string> = {
  high: "bg-red-500/10 border-red-500/25 text-red-500",
  normal: "bg-amber-500/10 border-amber-500/25 text-amber-600",
  low: "bg-[#4F46E5]/10 border-[#4F46E5]/20 text-[var(--color-accent-violet)]",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch("/api/alerts?status=open")
      .then((r) => r.json())
      .then((d: { alerts?: Alert[] }) => setAlerts(d.alerts ?? []))
      .catch(() => setAlerts([]));
  }

  useEffect(() => { load(); }, []);

  async function resolve(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/alerts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) load();
    } finally {
      setBusyId(null);
    }
  }

  const { pickedUpByPriority, notPickedUp } = useMemo(() => {
    const all = alerts ?? [];
    const pickedUp = all.filter((a) => a.pickedUp);
    const missed = all.filter((a) => !a.pickedUp);
    const byPriority = new Map<Alert["priority"], Alert[]>();
    for (const p of PRIORITY_ORDER) byPriority.set(p, pickedUp.filter((a) => a.priority === p));
    return { pickedUpByPriority: byPriority, notPickedUp: missed };
  }, [alerts]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Link href="/admin" className="inline-flex items-center gap-2 text-[15px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors mb-6">
        <ArrowLeft className="w-4 h-4" /> Back to Overview
      </Link>

      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-red-500/10 border border-red-500/25 rounded-xl text-red-500">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-[22px] font-semibold text-[var(--color-text-primary)]">Alerts</h1>
          <p className="text-[14.5px] text-[var(--color-text-muted)]">
            Everything flagged for human review, grouped by whether the patient actually talked to the agent.
          </p>
        </div>
      </div>

      {alerts === null ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" /></div>
      ) : alerts.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-emerald-500 opacity-70" />
          <p className="text-[15px] text-[var(--color-text-muted)]">Nothing needs attention right now.</p>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-10">
          <section>
            <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)] mb-4">Patient picked up</h2>
            <div className="flex flex-col gap-6">
              {PRIORITY_ORDER.map((p) => {
                const items = pickedUpByPriority.get(p) ?? [];
                if (items.length === 0) return null;
                return (
                  <div key={p}>
                    <h3 className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12.5px] font-mono uppercase tracking-wider mb-3 ${PRIORITY_STYLE[p]}`}>
                      {PRIORITY_LABEL[p]} · {items.length}
                    </h3>
                    <div className="flex flex-col gap-2.5">
                      {items.map((a) => (
                        <AlertRow key={a.id} alert={a} busy={busyId === a.id} onResolve={() => resolve(a.id)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {notPickedUp.length > 0 && (
            <section>
              <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)] mb-4 flex items-center gap-2">
                <PhoneOff className="w-4 h-4 text-[var(--color-text-muted)]" /> Patient didn&rsquo;t pick up · {notPickedUp.length}
              </h2>
              <div className="flex flex-col gap-2.5">
                {notPickedUp.map((a) => (
                  <AlertRow key={a.id} alert={a} busy={busyId === a.id} onResolve={() => resolve(a.id)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function AlertRow({ alert, busy, onResolve }: { alert: Alert; busy: boolean; onResolve: () => void }) {
  const sessionHref = alert.sessionId ? `/admin/sessions?session=${alert.sessionId}` : null;
  return (
    <GlassCard className="p-4 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-semibold text-[var(--color-text-primary)]">{alert.patientName}</span>
          <span className="text-[12.5px] text-[var(--color-text-muted)]">{new Date(alert.createdAt).toLocaleString()}</span>
        </div>
        <p className="text-[14.5px] text-[var(--color-text-secondary)] mt-1">{alert.reason}</p>
      </div>
      <div className="flex items-center gap-2 flex-none">
        {sessionHref && (
          <Link href={sessionHref} className="flex items-center gap-1 text-[13.5px] font-semibold text-[var(--color-accent-violet)] hover:underline">
            View call <ExternalLink className="w-3 h-3" />
          </Link>
        )}
        {alert.patientId && (
          <Link href={`/admin/patients/${alert.patientId}`} className="text-[13.5px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline">
            View patient
          </Link>
        )}
        <button
          onClick={onResolve}
          disabled={busy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 text-[13.5px] font-semibold hover:bg-emerald-500/25 disabled:opacity-40 transition-all"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
          Resolve
        </button>
      </div>
    </GlassCard>
  );
}
