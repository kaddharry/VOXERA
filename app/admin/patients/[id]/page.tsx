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
} from "lucide-react";
import { GlassCard } from "@/app/_components/GlassCard";

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

  async function actOnTask(taskId: string, action: "pause" | "resume" | "cancel") {
    const res = await fetch(`/api/follow-ups/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) fetch(`/api/admin/patients/${id}/follow-ups`).then((r) => r.json()).then((d) => setTasks(d.tasks ?? []));
  }

  async function resolveAlert(alertId: string) {
    const res = await fetch(`/api/alerts/${alertId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (res.ok) fetch(`/api/alerts?status=all&patientId=${id}`).then((r) => r.json()).then((d) => setAlerts(d.alerts ?? []));
  }

  const nextTask = (tasks ?? [])
    .filter((t) => t.status === "scheduled")
    .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
  const openAlertCount = (alerts ?? []).filter((a) => a.status === "open").length;
  const lastCall = (calls ?? [])[0];

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
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[var(--color-accent-violet)]/15 text-[13px] font-semibold text-[var(--color-accent-violet)]">
              {patient.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[14.5px] font-semibold text-[var(--color-text-primary)]">{patient.name}</h1>
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
        <div className="grid sm:grid-cols-2 gap-4">
          <GlassCard className="p-5">
            <h3 className="text-[13px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Next Follow-up</h3>
            {nextTask ? (
              <>
                <p className="text-[14px] text-[var(--color-text-primary)] font-semibold">{new Date(nextTask.nextAttemptAt).toLocaleString()}</p>
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
            <p className={`text-[20px] font-bold ${openAlertCount > 0 ? "text-red-400" : "text-[var(--color-text-primary)]"}`}>{openAlertCount}</p>
          </GlassCard>
          <GlassCard className="p-5">
            <h3 className="text-[13px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Notes</h3>
            <p className="text-[15px] text-[var(--color-text-secondary)]">{patient.notes || "—"}</p>
          </GlassCard>
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
        <GlassCard className="p-5">
          {tasks === null ? (
            <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-muted)]" />
          ) : tasks.length === 0 ? (
            <p className="text-[15px] text-[var(--color-text-muted)] italic">
              No follow-ups scheduled. Use the "Schedule" button on the{" "}
              <Link href="/admin/patients" className="text-[var(--color-accent-violet)] hover:underline">Patients</Link> page.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 p-3.5 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]">
                  <div>
                    <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">{new Date(t.nextAttemptAt).toLocaleString()}</p>
                    <p className="text-[13.5px] text-[var(--color-text-muted)] mt-0.5">
                      {t.status} · attempt {t.attemptCount} of {t.maxAttempts}
                      {t.lastOutcome && ` · ${t.lastOutcome}`}
                    </p>
                  </div>
                  {(t.status === "scheduled" || t.status === "paused") && (
                    <div className="flex gap-1.5 flex-none">
                      <button onClick={() => actOnTask(t.id, t.status === "scheduled" ? "pause" : "resume")} className="px-2.5 py-1.5 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[13.5px] text-[var(--color-text-secondary)]">
                        {t.status === "scheduled" ? "Pause" : "Resume"}
                      </button>
                      <button onClick={() => actOnTask(t.id, "cancel")} className="px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-[13.5px] text-red-400">
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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
            ) : calls.length === 0 ? (
              <p className="text-[15px] text-[var(--color-text-muted)] italic">No calls yet.</p>
            ) : (
              <div className="flex flex-col gap-6">
                {groupCallsByDay(calls).map(([day, dayCalls]) => (
                  <div key={day}>
                    <h3 className="text-[13px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-2.5">{day}</h3>
                    <div className="flex flex-col gap-2">
                      {dayCalls.map((c) => (
                        <div key={c.id} className={`p-3.5 rounded-lg border ${c.status === "completed" ? "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)]" : "bg-[var(--color-bg-elevated)]/50 border-dashed border-[var(--color-border-subtle)]"}`}>
                          <div className="flex items-center justify-between gap-3 mb-1.5">
                            <span className="text-[14.5px] text-[var(--color-text-secondary)]">
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
                      ))}
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
                    <p className="text-[14.5px] text-[var(--color-text-primary)]">{a.reason}</p>
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
    </div>
  );
}

/** Groups calls by calendar day (newest day first, calls within a day
 * oldest-first) — the Calls & Timeline tab used to be one flat
 * chronological list with no sense of "how many attempts did Tuesday
 * take." */
function groupCallsByDay(calls: PatientCall[]): Array<[string, PatientCall[]]> {
  const groups = new Map<string, PatientCall[]>();
  for (const c of calls) {
    const day = new Date(c.startedAt).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    const list = groups.get(day) ?? [];
    list.push(c);
    groups.set(day, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.startedAt - b.startedAt);
  return Array.from(groups.entries()).sort(
    ([, a], [, b]) => b[0].startedAt - a[0].startedAt,
  );
}

function formatAvgDuration(calls: PatientCall[]): string {
  const withDuration = calls.filter((c) => c.durationMs != null && c.status === "completed");
  if (withDuration.length === 0) return "—";
  const avgMs = withDuration.reduce((s, c) => s + (c.durationMs ?? 0), 0) / withDuration.length;
  const totalSecs = Math.round(avgMs / 1000);
  return `${Math.floor(totalSecs / 60)}m ${totalSecs % 60}s`;
}
