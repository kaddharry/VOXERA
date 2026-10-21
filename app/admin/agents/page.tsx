"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Plus,
  Trash2,
  ExternalLink,
  Loader2,
  Check,
  MessageSquare,
  Search,
  Sparkles,
  Wand2,
  PenLine,
  AlertCircle,
} from "lucide-react";
import { CreateAgentDialog } from "./CreateAgentDialog";
import { BLANK_DRAFT, type Agent, type Draft, type GeneratedAgentDraft } from "./types";
import { VoicePicker } from "./VoicePicker";
import { KnowledgeTab } from "./KnowledgeTab";

type Tab = "persona" | "prompt" | "knowledge";
type PromptMode = "manual" | "ai";

const AVATAR_COLORS = [
  "bg-violet-500/15 text-violet-500",
  "bg-cyan-500/15 text-cyan-500",
  "bg-emerald-500/15 text-emerald-500",
  "bg-amber-500/15 text-amber-500",
  "bg-pink-500/15 text-pink-500",
  "bg-blue-500/15 text-blue-500",
];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AgentBuilderPage() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);
  const [tab, setTab] = useState<Tab>("persona");

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [promptMode, setPromptMode] = useState<PromptMode>("manual");
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = () => {
    fetch("/api/admin/agents")
      .then((r) => r.json())
      .then((data: { agents?: Agent[]; error?: string }) => {
        if (data.error) {
          setError(data.error);
          setAgents([]);
        } else {
          setAgents(data.agents ?? []);
        }
      })
      .catch(() => {
        setError("Couldn't load agents.");
        setAgents([]);
      });
  };

  useEffect(() => {
    loadAgents();
  }, []);

  const filteredAgents = useMemo(() => {
    if (!agents) return null;
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) => a.name.toLowerCase().includes(q) || (a.description ?? "").toLowerCase().includes(q)
    );
  }, [agents, search]);

  const resetEditorExtras = () => {
    setTab("persona");
    setPromptMode("manual");
    setPromptError(null);
    setError(null);
  };

  const selectAgent = (agent: Agent) => {
    setSelectedId(agent.id);
    resetEditorExtras();
    setDraft({
      name: agent.name,
      description: agent.description ?? "",
      system_prompt: agent.system_prompt ?? "",
      greeting: agent.greeting ?? "",
      voice_persona: agent.voice_persona ?? "female-friendly",
    });
  };

  const startManual = () => {
    setShowCreateDialog(false);
    setSelectedId("new");
    resetEditorExtras();
    setDraft(BLANK_DRAFT);
  };

  const startFromGenerated = (generated: GeneratedAgentDraft) => {
    setShowCreateDialog(false);
    setSelectedId("new");
    resetEditorExtras();
    setDraft({
      name: generated.name,
      description: generated.description,
      system_prompt: generated.system_prompt,
      greeting: generated.greeting,
      voice_persona: "female-friendly",
    });
  };

  const generatePrompt = async () => {
    if (!draft.name.trim()) {
      setPromptError("Give the agent a name first — it helps write a better prompt.");
      return;
    }
    setGeneratingPrompt(true);
    setPromptError(null);
    try {
      const res = await fetch("/api/onboarding/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName: draft.name, description: draft.description || draft.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate a prompt.");
      setDraft((d) => ({ ...d, system_prompt: data.prompt }));
    } catch (e) {
      setPromptError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingPrompt(false);
    }
  };

  const handleSave = async () => {
    if (!draft.name.trim()) {
      setTab("persona");
      setError("Give the agent a name first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isNew = selectedId === "new";
      const res = await fetch(isNew ? "/api/admin/agents" : `/api/admin/agents/${selectedId}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");

      loadAgents();
      setSelectedId(data.agent.id);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, opts?: { fromList?: boolean }) => {
    if (!confirm("Delete this agent? This can't be undone.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/agents/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      if (!opts?.fromList || selectedId === id) {
        setSelectedId(null);
        setDraft(BLANK_DRAFT);
      }
      loadAgents();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  };

  const isEditing = selectedId !== null;
  const isNewAgent = selectedId === "new";

  return (
    <div className="flex h-full flex-col font-body">
      {/* Compact single-line title — matches the rest of the admin shell;
          the breadcrumb above already names this page. */}
      <header className="flex flex-none items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-6 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[var(--color-accent-cyan)]" />
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Agent Builder</span>
        </div>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="flex flex-none items-center gap-1.5 rounded-lg btn-gradient px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-all hover:scale-[1.02]"
        >
          <Plus className="h-3.5 w-3.5" /> New Agent
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_1fr]">
        {/* Agent list — its own scroll region, independent of the editor
            panel, so neither pushes the page itself into scrolling. */}
        <div className="flex min-h-0 flex-col border-r border-[var(--color-border-subtle)]">
          {agents !== null && agents.length > 3 && (
            <div className="relative flex-none p-3 pb-0">
              <Search className="w-3.5 h-3.5 absolute left-6 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agents…"
                className="w-full pl-8 pr-3 py-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg text-[12.5px] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-violet)]"
              />
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            {agents === null && (
              <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)] px-2 py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading agents…
              </div>
            )}
            {agents !== null && agents.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--color-border-subtle)] p-5 text-center text-[13px] text-[var(--color-text-secondary)]">
                No agents yet — create your first one.
              </div>
            )}
            {filteredAgents !== null && filteredAgents.length === 0 && agents && agents.length > 0 && (
              <div className="text-[12.5px] text-[var(--color-text-muted)] px-2 py-3">No agents match "{search}".</div>
            )}
            {filteredAgents?.map((a) => (
              <div
                key={a.id}
                className={`group relative rounded-xl border transition-all ${
                  selectedId === a.id
                    ? "border-[var(--color-border-active)] bg-[var(--color-bg-elevated)]"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:border-[var(--color-border-active)]"
                }`}
              >
                <button onClick={() => selectAgent(a)} className="w-full text-left px-3.5 py-3 flex items-start gap-3">
                  <span
                    className={`flex-none w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold ${avatarColor(a.id)}`}
                  >
                    {a.name.charAt(0).toUpperCase() || "A"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <div className="font-semibold text-[13.5px] text-[var(--color-text-primary)] truncate pr-5">{a.name}</div>
                    {a.description && (
                      <div className="text-[11.5px] text-[var(--color-text-muted)] mt-0.5 line-clamp-2">{a.description}</div>
                    )}
                    <div className="text-[10px] font-mono uppercase tracking-wide text-[var(--color-text-muted)] mt-1">
                      Updated {timeAgo(a.updated_at)}
                    </div>
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(a.id, { fromList: true });
                  }}
                  disabled={deleting === a.id}
                  title="Delete agent"
                  className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)] hover:text-red-400 transition-opacity disabled:opacity-50"
                >
                  {deleting === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className="flex min-h-0 flex-col">
          {!isEditing ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <Bot className="w-8 h-8 text-[var(--color-text-muted)]" />
              <p className="text-[14px] text-[var(--color-text-secondary)] max-w-sm">
                Select an agent to edit it, or create a new one — describe it and let AI draft it, or
                build it yourself from scratch.
              </p>
            </div>
          ) : (
            <>
              {/* Pinned header: name + quick actions */}
              <div className="flex flex-none flex-col sm:flex-row sm:items-center gap-3 px-6 py-3 border-b border-[var(--color-border-subtle)]">
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Untitled Agent"
                  className="flex-1 min-w-0 bg-transparent border-0 focus:outline-none text-[16px] font-semibold text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
                />
                <div className="flex items-center gap-2 flex-none">
                  {!isNewAgent && (
                    <a
                      href={`/demo?agentId=${selectedId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--color-border-subtle)] text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Talk to Agent
                    </a>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-2 text-[12.5px] font-semibold text-white btn-gradient rounded-lg transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {isNewAgent ? "Create Agent" : "Save"}
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex flex-none items-center gap-1 px-6 pt-2 border-b border-[var(--color-border-subtle)]">
                {(["persona", "prompt", "knowledge"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-3.5 py-2 text-[13px] font-semibold capitalize border-b-2 transition-colors -mb-px ${
                      tab === t
                        ? "border-[var(--color-accent-violet)] text-[var(--color-text-primary)]"
                        : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {t === "persona" ? "Persona" : t === "prompt" ? "Prompt" : "Knowledge"}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-6 flex flex-col gap-6">
                {tab === "persona" && (
                  <>
                    <div>
                      <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
                        Description
                      </label>
                      <input
                        type="text"
                        value={draft.description}
                        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                        placeholder="Shown wherever this agent can be picked for testing or a call"
                        className="w-full px-4 py-3 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl focus:ring-1 focus:ring-[var(--color-accent-cyan)] focus:border-[var(--color-accent-cyan)] text-[14px] text-[var(--color-text-primary)] transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
                        Greeting
                      </label>
                      <input
                        type="text"
                        value={draft.greeting}
                        onChange={(e) => setDraft((d) => ({ ...d, greeting: e.target.value }))}
                        placeholder="Hey there! Thanks for calling — what can I help with today?"
                        className="w-full px-4 py-3 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl focus:ring-1 focus:ring-[var(--color-accent-cyan)] focus:border-[var(--color-accent-cyan)] text-[14px] text-[var(--color-text-primary)] transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
                        Voice
                      </label>
                      <p className="text-[12px] text-[var(--color-text-muted)] mb-2.5">
                        Deepgram Aura-2 — search by name, trait, or accent, and preview before you pick.
                      </p>
                      <VoicePicker
                        value={draft.voice_persona}
                        onChange={(id) => setDraft((d) => ({ ...d, voice_persona: id }))}
                      />
                    </div>
                  </>
                )}

                {tab === "knowledge" && (
                  <KnowledgeTab />
                )}

                {tab === "prompt" && (
                  <>
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-[var(--color-accent-cyan)]" />
                      <span className="text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                        System Prompt
                      </span>
                    </div>
                    <p className="text-[12.5px] text-[var(--color-text-muted)] -mt-4">
                      What this agent knows and how it should talk — layered on top of VOXERA's core
                      rules and emotion-aware persona, which always still apply (safety and escalation
                      behavior can't be overridden here).
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setPromptMode("manual")}
                        className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-[12.5px] font-semibold transition-all ${
                          promptMode === "manual"
                            ? "border-[var(--color-border-active)] bg-[var(--color-bg-base)] text-[var(--color-text-primary)]"
                            : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)]"
                        }`}
                      >
                        <PenLine className="w-3.5 h-3.5" /> Write it myself
                      </button>
                      <button
                        type="button"
                        onClick={() => setPromptMode("ai")}
                        className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-[12.5px] font-semibold transition-all ${
                          promptMode === "ai"
                            ? "border-[var(--color-border-active)] bg-[var(--color-bg-base)] text-[var(--color-text-primary)]"
                            : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)]"
                        }`}
                      >
                        <Wand2 className="w-3.5 h-3.5" /> Generate with AI
                      </button>
                    </div>

                    {promptMode === "ai" && (
                      <button
                        type="button"
                        onClick={generatePrompt}
                        disabled={generatingPrompt}
                        className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl btn-gradient text-white text-[13px] font-semibold shadow-[0_0_15px_var(--color-accent-glow)] transition-all hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100"
                      >
                        {generatingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {generatingPrompt
                          ? "Writing…"
                          : draft.system_prompt
                            ? "Regenerate prompt"
                            : "Generate prompt from description"}
                      </button>
                    )}

                    {promptError && (
                      <p className="text-[13px] text-red-500 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4 flex-none" /> {promptError}
                      </p>
                    )}

                    <textarea
                      value={draft.system_prompt}
                      onChange={(e) => setDraft((d) => ({ ...d, system_prompt: e.target.value }))}
                      rows={10}
                      placeholder="You are Bella, the concierge for a boutique hotel called Hotel Paradise. You're warm, a little playful, and always mention that checkout is at noon if someone asks about their stay..."
                      className="w-full px-4 py-3 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl focus:ring-1 focus:ring-[var(--color-accent-cyan)] focus:border-[var(--color-accent-cyan)] text-[13.5px] text-[var(--color-text-primary)] transition-colors resize-none"
                    />
                    <p className="text-[12px] text-[var(--color-text-muted)] -mt-4">
                      Fully editable, however it was written — tweak anything before saving.
                    </p>
                  </>
                )}

                {error && (
                  <div className="rounded-xl bg-red-950/10 border border-red-500/30 text-[13px] text-red-500 px-4 py-3">
                    {error}
                  </div>
                )}

                <div className="flex items-center gap-4 pt-2 border-t border-[var(--color-border-subtle)]">
                  {!isNewAgent && (
                    <button
                      onClick={() => handleDelete(selectedId as string)}
                      disabled={deleting === selectedId}
                      className="flex items-center gap-2 text-[13px] font-semibold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  )}
                  {saved && (
                    <span className="flex items-center gap-1 text-[13px] text-emerald-400 font-medium font-mono ml-auto">
                      <Check className="w-4 h-4" /> Saved
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showCreateDialog && (
        <CreateAgentDialog
          onClose={() => setShowCreateDialog(false)}
          onManual={startManual}
          onGenerated={startFromGenerated}
        />
      )}
    </div>
  );
}
