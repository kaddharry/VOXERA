"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Megaphone, Plus, ArrowLeft, PhoneCall, CheckCircle2, XCircle, Clock, Loader2, PhoneOff, Trash2, RotateCcw, X } from "lucide-react";
import { GlassCard } from "@/app/_components/GlassCard";
import { PhoneInput } from "@/app/_components/PhoneInput";

interface Campaign {
  id: string;
  name: string;
  status: "pending" | "running" | "completed";
  totalRecipients: number;
  completedCount: number;
  failedCount: number;
  agentId: string | null;
  createdAt: number;
  completedAt: number | null;
}

interface CampaignCall {
  id: number;
  phoneNumber: string;
  status: "pending" | "calling" | "completed" | "failed";
  callSid: string | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

interface AgentOption {
  id: string;
  name: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-white/10 text-[var(--color-text-secondary)] border border-white/10",
  running: "bg-[var(--console-cyan)]/15 text-[var(--console-cyan)] border border-[var(--console-cyan)]/30",
  calling: "bg-[var(--console-cyan)]/15 text-[var(--console-cyan)] border border-[var(--console-cyan)]/30",
  completed: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border border-red-500/30",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider ${STATUS_STYLES[status] ?? STATUS_STYLES.pending}`}>
      {(status === "running" || status === "calling") && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {status === "completed" && <CheckCircle2 className="w-2.5 h-2.5" />}
      {status === "failed" && <XCircle className="w-2.5 h-2.5" />}
      {status === "pending" && <Clock className="w-2.5 h-2.5" />}
      {status}
    </span>
  );
}

export default function CampaignsPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ campaign: Campaign; calls: CampaignCall[] } | null>(null);

  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [recipientDraft, setRecipientDraft] = useState("");
  const [recipientList, setRecipientList] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [killing, setKilling] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showRecall, setShowRecall] = useState(false);
  const [recallAgentId, setRecallAgentId] = useState("");
  const [recalling, setRecalling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadCampaigns = () => {
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((d) => setCampaigns(d.campaigns ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCampaigns();
    fetch("/api/admin/agents")
      .then((r) => r.json())
      .then((d) => setAgents((d.agents ?? []).map((a: any) => ({ id: a.id, name: a.name }))))
      .catch(() => {});
  }, []);

  const loadDetail = (id: string) => {
    fetch(`/api/campaigns/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.campaign) setDetail(d);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!selectedId) return;
    loadDetail(selectedId);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      loadDetail(selectedId);
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedId]);

  // Stop polling once the campaign reaches a terminal state
  useEffect(() => {
    if (detail?.campaign.status === "completed" && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [detail?.campaign.status]);

  const recipients = useMemo(() => {
    const fromText = recipientsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    return Array.from(new Set([...recipientList, ...fromText]));
  }, [recipientsText, recipientList]);

  function addRecipient() {
    if (!recipientDraft) return;
    setRecipientList((list) => (list.includes(recipientDraft) ? list : [...list, recipientDraft]));
    setRecipientDraft("");
  }

  function removeRecipient(num: string) {
    setRecipientList((list) => list.filter((n) => n !== num));
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, agentId: agentId || undefined, recipients }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create campaign");
      setName("");
      setAgentId("");
      setRecipientsText("");
      setRecipientList([]);
      setView("list");
      loadCampaigns();
      setSelectedId(data.campaign.id);
    } catch (err: any) {
      setFormError(err.message || "Failed to create campaign");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKill = async () => {
    if (!selectedId) return;
    setKilling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/campaigns/${selectedId}/kill`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to kill campaign");
      loadDetail(selectedId);
    } catch (err: any) {
      setActionError(err.message || "Failed to kill campaign");
    } finally {
      setKilling(false);
    }
  };

  const handleClear = async () => {
    if (!selectedId) return;
    setClearing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/campaigns/${selectedId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to clear history");
      setSelectedId(null);
      setDetail(null);
      loadCampaigns();
    } catch (err: any) {
      setActionError(err.message || "Failed to clear history");
    } finally {
      setClearing(false);
    }
  };

  const handleRecall = async () => {
    if (!selectedId || !recallAgentId) return;
    setRecalling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/campaigns/${selectedId}/recall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: recallAgentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to re-call campaign");
      setShowRecall(false);
      setRecallAgentId("");
      loadDetail(selectedId);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => loadDetail(selectedId), 3000);
    } catch (err: any) {
      setActionError(err.message || "Failed to re-call campaign");
    } finally {
      setRecalling(false);
    }
  };

  if (selectedId && detail) {
    const c = detail.campaign;
    const progress = c.totalRecipients > 0 ? Math.round(((c.completedCount + c.failedCount) / c.totalRecipients) * 100) : 0;
    return (
      <div className="p-6 md:p-10 font-body min-h-screen">
        <button
          onClick={() => { setSelectedId(null); setDetail(null); }}
          className="flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to campaigns
        </button>

        <header className="mb-4 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]">{c.name}</h1>
            <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
              Started {new Date(c.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={c.status} />
            {(c.status === "pending" || c.status === "running") && (
              <button
                onClick={handleKill}
                disabled={killing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-[12px] font-semibold hover:bg-red-500/20 disabled:opacity-40 transition-colors"
              >
                {killing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneOff className="w-3.5 h-3.5" />}
                Kill Call
              </button>
            )}
            <button
              onClick={() => setShowRecall(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] text-[12px] font-semibold hover:text-[var(--color-text-primary)] hover:bg-white/[0.08] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Re-call
            </button>
            <button
              onClick={handleClear}
              disabled={clearing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] text-[12px] font-semibold hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
            >
              {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Clear History
            </button>
          </div>
        </header>

        {actionError && <p className="text-[13px] text-red-400 mb-4">{actionError}</p>}

        {showRecall && (
          <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
            <GlassCard className="p-6 w-full max-w-sm">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Re-call this campaign</h3>
                <button onClick={() => setShowRecall(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[12px] text-[var(--color-text-muted)] mb-4">
                Dials the same {c.totalRecipients} recipient{c.totalRecipients === 1 ? "" : "s"} again, fresh history.
              </p>
              <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Agent</label>
              <select
                value={recallAgentId}
                onChange={(e) => setRecallAgentId(e.target.value)}
                className="w-full bg-white/[0.04] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-cyan)]/50 mb-4"
              >
                <option value="">Select an agent…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowRecall(false)}
                  className="flex-1 px-4 py-2 rounded-lg bg-white/[0.05] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRecall}
                  disabled={!recallAgentId || recalling}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent-cyan)] text-[#0A0C14] text-[13px] font-semibold hover:brightness-110 disabled:opacity-40 transition-all"
                >
                  {recalling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  Start
                </button>
              </div>
            </GlassCard>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <GlassCard className="p-4">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1.5">Total</span>
            <span className="font-mono text-xl font-extrabold text-[var(--color-text-primary)] tabular-nums">{c.totalRecipients}</span>
          </GlassCard>
          <GlassCard className="p-4">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1.5">Completed</span>
            <span className="font-mono text-xl font-extrabold text-emerald-400 tabular-nums">{c.completedCount}</span>
          </GlassCard>
          <GlassCard className="p-4">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1.5">Failed</span>
            <span className="font-mono text-xl font-extrabold text-red-400 tabular-nums">{c.failedCount}</span>
          </GlassCard>
          <GlassCard className="p-4">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1.5">Progress</span>
            <span className="font-mono text-xl font-extrabold text-[var(--console-cyan)] tabular-nums">{progress}%</span>
          </GlassCard>
        </div>

        <GlassCard className="p-6">
          <h2 className="text-[13px] font-bold text-[var(--color-text-primary)] mb-4">Recipients</h2>
          <div className="max-h-[500px] overflow-y-auto space-y-2 pr-1">
            {detail.calls.map((call) => (
              <div key={call.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white/[0.03] border border-[var(--color-border-subtle)]">
                <span className="font-mono text-[13px] text-[var(--color-text-primary)]">{call.phoneNumber}</span>
                <div className="flex items-center gap-3">
                  {call.error && <span className="text-[11px] text-red-400 max-w-[240px] truncate" title={call.error}>{call.error}</span>}
                  <StatusBadge status={call.status} />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 font-body min-h-screen">
      <header className="mb-8 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)] flex items-center gap-3">
            <Megaphone className="w-8 h-8 text-[var(--color-accent-cyan)]" />
            Bulk Calls
          </h1>
          <p className="text-[15px] text-[var(--color-text-secondary)] mt-2 max-w-xl">
            Dial a list of recipients with a chosen agent and track results as they come in.
          </p>
        </div>
        {view === "list" && (
          <button
            onClick={() => setView("create")}
            className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-white btn-gradient rounded-xl transition-all hover:scale-[1.02]"
          >
            <Plus className="w-4 h-4" /> New Campaign
          </button>
        )}
      </header>

      {view === "create" ? (
        <GlassCard className="p-6 md:p-8 max-w-2xl">
          <form onSubmit={handleCreate} className="space-y-5">
            <div>
              <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">Campaign Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-white/[0.04] border border-[var(--color-border-subtle)] rounded-xl focus:ring-1 focus:ring-[var(--color-accent-cyan)] focus:border-[var(--color-accent-cyan)] text-[14px] text-[var(--color-text-primary)] transition-colors placeholder:text-[var(--color-text-muted)]"
                placeholder="e.g. October Reservation Reminders"
              />
            </div>

            <div>
              <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">Agent</label>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="w-full px-4 py-2.5 bg-white/[0.04] border border-[var(--color-border-subtle)] rounded-xl text-[14px] text-[var(--color-text-primary)] focus:ring-1 focus:ring-[var(--color-accent-cyan)]"
              >
                <option value="">Default agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">Recipients</label>
              <div className="flex items-center gap-2 mb-3">
                <PhoneInput value={recipientDraft} onChange={setRecipientDraft} className="flex-1" />
                <button
                  type="button"
                  onClick={addRecipient}
                  disabled={!recipientDraft}
                  className="px-3.5 py-2 rounded-lg bg-white/[0.06] border border-[var(--color-border-subtle)] text-[13px] font-semibold text-[var(--color-text-primary)] hover:bg-white/[0.1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-none"
                >
                  Add
                </button>
              </div>
              {recipientList.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {recipientList.map((num) => (
                    <span
                      key={num}
                      className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-md bg-white/[0.05] border border-[var(--color-border-subtle)] text-[12px] font-mono text-[var(--color-text-primary)]"
                    >
                      {num}
                      <button type="button" onClick={() => removeRecipient(num)} className="text-[var(--color-text-muted)] hover:text-red-400 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <details className="text-[12px]">
                <summary className="text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text-secondary)] transition-colors">
                  Or paste a list (one per line or comma-separated, E.164 format)
                </summary>
                <textarea
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                  rows={5}
                  className="w-full mt-2 px-4 py-3 bg-white/[0.04] border border-[var(--color-border-subtle)] rounded-xl focus:ring-1 focus:ring-[var(--color-accent-cyan)] focus:border-[var(--color-accent-cyan)] text-[13px] font-mono text-[var(--color-text-primary)] transition-colors placeholder:text-[var(--color-text-muted)] resize-none"
                  placeholder={"+15551234567\n+15559876543"}
                />
              </details>
              <span className="text-[11px] text-[var(--color-text-muted)] mt-2 block">{recipients.length} recipient{recipients.length === 1 ? "" : "s"}</span>
            </div>

            {formError && <p className="text-[13px] text-red-400">{formError}</p>}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting || recipients.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 text-[14px] font-semibold text-white btn-gradient rounded-xl transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
              >
                <PhoneCall className="w-4 h-4" />
                {submitting ? "Starting..." : "Start Campaign"}
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                className="px-5 py-2.5 text-[14px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </GlassCard>
      ) : loading ? (
        <p className="text-[var(--color-text-muted)] text-[13px] animate-pulse">Loading campaigns...</p>
      ) : campaigns.length === 0 ? (
        <GlassCard className="flex flex-col items-center justify-center h-64 text-center px-6">
          <Megaphone className="w-8 h-8 text-[var(--color-text-muted)] mb-3" />
          <p className="text-[var(--color-text-secondary)] text-[14px]">No campaigns yet. Start your first bulk-calling campaign.</p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="text-left"
            >
              <GlassCard className="p-5 h-full hover:border-[var(--color-border-active)] transition-colors">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="text-[14px] font-bold text-[var(--color-text-primary)] leading-tight">{c.name}</h3>
                  <StatusBadge status={c.status} />
                </div>
                <div className="flex items-center gap-3 text-[12px] text-[var(--color-text-muted)] mb-3">
                  <span className="font-mono">{c.completedCount + c.failedCount}/{c.totalRecipients} dialed</span>
                  {c.failedCount > 0 && <span className="text-red-400 font-mono">{c.failedCount} failed</span>}
                </div>
                <span className="text-[11px] text-[var(--color-text-muted)]">{new Date(c.createdAt).toLocaleString()}</span>
              </GlassCard>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
