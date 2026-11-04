"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  UserCheck,
  Plus,
  Phone,
  Loader2,
  Upload,
  FileText,
  CalendarClock,
  Search,
  Pencil,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Users,
  ShieldAlert,
} from "lucide-react";
import { GlassCard } from "../../_components/GlassCard";
import { PhoneInput } from "../../_components/PhoneInput";
import { DateRangeTimePicker, expandDailyAttemptTimes, defaultDateSelectionValue, type DateSelectionValue } from "../../../components/admin/DateRangeTimePicker";
import { Dialog } from "../../../components/admin/Dialog";
import { RiskBadge, riskColor } from "../../../components/admin/patients/RiskBadge";
import { EditRiskDialog } from "../../../components/admin/patients/EditRiskDialog";
import { RISK_LEVELS, type RiskLevel } from "../../../lib/db/patients";

interface Patient {
  id: string;
  name: string;
  phone: string;
  notes: string;
  assignedAgentId: string | null;
  createdAt: number;
  doNotContact: boolean;
  condition: string | null;
  riskLevel: RiskLevel;
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

interface PatientCall {
  id: string;
  status: string;
  startedAt: number;
}

interface FollowUpTask {
  id: string;
  status: string;
  nextAttemptAt: number;
  attemptCount: number;
  maxAttempts: number;
}

interface AlertRecord {
  id: string;
  patientId: string | null;
  priority: string;
  status: string;
}

const RISK_WEIGHT: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

type SortKey = "name" | "risk" | "lastCall" | "nextFollowUp" | "alerts";

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [condition, setCondition] = useState("");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("low");
  const [file, setFile] = useState<File | null>(null);
  const [assignedAgentId, setAssignedAgentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [callTarget, setCallTarget] = useState<Patient | null>(null);
  const [callAgentId, setCallAgentId] = useState("");
  const [calling, setCalling] = useState(false);
  const [callMessage, setCallMessage] = useState<string | null>(null);

  const [scheduleTarget, setScheduleTarget] = useState<Patient | null>(null);
  const [scheduleMode, setScheduleMode] = useState<"range" | "programme">("range");
  const [rangeValue, setRangeValue] = useState<DateSelectionValue>(defaultDateSelectionValue());
  const [scheduleMaxAttempts, setScheduleMaxAttempts] = useState(3);
  const [scheduleRetryDelay, setScheduleRetryDelay] = useState(30);
  const [scheduleAgentId, setScheduleAgentId] = useState("");
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [selectedProgrammeId, setSelectedProgrammeId] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<Patient | null>(null);

  const [callsByPatient, setCallsByPatient] = useState<Record<string, PatientCall[]>>({});
  const [followUpsByPatient, setFollowUpsByPatient] = useState<Record<string, FollowUpTask[]>>({});
  const [alertsByPatient, setAlertsByPatient] = useState<Record<string, AlertRecord[]>>({});

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | RiskLevel>("all");
  const [onlyWithAlerts, setOnlyWithAlerts] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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

  function loadFollowUps(patientId: string) {
    return fetch(`/api/admin/patients/${patientId}/follow-ups`)
      .then((r) => r.json())
      .then((data: { tasks?: FollowUpTask[] }) => {
        setFollowUpsByPatient((prev) => ({ ...prev, [patientId]: data.tasks ?? [] }));
      })
      .catch(() => setFollowUpsByPatient((prev) => ({ ...prev, [patientId]: [] })));
  }

  const nextFollowUp = useCallback(
    (patientId: string): FollowUpTask | undefined =>
      (followUpsByPatient[patientId] ?? [])
        .filter((t) => t.status === "scheduled")
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0],
    [followUpsByPatient],
  );

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
    // One request for every open alert in the tenant, grouped client-side —
    // cheaper than fetching per-patient alerts for every row.
    fetch("/api/alerts?status=open")
      .then((r) => r.json())
      .then((data: { alerts?: AlertRecord[] }) => {
        const grouped: Record<string, AlertRecord[]> = {};
        for (const a of data.alerts ?? []) {
          if (!a.patientId) continue;
          (grouped[a.patientId] ??= []).push(a);
        }
        setAlertsByPatient(grouped);
      })
      .catch(() => {});
  }, []);

  // Eagerly fetched for every patient as soon as the list loads — this is
  // what the Last Call / Next Follow-up columns and the stat strip read
  // from, so the table is useful without opening anything.
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

    Promise.all(
      patients.map((p) =>
        fetch(`/api/admin/patients/${p.id}/calls`)
          .then((r) => r.json())
          .then((data: { calls?: PatientCall[] }) => [p.id, data.calls ?? []] as const)
          .catch(() => [p.id, []] as const),
      ),
    ).then((entries) => setCallsByPatient(Object.fromEntries(entries)));
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
      if (condition) form.set("condition", condition);
      form.set("riskLevel", riskLevel);
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
      setCondition("");
      setRiskLevel("low");
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

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const rows = useMemo(() => {
    if (!patients) return [];
    const q = search.trim().toLowerCase();
    let list = patients.filter((p) => {
      if (riskFilter !== "all" && p.riskLevel !== riskFilter) return false;
      if (onlyWithAlerts && (alertsByPatient[p.id]?.length ?? 0) === 0) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.phone.toLowerCase().includes(q) || (p.condition ?? "").toLowerCase().includes(q);
    });

    const lastCallOf = (id: string) => callsByPatient[id]?.[0]?.startedAt ?? -Infinity;
    const nextFollowUpOf = (id: string) => nextFollowUp(id)?.nextAttemptAt ?? Infinity;
    const alertsOf = (id: string) => alertsByPatient[id]?.length ?? 0;

    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "risk":
          cmp = RISK_WEIGHT[a.riskLevel] - RISK_WEIGHT[b.riskLevel];
          break;
        case "lastCall":
          cmp = lastCallOf(a.id) - lastCallOf(b.id);
          break;
        case "nextFollowUp":
          // Soonest first when ascending — invert so "no follow-up" (Infinity) always sorts last.
          cmp = nextFollowUpOf(b.id) - nextFollowUpOf(a.id);
          break;
        case "alerts":
          cmp = alertsOf(a.id) - alertsOf(b.id);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [patients, search, riskFilter, onlyWithAlerts, sortKey, sortDir, callsByPatient, alertsByPatient, nextFollowUp]);

  const stats = useMemo(() => {
    const total = patients?.length ?? 0;
    const highRisk = (patients ?? []).filter((p) => p.riskLevel === "high" || p.riskLevel === "critical").length;
    const overdue = (patients ?? []).filter((p) => {
      const t = nextFollowUp(p.id);
      return t && t.nextAttemptAt < Date.now();
    }).length;
    const openAlerts = Object.values(alertsByPatient).reduce((sum, arr) => sum + arr.length, 0);
    return { total, highRisk, overdue, openAlerts };
  }, [patients, alertsByPatient, nextFollowUp]);

  return (
    <div className="flex h-full flex-col font-body">
      <header className="flex flex-none items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
        <div className="flex items-center gap-2 min-w-0">
          <UserCheck className="h-4 w-4 flex-none text-[var(--color-accent-cyan)]" />
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Patients</span>
          <span className="hidden truncate text-[12px] text-[var(--color-text-muted)] sm:inline">
            · each patient gets their own knowledge base
          </span>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex flex-none items-center gap-1.5 rounded-lg btn-gradient px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-all hover:scale-[1.02]"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Patient
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-28 sm:p-6 sm:pb-28 md:px-10">
        <Dialog
          open={showAdd}
          onClose={() => setShowAdd(false)}
          title="Add Patient"
          subtitle="Each patient gets their own knowledge base"
          size="lg"
          footer={
            <>
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={saving || !name || !phone}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent-violet)] text-white text-[13px] font-semibold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Patient
              </button>
            </>
          }
        >
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
                  Condition <span className="normal-case text-[var(--color-text-muted)]/70">(optional)</span>
                </label>
                <input
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  placeholder="e.g. Post-Op Recovery"
                  className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
                />
              </div>
              <div>
                <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Risk level</label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {RISK_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setRiskLevel(level)}
                      className={`rounded-lg transition-all ${riskLevel === level ? "ring-2 ring-[var(--color-accent-violet)]" : "opacity-60 hover:opacity-100"}`}
                    >
                      <RiskBadge level={level} className="px-2.5 py-1" />
                    </button>
                  ))}
                </div>
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
                Additional context (optional — kept alongside the uploaded file, not merged into it; add more documents anytime from the patient's page)
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

            {error && <p className="text-[12.5px] text-red-400 mt-1">{error}</p>}
        </Dialog>

        {patients === null ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[52px] rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] animate-pulse" />
            ))}
          </div>
        ) : patients.length === 0 ? (
          <GlassCard className="flex flex-col items-center gap-4 p-14 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-accent-violet)]/10 border border-[var(--color-accent-violet)]/20">
              <UserCheck className="h-7 w-7 text-[var(--color-accent-violet)]" />
            </div>
            <div>
              <p className="text-[16px] font-semibold text-[var(--color-text-primary)]">No patients yet</p>
              <p className="mt-1.5 max-w-sm text-[13.5px] text-[var(--color-text-muted)]">
                Add your first patient to give them their own knowledge base, start calling, and schedule follow-ups.
              </p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 rounded-lg btn-gradient px-4 py-2 text-[13px] font-semibold text-white transition-all hover:scale-[1.02]"
            >
              <Plus className="w-3.5 h-3.5" /> Add Patient
            </button>
          </GlassCard>
        ) : (
          <>
            {/* Stat strip — answers "who needs attention" before scrolling the table */}
            <div className="grid grid-cols-2 gap-3 mb-5 lg:grid-cols-4">
              <StatCard title="Total Patients" value={stats.total} icon={Users} />
              <StatCard title="High / Critical Risk" value={stats.highRisk} icon={ShieldAlert} color={stats.highRisk > 0 ? "var(--risk-high)" : undefined} />
              <StatCard title="Overdue Follow-ups" value={stats.overdue} icon={CalendarClock} color={stats.overdue > 0 ? "var(--risk-critical)" : undefined} />
              <StatCard title="Open Alerts" value={stats.openAlerts} icon={AlertTriangle} color={stats.openAlerts > 0 ? "var(--risk-critical)" : undefined} />
            </div>

            {/* Search + filters */}
            <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, phone, or condition…"
                  className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg pl-9 pr-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
                />
              </div>
              <select
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value as "all" | RiskLevel)}
                className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
              >
                <option value="all">All risk levels</option>
                {RISK_LEVELS.map((level) => (
                  <option key={level} value={level}>{level[0]!.toUpperCase() + level.slice(1)}</option>
                ))}
              </select>
              <button
                onClick={() => setOnlyWithAlerts((v) => !v)}
                className={`flex items-center justify-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg border text-[12.5px] font-semibold transition-all ${
                  onlyWithAlerts
                    ? "bg-red-500/15 border-red-500/30 text-red-400"
                    : "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" /> Open alerts only
              </button>
            </div>

            {/* Table */}
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-[var(--color-bg-surface)] border-b border-[var(--color-border-subtle)] text-[10.5px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
                    <tr>
                      <SortableTh label="Patient" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                      <th className="px-4 py-3">Condition</th>
                      <SortableTh label="Risk" active={sortKey === "risk"} dir={sortDir} onClick={() => toggleSort("risk")} />
                      <th className="px-4 py-3">Agent</th>
                      <SortableTh label="Last Call" active={sortKey === "lastCall"} dir={sortDir} onClick={() => toggleSort("lastCall")} />
                      <SortableTh label="Next Follow-up" active={sortKey === "nextFollowUp"} dir={sortDir} onClick={() => toggleSort("nextFollowUp")} />
                      <SortableTh label="Alerts" active={sortKey === "alerts"} dir={sortDir} onClick={() => toggleSort("alerts")} />
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {rows.map((p) => {
                      const agent = agents.find((a) => a.id === p.assignedAgentId);
                      const lastCall = callsByPatient[p.id]?.[0];
                      const nextTask = nextFollowUp(p.id);
                      const overdue = !!nextTask && nextTask.nextAttemptAt < Date.now();
                      const alertCount = alertsByPatient[p.id]?.length ?? 0;
                      return (
                        <tr key={p.id} className="hover:bg-[var(--color-bg-surface)] transition-colors">
                          <td className="px-4 py-3">
                            <Link href={`/admin/patients/${p.id}`} className="flex items-center gap-2.5 min-w-0 group">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center font-semibold text-[12px] flex-none"
                                style={{ backgroundColor: `color-mix(in oklab, ${riskColor(p.riskLevel)} 18%, transparent)`, color: riskColor(p.riskLevel) }}
                              >
                                {p.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-[var(--color-text-primary)] group-hover:underline truncate">{p.name}</span>
                                  {p.doNotContact && (
                                    <span className="rounded-md border border-red-500/25 bg-red-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-red-400 flex-none">
                                      DNC
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-[var(--color-text-muted)] font-mono truncate">{p.phone}</div>
                              </div>
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-[var(--color-text-secondary)]">{p.condition || "—"}</td>
                          <td className="px-4 py-3">
                            <button onClick={() => setEditTarget(p)} className="flex items-center gap-1.5 group/risk">
                              <RiskBadge level={p.riskLevel} />
                              <Pencil className="w-3 h-3 text-[var(--color-text-muted)] opacity-0 group-hover/risk:opacity-100 transition-opacity" />
                            </button>
                          </td>
                          <td className="px-4 py-3 text-[var(--color-text-secondary)]">{agent?.name ?? "Unassigned"}</td>
                          <td className="px-4 py-3">
                            {lastCall ? (
                              <div className="flex items-center gap-1.5">
                                <span className={`h-1.5 w-1.5 rounded-full flex-none ${lastCall.status === "completed" ? "bg-[var(--risk-low)]" : "bg-[var(--color-text-muted)]"}`} />
                                <span className="text-[12.5px] text-[var(--color-text-secondary)]">{new Date(lastCall.startedAt).toLocaleDateString()}</span>
                              </div>
                            ) : (
                              <span className="text-[var(--color-text-muted)]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {nextTask ? (
                              <span className={`text-[12.5px] ${overdue ? "text-[var(--risk-critical)] font-semibold" : "text-[var(--color-text-secondary)]"}`}>
                                {overdue ? "Overdue · " : ""}{new Date(nextTask.nextAttemptAt).toLocaleDateString()}
                              </span>
                            ) : (
                              <span className="text-[var(--color-text-muted)]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {alertCount > 0 ? (
                              <span className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-[11px] font-bold font-mono">
                                {alertCount}
                              </span>
                            ) : (
                              <span className="text-[var(--color-text-muted)]">0</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {!p.doNotContact && (
                                <>
                                  <button
                                    onClick={() => openCallModal(p)}
                                    title="Call now"
                                    className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition-all"
                                  >
                                    <Phone className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => openScheduleModal(p)}
                                    title="Schedule follow-up"
                                    className="p-2 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all"
                                  >
                                    <CalendarClock className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              <Link
                                href={`/admin/patients/${p.id}`}
                                title="View patient"
                                className="p-2 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-6 py-10 text-center text-[var(--color-text-muted)]">
                          <FileText className="w-6 h-6 mx-auto mb-2 opacity-40" />
                          No patients match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Agent-selection modal — always prompted, every time */}
      <Dialog
        open={!!callTarget}
        onClose={() => setCallTarget(null)}
        title={`Call ${callTarget?.name ?? ""}`}
        subtitle={callTarget?.phone}
        size="sm"
        footer={
          <>
            <button
              onClick={() => setCallTarget(null)}
              className="px-4 py-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmCall}
              disabled={!callAgentId || calling}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-white text-[13px] font-semibold hover:brightness-110 disabled:opacity-40 transition-all"
            >
              {calling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />}
              Call Now
            </button>
          </>
        }
      >
        <label htmlFor="call-agent" className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Agent</label>
        <select
          id="call-agent"
          value={callAgentId}
          onChange={(e) => setCallAgentId(e.target.value)}
          className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
        >
          <option value="">Select an agent…</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        {callMessage && <p role="alert" className="text-[12px] text-red-400 mt-3">{callMessage}</p>}
      </Dialog>

      {/* Schedule-a-follow-up modal */}
      <Dialog
        open={!!scheduleTarget}
        onClose={() => setScheduleTarget(null)}
        title={`Schedule a follow-up for ${scheduleTarget?.name ?? ""}`}
        subtitle={scheduleTarget?.phone}
        footer={
          <>
            <button
              onClick={() => setScheduleTarget(null)}
              className="px-4 py-2.5 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[14px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmSchedule}
              disabled={scheduling || (scheduleMode === "programme" ? !selectedProgrammeId || rangeValue.days.length === 0 : rangeValue.days.length === 0 || !scheduleAgentId)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-accent-violet)] text-white text-[14px] font-semibold hover:brightness-110 disabled:opacity-40 transition-all"
            >
              {scheduling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
              {scheduleMode === "programme" ? "Enroll" : "Schedule"}
            </button>
          </>
        }
      >
        {scheduleTarget && (
          <>
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

            {scheduleMessage && <p role="alert" className="text-[13px] text-red-400">{scheduleMessage}</p>}
          </>
        )}
      </Dialog>

      <EditRiskDialog
        patient={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={(updated) => {
          setPatients((prev) => prev?.map((p) => (p.id === updated.id ? { ...p, condition: updated.condition, riskLevel: updated.riskLevel } : p)) ?? prev);
        }}
      />
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }: { title: string; value: number; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color?: string }) {
  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-xl p-4 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] flex-none">
        <Icon className="w-4 h-4" style={{ color: color ?? "var(--color-accent-cyan)" }} />
      </div>
      <div className="min-w-0">
        <p className="text-[10.5px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] truncate">{title}</p>
        <p className="text-[20px] font-bold" style={{ color: color ?? "var(--color-text-primary)" }}>{value}</p>
      </div>
    </div>
  );
}

function SortableTh({ label, active, dir, onClick }: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void }) {
  return (
    <th className="px-4 py-3">
      <button onClick={onClick} className={`flex items-center gap-1 transition-colors ${active ? "text-[var(--color-text-primary)]" : "hover:text-[var(--color-text-secondary)]"}`}>
        {label}
        {active ? (dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
      </button>
    </th>
  );
}
