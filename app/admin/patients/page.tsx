"use client";

import { useEffect, useState } from "react";
import { UserCheck, Plus, Phone, Loader2, X, Upload, FileText } from "lucide-react";
import { GlassCard } from "../../_components/GlassCard";
import { PhoneInput } from "../../_components/PhoneInput";

interface Patient {
  id: string;
  name: string;
  phone: string;
  notes: string;
  assignedAgentId: string | null;
  createdAt: number;
}

interface Agent {
  id: string;
  name: string;
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
  }, []);

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
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-[var(--color-accent-violet)]/10 border border-[var(--color-accent-violet)]/25 rounded-xl text-[var(--color-accent-violet)]">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">Patients</h1>
            <p className="text-[12.5px] text-[var(--color-text-muted)]">
              Each patient gets their own knowledge base — call them, watch it live on the Live Dashboard.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--color-accent-violet)] text-[#0A0C14] text-[13px] font-semibold hover:brightness-110 transition-all"
        >
          {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAdd ? "Cancel" : "Add Patient"}
        </button>
      </div>

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
              Additional context (optional — combined with the uploaded file, if any)
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
          {patients.map((p) => (
            <GlassCard key={p.id} className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[var(--color-accent-violet)]/15 text-[var(--color-accent-violet)] flex items-center justify-center font-semibold text-[14px] flex-none">
                {p.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">{p.name}</div>
                <div className="text-[11.5px] text-[var(--color-text-muted)] font-mono">{p.phone}</div>
                {p.notes && (
                  <div className="text-[11px] text-[var(--color-text-muted)] truncate max-w-md mt-0.5 flex items-center gap-1">
                    <FileText className="w-3 h-3 flex-none" /> {p.notes.slice(0, 80)}
                  </div>
                )}
              </div>
              <button
                onClick={() => openCallModal(p)}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[12.5px] font-semibold hover:bg-emerald-500/25 transition-all flex-none"
              >
                <Phone className="w-3.5 h-3.5" /> Call
              </button>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Agent-selection modal — always prompted, every time */}
      {callTarget && (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
          <GlassCard className="p-6 w-full max-w-sm">
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
          </GlassCard>
        </div>
      )}
    </div>
  );
}
