"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserCheck, Plus, Phone, Loader2, X, Upload, FileText, ChevronDown, ChevronUp, ShieldAlert, ExternalLink, History, Trash2, Files, CalendarClock, Pause, Play, XCircle } from "lucide-react";
import { GlassCard } from "../../_components/GlassCard";
import { PhoneInput } from "../../_components/PhoneInput";
import { DateRangeTimePicker, expandDailyAttemptTimes, defaultDateSelectionValue, type DateSelectionValue } from "../../../components/admin/DateRangeTimePicker";

interface Patient {
  id: string;
  name: string;
  phone: string;
  notes: string;
  assignedAgentId: string | null;
  createdAt: number;
  doNotContact: boolean;
}

interface Agent {
  id: string;
  name: string;
}

interface Programme {
  id: string;
  name: string;
  steps: Array<{ dayOffset: number; label: string }>;
}

interface CallSummary {
  sentimentTrajectory: string;
  flaggedConcerns: string[];
  recommendedAction: string;
}

interface PatientCall {
  id: string;
  sessionId: string | null;
  status: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  summary: CallSummary | null;
}

interface PatientDocument {
  id: string;
  filename: string;
  mimeType: string | null;
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

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [assignedAgentId, setAssignedAgentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Call-with-agent-selection modal — clicking "Call" always prompts for
  // which agent should handle it, defaulting to the patient's assigned
  // agent if one's set, but never skipping the picker.
  const [callTarget, setCallTarget] = useState<Patient | null>(null);
  const [callAgentId, setCallAgentId] = useState("");
  const [calling, setCalling] = useState(false);
  const [callMessage, setCallMessage] = useState<string | null>(null);

  // Schedule-a-follow-up modal (migration_v18.sql) — a single scheduled
  // call with a retry policy, the first-release scope per the redesign
  // spec (not a reusable multi-step programme).
  const [scheduleTarget, setScheduleTarget] = useState<Patient | null>(null);
  const [scheduleMode, setScheduleMode] = useState<"range" | "programme">("range");
  const [rangeValue, setRangeValue] = useState<DateSelectionValue>(defaultDateSelectionValue());
  const [scheduleMaxAttempts, setScheduleMaxAttempts] = useState(3);
  const [scheduleRetryDelay, setScheduleRetryDelay] = useState(30);
  // Was previously missing entirely — a scheduled follow-up with no
  // resolvable agent (no patient default, nothing picked here) used to
  // reach the dispatcher, immediately bail out with "No agent assigned to
  // this follow-up or the patient," and create a silent alert instead of
  // ever dialing. From the hospital's side that reads as "it just never
  // called" with no obvious reason — picking an agent up front, same as
  // the Call Now modal already does, is what actually fixes that.
  const [scheduleAgentId, setScheduleAgentId] = useState("");
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [selectedProgrammeId, setSelectedProgrammeId] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);

  function openScheduleModal(patient: Patient) {
    setScheduleTarget(patient);
    setScheduleMode("range");
    setRangeValue(defaultDateSelectionValue());
    setScheduleMaxAttempts(3);
    setScheduleRetryDelay(30);
    setScheduleAgentId(patient.assignedAgentId ?? "");
    setSelectedProgrammeId("");
    setScheduleMessage(null);
  }

  async function confirmSchedule() {
    if (!scheduleTarget) return;
    if (scheduleMode === "range" && (rangeValue.days.length === 0 || !scheduleAgentId)) return;
    if (scheduleMode === "programme" && !selectedProgrammeId) return;
    setScheduling(true);
    setScheduleMessage(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res =
        scheduleMode === "programme"
          ? await fetch(`/api/admin/patients/${scheduleTarget.id}/enroll`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ programmeId: selectedProgrammeId, startAt: expandDailyAttemptTimes(rangeValue)[0] ?? Date.now(), agentId: scheduleAgentId || undefined, timezone }),
            })
          : await fetch(`/api/admin/patients/${scheduleTarget.id}/schedule-range`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                dailyAttemptTimes: expandDailyAttemptTimes(rangeValue),
                maxAttemptsPerDay: scheduleMaxAttempts,
                retryDelayMinutes: scheduleRetryDelay,
                agentId: scheduleAgentId,
                timezone,
              }),
            });
      const data = await res.json();
      if (res.ok) {
        loadFollowUps(scheduleTarget.id);
        setScheduleTarget(null);
      } else {
        setScheduleMessage(data.error || "Failed to schedule follow-up");
      }
    } catch {
      setScheduleMessage("Failed to schedule follow-up");
    } finally {
      setScheduling(false);
    }
  }

  // Documents / History / Follow-ups are mutually exclusive floating
  // popovers per patient row (see `openPanel` below) rather than three
  // independently-toggleable inline sections — opening one used to push
  // every row below it down the page, and with more than one expanded at
  // once the list turned into an unreadable stack. Only one panel, for one
  // patient, is ever open at a time; it floats over the rows beneath it
  // instead of displacing them.
  type PanelType = "docs" | "history" | "followups";
  const [openPanel, setOpenPanel] = useState<{ patientId: string; type: PanelType } | null>(null);

  const [callsByPatient, setCallsByPatient] = useState<Record<string, PatientCall[] | "loading">>({});
  const [docsByPatient, setDocsByPatient] = useState<Record<string, PatientDocument[] | "loading">>({});
  // Fetched eagerly (not lazily, on first popover open) for every patient as
  // soon as the list loads — this is what the "Next follow-up" line under
  // each patient's phone number reads from, so a scheduled call is visible
  // immediately without opening anything.
  const [followUpsByPatient, setFollowUpsByPatient] = useState<Record<string, FollowUpTask[]>>({});
  const [addingDocFor, setAddingDocFor] = useState<string | null>(null);
  const [newDocFile, setNewDocFile] = useState<File | null>(null);
  const [newDocText, setNewDocText] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);

  function loadDocuments(patientId: string) {
    setDocsByPatient((prev) => ({ ...prev, [patientId]: "loading" }));
    fetch(`/api/admin/patients/${patientId}/documents`)
      .then((r) => r.json())
      .then((data: { documents?: PatientDocument[] }) => {
        setDocsByPatient((prev) => ({ ...prev, [patientId]: data.documents ?? [] }));
      })
      .catch(() => setDocsByPatient((prev) => ({ ...prev, [patientId]: [] })));
  }

  function loadCalls(patientId: string) {
    setCallsByPatient((prev) => ({ ...prev, [patientId]: "loading" }));
    fetch(`/api/admin/patients/${patientId}/calls`)
      .then((r) => r.json())
      .then((data: { calls?: PatientCall[] }) => {
        setCallsByPatient((prev) => ({ ...prev, [patientId]: data.calls ?? [] }));
      })
      .catch(() => setCallsByPatient((prev) => ({ ...prev, [patientId]: [] })));
  }

  function loadFollowUps(patientId: string) {
    return fetch(`/api/admin/patients/${patientId}/follow-ups`)
      .then((r) => r.json())
      .then((data: { tasks?: FollowUpTask[] }) => {
        setFollowUpsByPatient((prev) => ({ ...prev, [patientId]: data.tasks ?? [] }));
      })
      .catch(() => setFollowUpsByPatient((prev) => ({ ...prev, [patientId]: [] })));
  }

  function togglePanel(patientId: string, type: PanelType) {
    setOpenPanel((prev) => (prev && prev.patientId === patientId && prev.type === type ? null : { patientId, type }));
    if (type === "docs" && !docsByPatient[patientId]) loadDocuments(patientId);
    if (type === "history" && !callsByPatient[patientId]) loadCalls(patientId);
  }

  async function actOnFollowUp(patientId: string, taskId: string, action: "pause" | "resume" | "cancel") {
    const res = await fetch(`/api/follow-ups/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) loadFollowUps(patientId);
  }

  function nextFollowUp(patientId: string): FollowUpTask | undefined {
    return (followUpsByPatient[patientId] ?? [])
      .filter((t) => t.status === "scheduled")
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
  }

  async function addDocument(patientId: string) {
    if (!newDocFile && !newDocText.trim()) return;
    setSavingDoc(true);
    try {
      const form = new FormData();
      if (newDocFile) form.set("file", newDocFile);
      if (newDocText.trim()) form.set("text", newDocText.trim());
      const res = await fetch(`/api/admin/patients/${patientId}/documents`, { method: "POST", body: form });
      if (res.ok) {
        setNewDocFile(null);
        setNewDocText("");
        setAddingDocFor(null);
        loadDocuments(patientId);
      }
    } finally {
      setSavingDoc(false);
    }
  }

  async function deleteDocument(patientId: string, docId: string) {
    const res = await fetch(`/api/admin/patients/${patientId}/documents/${docId}`, { method: "DELETE" });
    if (res.ok) loadDocuments(patientId);
  }

  const loadPatients = () => {
    fetch("/api/admin/patients")
      .then((r) => r.json())
      .then((data: { patients?: Patient[] }) => setPatients(data.patients ?? []))
      .catch(() => setPatients([]));
  };

  useEffect(() => {
    loadPatients();
    fetch("/api/admin/agents")
      .then((r) => r.json())
      .then((data: { agents?: Agent[] }) => setAgents(data.agents ?? []))
      .catch(() => {});
    fetch("/api/follow-up-programmes")
      .then((r) => r.json())
      .then((data: { programmes?: Programme[] }) => setProgrammes(data.programmes ?? []))
      .catch(() => {});
  }, []);

  // Next-follow-up badges need every patient's follow-ups, not just the one
  // whose popover happens to be open — fetched once the list itself is in,
  // and again whenever it's reloaded (e.g. after adding a patient).
  useEffect(() => {
    if (!patients) return;
    Promise.all(
      patients.map((p) =>
        fetch(`/api/admin/patients/${p.id}/follow-ups`)
          .then((r) => r.json())
          .then((data: { tasks?: FollowUpTask[] }) => [p.id, data.tasks ?? []] as const)
          .catch(() => [p.id, []] as const),
      ),
    ).then((entries) => setFollowUpsByPatient(Object.fromEntries(entries)));
  }, [patients]);

  async function handleAdd() {
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("name", name);
      form.set("phone", phone);
      if (assignedAgentId) form.set("assignedAgentId", assignedAgentId);
      if (notes) form.set("notes", notes);
      if (file) form.set("file", file);

      const res = await fetch("/api/admin/patients", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to add patient");
        return;
      }
      setName("");
      setPhone("");
      setNotes("");
      setFile(null);
      setAssignedAgentId("");
      setShowAdd(false);
      loadPatients();
    } finally {
      setSaving(false);
    }
  }

  function openCallModal(patient: Patient) {
    setCallTarget(patient);
    setCallAgentId(patient.assignedAgentId ?? "");
    setCallMessage(null);
  }

  async function confirmCall() {
    if (!callTarget || !callAgentId) return;
    setCalling(true);
    try {
      const res = await fetch(`/api/admin/patients/${callTarget.id}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: callAgentId }),
      });
      const data = await res.json();
      if (res.ok) {
        setCallTarget(null);
      } else {
        setCallMessage(data.error || "Failed to place call");
      }
    } catch {
      setCallMessage("Failed to place call");
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="flex h-full flex-col font-body">
      {/* Compact single-line header — matches the rest of the admin shell;
          the breadcrumb above already names this page. */}
      <header className="flex flex-none items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
        <div className="flex items-center gap-2 min-w-0">
          <UserCheck className="h-4 w-4 flex-none text-[var(--color-accent-cyan)]" />
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Patients</span>
          <span className="hidden truncate text-[12px] text-[var(--color-text-muted)] sm:inline">
            · each patient gets their own knowledge base
          </span>
        </div>
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="flex flex-none items-center gap-1.5 rounded-lg btn-gradient px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-all hover:scale-[1.02]"
        >
          {showAdd ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showAdd ? "Cancel" : "Add Patient"}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 md:px-10">
      {showAdd && (
        <GlassCard className="p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Rivera"
                className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
              />
            </div>
            <div>
              <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Phone</label>
              <PhoneInput value={phone} onChange={setPhone} />
            </div>
          </div>

          <div className="mb-4">
            <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
              Knowledge base (PDF or text — surgery details, red-flag symptoms, anything the agent should know)
            </label>
            <label className="flex items-center gap-2.5 px-3.5 py-3 rounded-lg border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] cursor-pointer hover:border-[var(--color-accent-violet)]/40 transition-colors">
              <Upload className="w-4 h-4 text-[var(--color-text-muted)] flex-none" />
              <span className="text-[12.5px] text-[var(--color-text-muted)] flex-1 min-w-0 truncate">
                {file ? file.name : "Click to upload a PDF or text file"}
              </span>
              <input
                type="file"
                accept=".pdf,.txt,.md"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="mb-4">
            <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
              Additional context (optional — kept alongside the uploaded file, not merged into it; add more documents anytime from the patient's "Documents" panel)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything not in the document..."
              className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
            />
          </div>

          <div className="mb-5">
            <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
              Default agent (can still be changed each time you call)
            </label>
            <select
              value={assignedAgentId}
              onChange={(e) => setAssignedAgentId(e.target.value)}
              className="w-full sm:w-64 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
            >
              <option value="">No default — pick each time</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-[12.5px] text-red-400 mb-3">{error}</p>}
          <button
            onClick={handleAdd}
            disabled={saving || !name || !phone}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent-violet)] text-[#0A0C14] text-[13px] font-semibold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Patient
          </button>
        </GlassCard>
      )}

      {patients === null ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" /></div>
      ) : patients.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <UserCheck className="w-8 h-8 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-[13.5px] text-[var(--color-text-muted)]">No patients yet — add one to start calling.</p>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          {patients.map((p) => {
            const nextTask = nextFollowUp(p.id);
            const isOpen = (type: PanelType) => openPanel?.patientId === p.id && openPanel.type === type;
            return (
              <GlassCard key={p.id} className="p-5">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[var(--color-accent-violet)]/15 text-[var(--color-accent-violet)] flex items-center justify-center font-semibold text-[14px] flex-none">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/admin/patients/${p.id}`} className="text-[14px] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent-violet)] hover:underline transition-colors">
                      {p.name}
                    </Link>
                    <div className="text-[11.5px] text-[var(--color-text-muted)] font-mono">{p.phone}</div>
                    {p.notes && (
                      <div className="text-[11px] text-[var(--color-text-muted)] truncate max-w-md mt-0.5 flex items-center gap-1">
                        <FileText className="w-3 h-3 flex-none" /> {p.notes.slice(0, 80)}
                      </div>
                    )}
                    {/* Always visible, no click required — this is the direct fix
                        for "I scheduled a call but can't see it anywhere." */}
                    {nextTask && (
                      <button
                        onClick={() => togglePanel(p.id, "followups")}
                        className="text-[11px] text-[var(--color-accent-cyan)] mt-0.5 flex items-center gap-1 hover:underline"
                      >
                        <CalendarClock className="w-3 h-3 flex-none" />
                        Next follow-up: {new Date(nextTask.nextAttemptAt).toLocaleString()}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => togglePanel(p.id, "docs")}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12.5px] font-semibold transition-all flex-none ${
                      isOpen("docs")
                        ? "bg-[var(--color-accent-violet)]/15 border-[var(--color-accent-violet)]/40 text-[var(--color-accent-violet)]"
                        : "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    }`}
                  >
                    <Files className="w-3.5 h-3.5" /> Documents
                    {isOpen("docs") ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => togglePanel(p.id, "history")}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12.5px] font-semibold transition-all flex-none ${
                      isOpen("history")
                        ? "bg-[var(--color-accent-violet)]/15 border-[var(--color-accent-violet)]/40 text-[var(--color-accent-violet)]"
                        : "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    }`}
                  >
                    <History className="w-3.5 h-3.5" /> History
                    {isOpen("history") ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => togglePanel(p.id, "followups")}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12.5px] font-semibold transition-all flex-none ${
                      isOpen("followups")
                        ? "bg-[var(--color-accent-violet)]/15 border-[var(--color-accent-violet)]/40 text-[var(--color-accent-violet)]"
                        : "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    }`}
                  >
                    <CalendarClock className="w-3.5 h-3.5" /> Follow-ups
                    {isOpen("followups") ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  {p.doNotContact ? (
                    <span className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-[12px] font-semibold flex-none">
                      Do Not Contact
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => openScheduleModal(p)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all flex-none"
                      >
                        <CalendarClock className="w-3.5 h-3.5" /> Schedule
                      </button>
                      <button
                        onClick={() => openCallModal(p)}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[12.5px] font-semibold hover:bg-emerald-500/25 transition-all flex-none"
                      >
                        <Phone className="w-3.5 h-3.5" /> Call
                      </button>
                    </>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
      </div>

      {/* Agent-selection modal — always prompted, every time */}
      {callTarget && (
        <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-6">
          <div className="p-6 w-full max-w-sm bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] shadow-2xl">
            <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)] mb-1">Call {callTarget.name}</h3>
            <p className="text-[12px] text-[var(--color-text-muted)] mb-4">{callTarget.phone}</p>
            <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Agent</label>
            <select
              value={callAgentId}
              onChange={(e) => setCallAgentId(e.target.value)}
              className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50 mb-4"
            >
              <option value="">Select an agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {callMessage && <p className="text-[12px] text-red-400 mb-3">{callMessage}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setCallTarget(null)}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmCall}
                disabled={!callAgentId || calling}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-white text-[13px] font-semibold hover:brightness-110 disabled:opacity-40 transition-all"
              >
                {calling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />}
                Call Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule-a-follow-up modal */}
      {scheduleTarget && (
        <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-6">
          <div className="p-6 w-full max-w-md max-h-[88vh] overflow-y-auto bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] shadow-2xl">
            <h3 className="text-[17px] font-semibold text-[var(--color-text-primary)] mb-1">Schedule a follow-up for {scheduleTarget.name}</h3>
            <p className="text-[13.5px] text-[var(--color-text-muted)] mb-4">{scheduleTarget.phone}</p>

            <div className="flex gap-1.5 mb-4 p-1 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]">
              <button
                onClick={() => setScheduleMode("range")}
                className={`flex-1 px-3 py-1.5 rounded-md text-[13px] font-semibold transition-colors ${scheduleMode === "range" ? "bg-[var(--color-accent-violet)] text-white" : "text-[var(--color-text-secondary)]"}`}
              >
                Date range
              </button>
              <button
                onClick={() => setScheduleMode("programme")}
                className={`flex-1 px-3 py-1.5 rounded-md text-[13px] font-semibold transition-colors ${scheduleMode === "programme" ? "bg-[var(--color-accent-violet)] text-white" : "text-[var(--color-text-secondary)]"}`}
              >
                Programme
              </button>
            </div>

            {scheduleMode === "programme" ? (
              <>
                <div className="mb-4">
                  <label className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
                    Programme
                  </label>
                  {programmes.length === 0 ? (
                    <p className="text-[13.5px] text-[var(--color-text-muted)] italic">
                      No saved programmes. Use &ldquo;Date range&rdquo; instead to call daily across a span of dates.
                    </p>
                  ) : (
                    <select
                      value={selectedProgrammeId}
                      onChange={(e) => setSelectedProgrammeId(e.target.value)}
                      className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[14.5px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
                    >
                      <option value="">Select a programme…</option>
                      {programmes.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.steps.length} calls)</option>
                      ))}
                    </select>
                  )}
                </div>
                <label className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
                  Enrollment date ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                </label>
                <div className="mb-4">
                  <DateRangeTimePicker value={rangeValue} onChange={setRangeValue} />
                </div>
                <label className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
                  Agent (optional — falls back to the programme&rsquo;s or patient&rsquo;s default)
                </label>
                <select
                  value={scheduleAgentId}
                  onChange={(e) => setScheduleAgentId(e.target.value)}
                  className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[14.5px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50 mb-4"
                >
                  <option value="">Use programme/patient default…</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <label className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
                  {rangeValue.days.length > 1
                    ? `Call on each selected day, ${Intl.DateTimeFormat().resolvedOptions().timeZone}`
                    : `Pick one or more dates, ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
                </label>
                <div className="mb-4">
                  <DateRangeTimePicker value={rangeValue} onChange={setRangeValue} />
                </div>

                <label className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
                  Agent
                </label>
                <select
                  value={scheduleAgentId}
                  onChange={(e) => setScheduleAgentId(e.target.value)}
                  className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[14.5px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50 mb-1"
                >
                  <option value="">Select an agent…</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <p className={`text-[12.5px] mb-4 ${scheduleAgentId ? "invisible h-0 mb-0" : "text-amber-600"}`}>
                  Without an agent, this call will never actually dial — it&rsquo;ll just land in Alerts as &ldquo;No agent assigned.&rdquo;
                </p>

                <div className="grid grid-cols-2 gap-3 mb-1">
                  <div>
                    <label className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
                      Max attempts / day
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={scheduleMaxAttempts}
                      onChange={(e) => setScheduleMaxAttempts(Number(e.target.value))}
                      className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[14.5px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
                      Retry after (min)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={scheduleRetryDelay}
                      onChange={(e) => setScheduleRetryDelay(Number(e.target.value))}
                      className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[14.5px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
                    />
                  </div>
                </div>
                <p className="text-[12.5px] text-[var(--color-text-muted)] mb-4">
                  Up to {scheduleMaxAttempts} attempt{scheduleMaxAttempts === 1 ? "" : "s"} per day, {scheduleRetryDelay} min apart. The moment
                  {scheduleTarget.name} picks up and talks, the rest of that day&rsquo;s attempts are dropped automatically — other days in the range are unaffected.
                </p>
              </>
            )}

            {scheduleMessage && <p className="text-[13px] text-red-400 mb-3">{scheduleMessage}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setScheduleTarget(null)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[14px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmSchedule}
                disabled={scheduling || (scheduleMode === "programme" ? !selectedProgrammeId || rangeValue.days.length === 0 : rangeValue.days.length === 0 || !scheduleAgentId)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-accent-violet)] text-white text-[14px] font-semibold hover:brightness-110 disabled:opacity-40 transition-all"
              >
                {scheduling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
                {scheduleMode === "programme" ? "Enroll" : "Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Documents / History / Follow-ups modal — a real centered overlay with
          a backdrop, same pattern as the Call and Schedule modals above,
          rather than a dropdown anchored to the row's button. An anchored
          dropdown inside a scrolling list of visually-similar cards read as
          "still part of the row" instead of a clear popup — this doesn't. */}
      {openPanel && (() => {
        const patient = patients?.find((pp) => pp.id === openPanel.patientId);
        if (!patient) return null;
        const calls = callsByPatient[patient.id];
        const panelTitle = openPanel.type === "docs" ? "Documents" : openPanel.type === "history" ? "Call History" : "Follow-ups";
        return (
          <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-6" onClick={() => setOpenPanel(null)}>
            <div
              className="w-full max-w-lg max-h-[80vh] overflow-y-auto bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] shadow-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{panelTitle}</h3>
                  <p className="text-[12.5px] text-[var(--color-text-muted)]">{patient.name}</p>
                </div>
                <button
                  onClick={() => setOpenPanel(null)}
                  className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors flex-none"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {openPanel.type === "docs" && (
                <div className="flex flex-col gap-3">
                  {(() => {
                    const docs = docsByPatient[patient.id];
                    if (docs === "loading" || docs === undefined) {
                      return (
                        <div className="flex justify-center py-6">
                          <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-muted)]" />
                        </div>
                      );
                    }
                    return (
                      <>
                        {docs.length === 0 ? (
                          <p className="text-[12px] text-[var(--color-text-muted)] italic">No documents attached yet.</p>
                        ) : (
                          docs.map((doc) => (
                            <div
                              key={doc.id}
                              className="rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] p-3.5 flex items-start justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <div className="text-[12.5px] font-semibold text-[var(--color-text-primary)] flex items-center gap-1.5 truncate">
                                  <FileText className="w-3.5 h-3.5 flex-none" /> {doc.filename}
                                </div>
                                <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                                  {new Date(doc.createdAt).toLocaleDateString()}
                                </div>
                                <p className="text-[11.5px] text-[var(--color-text-secondary)] mt-1.5 line-clamp-2">
                                  {doc.extractedText.slice(0, 160)}
                                </p>
                              </div>
                              <button
                                onClick={() => deleteDocument(patient.id, doc.id)}
                                className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors flex-none"
                                aria-label={`Delete ${doc.filename}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))
                        )}

                        {addingDocFor === patient.id ? (
                          <div className="rounded-xl border border-dashed border-[var(--color-border-subtle)] p-3.5 flex flex-col gap-2.5">
                            <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] cursor-pointer hover:border-[var(--color-accent-violet)]/40 transition-colors">
                              <Upload className="w-4 h-4 text-[var(--color-text-muted)] flex-none" />
                              <span className="text-[12px] text-[var(--color-text-muted)] flex-1 min-w-0 truncate">
                                {newDocFile ? newDocFile.name : "Click to upload a PDF or text file"}
                              </span>
                              <input
                                type="file"
                                accept=".pdf,.txt,.md"
                                className="hidden"
                                onChange={(e) => setNewDocFile(e.target.files?.[0] ?? null)}
                              />
                            </label>
                            <textarea
                              value={newDocText}
                              onChange={(e) => setNewDocText(e.target.value)}
                              rows={2}
                              placeholder="Or paste text directly…"
                              className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[12.5px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => { setAddingDocFor(null); setNewDocFile(null); setNewDocText(""); }}
                                className="px-3 py-1.5 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[12px] text-[var(--color-text-secondary)]"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => addDocument(patient.id)}
                                disabled={savingDoc || (!newDocFile && !newDocText.trim())}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-accent-violet)] text-[#0A0C14] text-[12px] font-semibold disabled:opacity-40 transition-all"
                              >
                                {savingDoc && <Loader2 className="w-3 h-3 animate-spin" />} Add
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAddingDocFor(patient.id)}
                            className="flex items-center gap-1.5 self-start px-3 py-1.5 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add document
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {openPanel.type === "history" && (
                <div className="flex flex-col gap-3">
                  {calls === "loading" || calls === undefined ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-muted)]" />
                    </div>
                  ) : calls.length === 0 ? (
                    <p className="text-[12px] text-[var(--color-text-muted)] italic py-2">No calls yet for {patient.name}.</p>
                  ) : (
                    calls.map((c) => (
                      <div key={c.id} className="rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] p-3.5">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div className="text-[12px] text-[var(--color-text-secondary)]">
                            {new Date(c.startedAt).toLocaleString()}
                            {c.durationMs != null && (
                              <span className="text-[var(--color-text-muted)]"> · {Math.round(c.durationMs / 1000)}s</span>
                            )}
                            <span
                              className={`ml-2 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                c.status === "completed"
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : c.status === "failed"
                                    ? "bg-red-500/15 text-red-400"
                                    : "bg-[#4F46E5]/10 text-[var(--color-text-muted)]"
                              }`}
                            >
                              {c.status}
                            </span>
                          </div>
                          {c.sessionId && (
                            <Link
                              href={`/admin/live_dashboard?session=${c.sessionId}`}
                              className="flex items-center gap-1 text-[11px] font-semibold text-[var(--color-accent-violet)] hover:underline flex-none"
                            >
                              Full analysis <ExternalLink className="w-3 h-3" />
                            </Link>
                          )}
                        </div>

                        {c.summary ? (
                          <div className="flex flex-col gap-1.5">
                            <p className="text-[12.5px] text-[var(--color-text-primary)] leading-snug">{c.summary.sentimentTrajectory}</p>
                            {c.summary.flaggedConcerns.length > 0 && (
                              <div className="flex items-start gap-1.5 text-[12px] text-amber-400">
                                <ShieldAlert className="w-3.5 h-3.5 flex-none mt-0.5" />
                                <span>{c.summary.flaggedConcerns.join("; ")}</span>
                              </div>
                            )}
                            <p className="text-[11.5px] text-[var(--color-text-muted)] italic">→ {c.summary.recommendedAction}</p>
                          </div>
                        ) : (
                          <p className="text-[11.5px] text-[var(--color-text-muted)] italic">
                            {c.status === "completed" ? "Summary still generating…" : "No summary — call did not complete."}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {openPanel.type === "followups" && (
                <div className="flex flex-col gap-3">
                  {(followUpsByPatient[patient.id] ?? []).length === 0 ? (
                    <p className="text-[12px] text-[var(--color-text-muted)] italic py-2">
                      No follow-ups scheduled for {patient.name}. Use &ldquo;Schedule&rdquo; to set one up.
                    </p>
                  ) : (
                    (followUpsByPatient[patient.id] ?? [])
                      .slice()
                      .sort((a, b) => b.nextAttemptAt - a.nextAttemptAt)
                      .map((t) => (
                        <div
                          key={t.id}
                          className="rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] p-3.5 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-[12.5px] font-semibold text-[var(--color-text-primary)]">
                              {new Date(t.nextAttemptAt).toLocaleString()}
                            </p>
                            <p className="text-[11.5px] text-[var(--color-text-muted)] mt-0.5">
                              {t.status} · attempt {t.attemptCount} of {t.maxAttempts}
                              {t.lastOutcome && ` · ${t.lastOutcome}`}
                            </p>
                          </div>
                          {(t.status === "scheduled" || t.status === "paused") && (
                            <div className="flex gap-1.5 flex-none">
                              <button
                                onClick={() => actOnFollowUp(patient.id, t.id, t.status === "scheduled" ? "pause" : "resume")}
                                className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
                                aria-label={t.status === "scheduled" ? "Pause" : "Resume"}
                              >
                                {t.status === "scheduled" ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => actOnFollowUp(patient.id, t.id, "cancel")}
                                className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                aria-label="Cancel"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
