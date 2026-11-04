"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  UserCheck,
  FileText,
  CalendarClock,
  History,
  ShieldAlert,
  Trash2,
  ExternalLink,
  CheckCircle2,
  Pencil,
  PhoneOff,
  AlertTriangle,
  Phone,
} from "lucide-react";
import { GlassCard } from "@/app/_components/GlassCard";
import { FollowUpSchedulesPanel } from "../../../../components/admin/FollowUpSchedules";
import { RiskBadge, riskColor } from "../../../../components/admin/patients/RiskBadge";
import { EditRiskDialog } from "../../../../components/admin/patients/EditRiskDialog";
import { RiskGauge } from "../../../../components/admin/patients/RiskGauge";
import { CallActivityChart } from "../../../../components/admin/patients/CallActivityChart";
import type { RiskLevel } from "../../../../lib/db/patients";

/**
 * Dedicated patient profile (spec §9.3): Summary / Records & Documents /
 * Follow-up Plan / Calls & Timeline / Insights & Alerts, each pulling from
 * endpoints that already existed for the Patients list page's inline
 * panels — this just gives them a single, linkable, per-patient home
 * instead of only ever being reachable by expanding a row.
 */

interface Patient {
  id: string;
  name: string;
  phone: string;
  notes: string;
  assignedAgentId: string | null;
  createdAt: number;
  doNotContact: boolean;
  doNotContactReason: string | null;
  condition: string | null;
  riskLevel: RiskLevel;
}

interface PatientDocument {
  id: string;
  filename: string;
  extractedText: string;
  createdAt: number;
}

interface FollowUpTask {
  id: string;
  status: string;
  nextAttemptAt: number;
  attemptCount: number;
  maxAttempts: number;
  lastOutcome: string | null;
}

interface PatientCall {
  id: string;
  sessionId: string | null;
  status: string;
  startedAt: number;
  durationMs: number | null;
  summary: { sentimentTrajectory: string; flaggedConcerns: string[]; recommendedAction: string } | null;
}

interface Alert {
  id: string;
  reason: string;
  priority: string;
  status: string;
  createdAt: number;
  sessionId: string | null;
}

const PRIORITY_COLOR: Record<string, string> = {
  high: "var(--risk-critical)",
  normal: "var(--risk-medium)",
  low: "var(--color-text-muted)",
};

type TabId = "summary" | "documents" | "schedule" | "timeline" | "insights";
const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "summary", label: "Summary", icon: UserCheck },
  { id: "documents", label: "Records & Documents", icon: FileText },
  { id: "schedule", label: "Follow-up Plan", icon: CalendarClock },
  { id: "timeline", label: "Calls & Timeline", icon: History },
  { id: "insights", label: "Insights & Alerts", icon: ShieldAlert },
];

export default function PatientProfilePage() {
  const params = useParams();
  const id = params.id as string;
  const [tab, setTab] = useState<TabId>("summary");

  const [patient, setPatient] = useState<Patient | null>(null);
  const [documents, setDocuments] = useState<PatientDocument[] | null>(null);
  const [tasks, setTasks] = useState<FollowUpTask[] | null>(null);
  const [calls, setCalls] = useState<PatientCall[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [editOpen, setEditOpen] = useState(false);

  // Every fetch here needs its own .catch() — without one, a failed
  // request (network blip, a non-JSON error response, anything) leaves
  // that tab's state at `null` forever, which renders as a spinner that
  // never stops instead of an actual empty/error state.
  useEffect(() => {
    fetch(`/api/admin/patients/${id}`)
      .then((r) => r.json())
      .then((d) => setPatient(d.patient ?? null))
      .catch((e) => {
        console.error("[PatientProfilePage] Failed to load patient:", e);
        setPatient(null);
      });
    fetch(`/api/admin/patients/${id}/documents`)
      .then((r) => r.json())
      .then((d) => setDocuments(d.documents ?? []))
      .catch((e) => {
        console.error("[PatientProfilePage] Failed to load documents:", e);
        setDocuments([]);
      });
    fetch("/api/admin/agents")
      .then((r) => r.json())
      .then((d: { agents?: { id: string; name: string }[] }) => setAgents(d.agents ?? []))
      .catch(() => setAgents([]));
    fetch(`/api/admin/patients/${id}/follow-ups`)
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks ?? []))
      .catch((e) => {
        console.error("[PatientProfilePage] Failed to load follow-ups:", e);
        setTasks([]);
      });
    fetch(`/api/admin/patients/${id}/calls`)
      .then((r) => r.json())
      .then((d) => setCalls(d.calls ?? []))
      .catch((e) => {
        console.error("[PatientProfilePage] Failed to load calls:", e);
        setCalls([]);
      });
    fetch(`/api/alerts?status=all&patientId=${id}`)
      .then((r) => r.json())
      .then((d) => setAlerts(d.alerts ?? []))
      .catch((e) => {
        console.error("[PatientProfilePage] Failed to load alerts:", e);
        setAlerts([]);
      });
  }, [id]);

  async function toggleDoNotContact(value: boolean) {
    const reason = value ? window.prompt("Reason (optional) — e.g. 'patient requested to stop calls'") ?? undefined : undefined;
    const res = await fetch(`/api/admin/patients/${id}/do-not-contact`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, reason }),
    });
    if (res.ok) {
      const data = await res.json();
      setPatient(data.patient);
    }
  }

  async function deleteDocument(docId: string) {
    const res = await fetch(`/api/admin/patients/${id}/documents/${docId}`, { method: "DELETE" });
    if (res.ok) fetch(`/api/admin/patients/${id}/documents`).then((r) => r.json()).then((d) => setDocuments(d.documents ?? []));
  }

  function reloadTasks() {
    fetch(`/api/admin/patients/${id}/follow-ups`)
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks ?? []))
      .catch(() => {});
  }

  async function resolveAlert(alertId: string) {
    const res = await fetch(`/api/alerts/${alertId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (res.ok) fetch(`/api/alerts?status=all&patientId=${id}`).then((r) => r.json()).then((d) => setAlerts(d.alerts ?? []));
  }

  const nextTask = (tasks ?? [])
    .filter((t) => t.status === "scheduled")
    .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
  const overdue = !!nextTask && nextTask.nextAttemptAt < Date.now();
  const openAlertCount = (alerts ?? []).filter((a) => a.status === "open").length;
  const lastCall = (calls ?? [])[0];

  // Follow-up adherence: completed vs. every task that has actually
  // concluded (completed/exhausted/needs_review/cancelled) — still-pending
  // tasks (scheduled/dispatching/calling/paused) aren't counted either way
  // yet, so adherence isn't penalized for work still in flight.
  const concludedTasks = (tasks ?? []).filter((t) => ["completed", "exhausted", "needs_review", "cancelled"].includes(t.status));
  const adherencePct = concludedTasks.length > 0
    ? (concludedTasks.filter((t) => t.status === "completed").length / concludedTasks.length) * 100
    : null;

  if (!patient) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col font-body">
      {/* Compact header: back link + identity on one row, Do Not Contact
          action on the right — matches the rest of the admin shell. */}
      <header className="flex flex-none flex-col gap-3 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
        <Link href="/admin/patients" className="inline-flex w-fit items-center gap-1.5 text-[12px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Patients
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-[14px] font-semibold"
              style={{ backgroundColor: `color-mix(in oklab, ${riskColor(patient.riskLevel)} 18%, transparent)`, color: riskColor(patient.riskLevel) }}
            >
              {patient.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[14.5px] font-semibold text-[var(--color-text-primary)]">{patient.name}</h1>
                <RiskBadge level={patient.riskLevel} />
                {patient.condition && (
                  <span className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                    {patient.condition}
                  </span>
                )}
                <button
                  onClick={() => setEditOpen(true)}
                  className="rounded-md p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors"
                  aria-label="Edit condition and risk level"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
              <p className="truncate font-mono text-[12px] text-[var(--color-text-muted)]">{patient.phone}</p>
            </div>
          </div>
          <button
            onClick={() => toggleDoNotContact(!patient.doNotContact)}
            className={`flex-none rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
              patient.doNotContact
                ? "bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/25"
                : "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {patient.doNotContact ? "Do Not Contact — Clear" : "Mark Do Not Contact"}
          </button>
        </div>

        {/* Quick-stat row — the identity card tells you who; this tells you where things stand */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-[var(--color-text-secondary)]">
          <span><strong className="text-[var(--color-text-primary)]">{calls?.length ?? 0}</strong> calls</span>
          <span>Last contact: <strong className="text-[var(--color-text-primary)]">{lastCall ? new Date(lastCall.startedAt).toLocaleDateString() : "—"}</strong></span>
          <span>
            Next follow-up:{" "}
            <strong className={overdue ? "text-[var(--risk-critical)]" : "text-[var(--color-text-primary)]"}>
              {nextTask ? new Date(nextTask.nextAttemptAt).toLocaleDateString() : "—"}
            </strong>
          </span>
        </div>
      </header>

      {patient.doNotContact && (
        <div className="mx-6 mt-3 flex-none rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-2.5 text-[13px] text-red-400 md:mx-10">
          <strong>Do Not Contact.</strong> This patient will not be called by the scheduler or "Call Now" until this is cleared.
          {patient.doNotContactReason && <span className="block mt-1 text-red-400/80">{patient.doNotContactReason}</span>}
        </div>
      )}

      {/* Tab bar */}
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
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            {t.id === "insights" && openAlertCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[12px] font-mono">{openAlertCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 md:px-10">

      {tab === "summary" && (
        <div className="flex flex-col gap-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <GlassCard className="p-5">
              <h3 className="text-[13px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Next Follow-up</h3>
              {nextTask ? (
                <>
                  <p className={`text-[14px] font-semibold ${overdue ? "text-[var(--risk-critical)]" : "text-[var(--color-text-primary)]"}`}>
                    {overdue ? "Overdue — " : ""}{new Date(nextTask.nextAttemptAt).toLocaleString()}
                  </p>
                  <p className="text-[14px] text-[var(--color-text-muted)] mt-1">Attempt {nextTask.attemptCount} of {nextTask.maxAttempts}</p>
                </>
              ) : (
                <p className="text-[15px] text-[var(--color-text-muted)] italic">Nothing scheduled.</p>
              )}
            </GlassCard>
            <GlassCard className="p-5">
              <h3 className="text-[13px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Most Recent Call</h3>
              {lastCall ? (
                <>
                  <p className="text-[14px] text-[var(--color-text-primary)] font-semibold">{new Date(lastCall.startedAt).toLocaleString()} · {lastCall.status}</p>
                  {lastCall.summary && <p className="text-[14.5px] text-[var(--color-text-secondary)] mt-1.5">{lastCall.summary.sentimentTrajectory}</p>}
                </>
              ) : (
                <p className="text-[15px] text-[var(--color-text-muted)] italic">No calls yet.</p>
              )}
            </GlassCard>
            <GlassCard className="p-5">
              <h3 className="text-[13px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Open Alerts</h3>
              <p className="text-[20px] font-bold" style={{ color: openAlertCount > 0 ? "var(--risk-critical)" : "var(--color-text-primary)" }}>{openAlertCount}</p>
            </GlassCard>
            <GlassCard className="p-5">
              <h3 className="text-[13px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Notes</h3>
              <p className="text-[15px] text-[var(--color-text-secondary)] line-clamp-3">{patient.notes || "—"}</p>
            </GlassCard>
          </div>

          <NextActionsCard overdue={overdue} nextTask={nextTask} openAlertCount={openAlertCount} onViewAlerts={() => setTab("insights")} />

          <div className="grid sm:grid-cols-2 gap-4">
            <GlassCard className="p-5 flex flex-col items-center justify-center">
              <h3 className="self-start text-[13px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Follow-up Adherence</h3>
              {adherencePct === null ? (
                <p className="text-[14px] text-[var(--color-text-muted)] italic py-10">No concluded follow-ups yet.</p>
              ) : (
                <RiskGauge
                  value={adherencePct}
                  label="Adherence"
                  sublabel={`${concludedTasks.filter((t) => t.status === "completed").length} of ${concludedTasks.length} concluded`}
                  color={adherencePct >= 70 ? "var(--risk-low)" : adherencePct >= 40 ? "var(--risk-medium)" : "var(--risk-critical)"}
                />
              )}
            </GlassCard>
            <GlassCard className="p-5">
              <h3 className="text-[13px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Call Activity</h3>
              <CallActivityChart calls={calls ?? []} />
            </GlassCard>
          </div>
        </div>
      )}

      {tab === "documents" && (
        <GlassCard className="p-5">
          {documents === null ? (
            <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-muted)]" />
          ) : documents.length === 0 ? (
            <p className="text-[15px] text-[var(--color-text-muted)] italic">No documents attached yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-start justify-between gap-3 p-3.5 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]">
                  <div className="min-w-0">
                    <div className="text-[14.5px] font-semibold text-[var(--color-text-primary)] flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 flex-none" /> {doc.filename}
                    </div>
                    <div className="text-[13px] text-[var(--color-text-muted)] mt-0.5">{new Date(doc.createdAt).toLocaleDateString()}</div>
                    <p className="text-[13.5px] text-[var(--color-text-secondary)] mt-1.5 line-clamp-2">{doc.extractedText.slice(0, 200)}</p>
                  </div>
                  <button onClick={() => deleteDocument(doc.id)} className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors flex-none">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[13.5px] text-[var(--color-text-muted)] mt-4">
            Add documents from the <Link href="/admin/patients" className="text-[var(--color-accent-violet)] hover:underline">Patients</Link> list's "Documents" panel.
          </p>
        </GlassCard>
      )}

      {tab === "schedule" && (
        <GlassCard className="p-4 sm:p-5">
          <FollowUpSchedulesPanel
            patientId={id}
            patientName={patient?.name ?? "this patient"}
            agents={agents}
            onChanged={reloadTasks}
          />
        </GlassCard>
      )}

      {tab === "timeline" && (
        <>
          {calls && calls.length > 0 && (
            <div className="grid sm:grid-cols-3 gap-4 mb-4">
              <GlassCard className="p-4">
                <h3 className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5">Calls</h3>
                <p className="text-[20px] font-bold text-[var(--color-text-primary)]">{calls.length}</p>
              </GlassCard>
              <GlassCard className="p-4">
                <h3 className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5">Picked Up</h3>
                <p className="text-[20px] font-bold text-[var(--color-text-primary)]">{calls.filter((c) => c.status === "completed").length} / {calls.length}</p>
              </GlassCard>
              <GlassCard className="p-4">
                <h3 className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5">Avg Call Time</h3>
                <p className="text-[20px] font-bold text-[var(--color-text-primary)]">{formatAvgDuration(calls)}</p>
              </GlassCard>
            </div>
          )}
          <GlassCard className="p-5">
            {calls === null ? (
              <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-muted)]" />
            ) : calls.length === 0 && (alerts ?? []).length === 0 && (documents ?? []).length === 0 ? (
              <p className="text-[15px] text-[var(--color-text-muted)] italic">No activity yet.</p>
            ) : (
              <div className="flex flex-col gap-6">
                {groupEventsByDay(buildTimelineEvents(calls ?? [], alerts ?? [], documents ?? [])).map(([day, events]) => (
                  <div key={day}>
                    <h3 className="text-[13px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-2.5">{day}</h3>
                    <div className="flex flex-col gap-2">
                      {events.map((event) => <TimelineRow key={`${event.kind}-${event.id}`} event={event} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </>
      )}

      {tab === "insights" && (
        <GlassCard className="p-5">
          {alerts === null ? (
            <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-muted)]" />
          ) : alerts.length === 0 ? (
            <p className="text-[15px] text-[var(--color-text-muted)] italic">No alerts for this patient.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {alerts.map((a) => (
                <div key={a.id} className={`flex items-center justify-between gap-3 p-3.5 rounded-lg border ${a.status === "open" ? "bg-red-500/5 border-red-500/20" : "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)]"}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                        style={{ color: PRIORITY_COLOR[a.priority] ?? "var(--color-text-muted)", backgroundColor: `color-mix(in oklab, ${PRIORITY_COLOR[a.priority] ?? "var(--color-text-muted)"} 14%, transparent)` }}
                      >
                        {a.priority}
                      </span>
                      <p className="text-[14.5px] text-[var(--color-text-primary)]">{a.reason}</p>
                    </div>
                    <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5">{new Date(a.createdAt).toLocaleString()} · {a.status}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-none">
                    {a.sessionId && (
                      <Link href={`/admin/sessions?session=${a.sessionId}`} className="flex items-center gap-1 text-[13.5px] font-semibold text-[var(--color-accent-violet)] hover:underline">
                        View call <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                    {a.status === "open" && (
                      <button onClick={() => resolveAlert(a.id)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[13.5px] font-semibold flex-none">
                        <CheckCircle2 className="w-3 h-3" /> Mark Reviewed
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}
      </div>

      <EditRiskDialog
        patient={editOpen ? { id: patient.id, name: patient.name, condition: patient.condition, riskLevel: patient.riskLevel } : null}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => setPatient((prev) => (prev ? { ...prev, condition: updated.condition, riskLevel: updated.riskLevel } : prev))}
      />
    </div>
  );
}

function NextActionsCard({
  overdue,
  nextTask,
  openAlertCount,
  onViewAlerts,
}: {
  overdue: boolean;
  nextTask: FollowUpTask | undefined;
  openAlertCount: number;
  onViewAlerts: () => void;
}) {
  if (overdue && nextTask) {
    return (
      <GlassCard className="p-4 flex items-center gap-3 border-l-4 border-l-[var(--risk-critical)]">
        <CalendarClock className="w-5 h-5 flex-none" style={{ color: "var(--risk-critical)" }} />
        <p className="text-[14px] text-[var(--color-text-primary)]">
          Follow-up overdue since <strong>{new Date(nextTask.nextAttemptAt).toLocaleString()}</strong>.
        </p>
      </GlassCard>
    );
  }
  if (openAlertCount > 0) {
    return (
      <GlassCard className="p-4 flex items-center justify-between gap-3 border-l-4 border-l-[var(--risk-high)]">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 flex-none" style={{ color: "var(--risk-high)" }} />
          <p className="text-[14px] text-[var(--color-text-primary)]">
            {openAlertCount} open alert{openAlertCount === 1 ? "" : "s"} need review.
          </p>
        </div>
        <button onClick={onViewAlerts} className="text-[13px] font-semibold text-[var(--color-accent-violet)] hover:underline flex-none">
          Review →
        </button>
      </GlassCard>
    );
  }
  return (
    <GlassCard className="p-4 flex items-center gap-3 border-l-4 border-l-[var(--risk-low)]">
      <CheckCircle2 className="w-5 h-5 flex-none" style={{ color: "var(--risk-low)" }} />
      <p className="text-[14px] text-[var(--color-text-secondary)]">Nothing needs your attention right now.</p>
    </GlassCard>
  );
}

type TimelineEvent =
  | { kind: "call"; id: string; timestamp: number; call: PatientCall }
  | { kind: "alert"; id: string; timestamp: number; alert: Alert }
  | { kind: "document"; id: string; timestamp: number; document: PatientDocument };

function buildTimelineEvents(calls: PatientCall[], alerts: Alert[], documents: PatientDocument[]): TimelineEvent[] {
  return [
    ...calls.map((c): TimelineEvent => ({ kind: "call", id: c.id, timestamp: c.startedAt, call: c })),
    ...alerts.map((a): TimelineEvent => ({ kind: "alert", id: a.id, timestamp: a.createdAt, alert: a })),
    ...documents.map((d): TimelineEvent => ({ kind: "document", id: d.id, timestamp: d.createdAt, document: d })),
  ];
}

/** Groups timeline events by calendar day (newest day first, events within
 * a day oldest-first) — generalizes the old calls-only day grouping to
 * interleave alerts and document uploads alongside calls. */
function groupEventsByDay(events: TimelineEvent[]): Array<[string, TimelineEvent[]]> {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const day = new Date(e.timestamp).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    const list = groups.get(day) ?? [];
    list.push(e);
    groups.set(day, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.timestamp - b.timestamp);
  return Array.from(groups.entries()).sort(([, a], [, b]) => b[0]!.timestamp - a[0]!.timestamp);
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  if (event.kind === "call") {
    const c = event.call;
    return (
      <div className={`p-3.5 rounded-lg border ${c.status === "completed" ? "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)]" : "bg-[var(--color-bg-elevated)]/50 border-dashed border-[var(--color-border-subtle)]"}`}>
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <span className="text-[14.5px] text-[var(--color-text-secondary)] flex items-center gap-1.5">
            {c.status === "completed" ? <Phone className="w-3.5 h-3.5 text-[var(--risk-low)]" /> : <PhoneOff className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />}
            {new Date(c.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {c.durationMs != null && ` · ${Math.round(c.durationMs / 1000)}s`}
            <span className={`ml-2 text-[12px] font-mono uppercase px-1.5 py-0.5 rounded ${c.status === "completed" ? "bg-emerald-500/10 text-emerald-600" : "bg-[#4F46E5]/10 text-[var(--color-text-muted)]"}`}>
              {c.status === "completed" ? "Picked up" : "Missed"}
            </span>
          </span>
          {c.sessionId && (
            <Link href={`/admin/sessions?session=${c.sessionId}`} className="flex items-center gap-1 text-[13px] font-semibold text-[var(--color-accent-violet)] hover:underline flex-none">
              Session analytics <ExternalLink className="w-3 h-3" />
            </Link>
          )}
        </div>
        {c.summary ? (
          <>
            <p className="text-[14.5px] text-[var(--color-text-primary)]">{c.summary.sentimentTrajectory}</p>
            {c.summary.flaggedConcerns.length > 0 && (
              <p className="text-[14px] text-amber-400 mt-1">{c.summary.flaggedConcerns.join("; ")}</p>
            )}
          </>
        ) : c.status === "completed" ? (
          <p className="text-[13.5px] text-[var(--color-text-muted)] italic">No summary available.</p>
        ) : null}
      </div>
    );
  }
  if (event.kind === "alert") {
    const a = event.alert;
    return (
      <div className="p-3.5 rounded-lg border border-dashed" style={{ borderColor: `color-mix(in oklab, ${PRIORITY_COLOR[a.priority] ?? "var(--color-text-muted)"} 30%, transparent)` }}>
        <span className="text-[14.5px] text-[var(--color-text-secondary)] flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5" style={{ color: PRIORITY_COLOR[a.priority] ?? "var(--color-text-muted)" }} />
          {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Alert raised
        </span>
        <p className="text-[14px] text-[var(--color-text-primary)] mt-1">{a.reason}</p>
      </div>
    );
  }
  const d = event.document;
  return (
    <div className="p-3.5 rounded-lg border border-dashed border-[var(--color-border-subtle)]">
      <span className="text-[14.5px] text-[var(--color-text-secondary)] flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
        {new Date(d.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Document added
      </span>
      <p className="text-[14px] text-[var(--color-text-primary)] mt-1">{d.filename}</p>
    </div>
  );
}

function formatAvgDuration(calls: PatientCall[]): string {
  const withDuration = calls.filter((c) => c.durationMs != null && c.status === "completed");
  if (withDuration.length === 0) return "—";
  const avgMs = withDuration.reduce((s, c) => s + (c.durationMs ?? 0), 0) / withDuration.length;
  const totalSecs = Math.round(avgMs / 1000);
  return `${Math.floor(totalSecs / 60)}m ${totalSecs % 60}s`;
}
