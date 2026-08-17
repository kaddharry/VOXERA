"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Megaphone, Plus, ArrowLeft, PhoneCall, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { GlassCard } from "@/app/_components/GlassCard";

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
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  const recipients = useMemo(
    () => recipientsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
    [recipientsText]
  );

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
      setView("list");
      loadCampaigns();
      setSelectedId(data.campaign.id);
    } catch (err: any) {
      setFormError(err.message || "Failed to create campaign");
    } finally {
      setSubmitting(false);
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

        <header className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]">{c.name}</h1>
            <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
              Started {new Date(c.createdAt).toLocaleString()}
            </p>
          </div>
          <StatusBadge status={c.status} />
        </header>

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
              <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
                Recipients <span className="text-[var(--color-text-muted)] font-normal normal-case">— one per line or comma-separated, E.164 format</span>
              </label>
              <textarea
                value={recipientsText}
                onChange={(e) => setRecipientsText(e.target.value)}
                rows={8}
                required
                className="w-full px-4 py-3 bg-white/[0.04] border border-[var(--color-border-subtle)] rounded-xl focus:ring-1 focus:ring-[var(--color-accent-cyan)] focus:border-[var(--color-accent-cyan)] text-[13px] font-mono text-[var(--color-text-primary)] transition-colors placeholder:text-[var(--color-text-muted)] resize-none"
                placeholder={"+15551234567\n+15559876543"}
              />
              <span className="text-[11px] text-[var(--color-text-muted)] mt-1 block">{recipients.length} recipient{recipients.length === 1 ? "" : "s"}</span>
            </div>

            {formError && <p className="text-[13px] text-red-400">{formError}</p>}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting}
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
