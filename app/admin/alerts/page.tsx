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
 *
 * Tabbed the same way Overview (app/admin/page.tsx) and the Patient detail
 * page split themselves up — stacking every priority group on one page
 * meant Low priority or missed-call alerts were always below a scroll of
 * everything else. A tab click now gets you straight to one priority with
 * no scrolling; "All" keeps the old grouped-with-colored-headers view for
 * a full sweep.
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
const PRIORITY_COLOR: Record<Alert["priority"], string> = {
  high: "var(--risk-critical, #EF4444)",
  normal: "var(--risk-medium, #EAB308)",
  low: "var(--color-accent-violet)",
};

type TabId = "all" | Alert["priority"] | "missed";
const TABS: Array<{ id: TabId; label: string }> = [
  { id: "all", label: "All" },
  { id: "high", label: "High Priority" },
  { id: "normal", label: "Medium Priority" },
  { id: "low", label: "Low Priority" },
  { id: "missed", label: "Didn't Pick Up" },
];

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("all");

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

  const { pickedUpByPriority, notPickedUp, counts } = useMemo(() => {
    const all = alerts ?? [];
    const pickedUp = all.filter((a) => a.pickedUp);
    const missed = all.filter((a) => !a.pickedUp);
    const byPriority = new Map<Alert["priority"], Alert[]>();
    for (const p of PRIORITY_ORDER) byPriority.set(p, pickedUp.filter((a) => a.priority === p));
    const counts: Record<TabId, number> = {
      all: all.length,
      high: byPriority.get("high")?.length ?? 0,
      normal: byPriority.get("normal")?.length ?? 0,
      low: byPriority.get("low")?.length ?? 0,
      missed: missed.length,
    };
    return { pickedUpByPriority: byPriority, notPickedUp: missed, counts };
  }, [alerts]);

  return (
    <div className="flex h-full flex-col font-body">
      {/* Compact header, flush below the breadcrumb bar — same convention as
          every other admin page (Patients, the Patient detail page). Alerts
          isn't a sidebar item, so it keeps the back-link row the Patient
          detail page also uses, directly above the title line. */}
      <header className="flex flex-none flex-col gap-2 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
        <Link href="/admin" className="inline-flex w-fit items-center gap-1.5 text-[12px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Overview
        </Link>
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className="h-4 w-4 flex-none text-red-400" />
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Alerts</span>
          <span className="hidden truncate text-[12px] text-[var(--color-text-muted)] sm:inline">
            · everything flagged for human review, grouped by whether the patient actually talked to the agent
          </span>
        </div>
      </header>

      {/* Tab bar — same underline-tab pattern as the Patient detail page's,
          directly below the header with its own border-b. */}
      {alerts !== null && alerts.length > 0 && (
        <div className="flex flex-none items-center gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)] px-6 pt-2 md:px-10">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
                tab === t.id
                  ? "border-[var(--color-accent-violet)] text-[var(--color-text-primary)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              }`}
            >
              {t.label} · {counts[t.id]}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-6 md:px-10">
        {alerts === null ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" /></div>
        ) : alerts.length === 0 ? (
          <GlassCard className="p-10 text-center">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-emerald-500 opacity-70" />
            <p className="text-[15px] text-[var(--color-text-muted)]">Nothing needs attention right now.</p>
          </GlassCard>
        ) : tab === "all" ? (
          <div className="flex flex-col gap-10">
            <section>
              <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)] mb-4">Patient picked up</h2>
              <div className="flex flex-col gap-6">
                {PRIORITY_ORDER.map((p) => {
                  const items = pickedUpByPriority.get(p) ?? [];
                  if (items.length === 0) return null;
                  return (
                    <div key={p}>
                      <h3
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-mono font-bold uppercase tracking-wider mb-3 text-black"
                        style={{ backgroundColor: PRIORITY_COLOR[p] }}
                      >
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
        ) : (
          (() => {
            const items = tab === "missed" ? notPickedUp : pickedUpByPriority.get(tab) ?? [];
            return items.length === 0 ? (
              <GlassCard className="p-10 text-center">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-emerald-500 opacity-70" />
                <p className="text-[15px] text-[var(--color-text-muted)]">Nothing in this tab right now.</p>
              </GlassCard>
            ) : (
              <div className="flex flex-col gap-2.5">
                {items.map((a) => (
                  <AlertRow key={a.id} alert={a} busy={busyId === a.id} onResolve={() => resolve(a.id)} />
                ))}
              </div>
            );
          })()
        )}
      </div>
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-black text-[13.5px] font-bold hover:brightness-110 disabled:opacity-40 transition-all"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
          Resolve
        </button>
      </div>
    </GlassCard>
  );
}
