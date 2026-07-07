"use client";

import { useState } from "react";
import { 
  Search, 
  Clock, 
  Info, 
  Calendar, 
  Heart, 
  Layers, 
  Sparkles, 
  ChevronRight, 
  AlertCircle,
  HelpCircle,
  Database
} from "lucide-react";

interface MemoryRecord {
  id: string;
  tier: "STM" | "MTM" | "LTM_user" | "LTM_client";
  userId: string;
  clientId: string;
  ts: number;
  text: string;
  summary: string;
  topic: string;
  emotion: string;
  importance: number;
  importance_score: number;
  retrieval_count: number;
  last_retrieved_at?: number;
}

interface RetrievalExplanation {
  memoryId: string;
  reason: string;
  metrics: {
    similarity: number;
    importance: number;
    recency: number;
    retrievalFrequency: number;
    rawScore: number;
  };
}

interface TimelineEvent {
  id: string;
  topic: string;
  startDate: number;
  endDate: number;
  memories: MemoryRecord[];
  summary: string;
}

interface DebugResult {
  stm: any[];
  mtm: MemoryRecord[];
  ltmUser: MemoryRecord[];
  ltmClient: MemoryRecord[];
  scores: Array<{ id: string; score: number }>;
  explanations?: Record<string, RetrievalExplanation>;
  timeline?: TimelineEvent[];
}

export default function RagDebuggerPage() {
  const [queryText, setQueryText] = useState("");
  const [userId, setUserId] = useState("user_42");
  const [emotionLabel, setEmotionLabel] = useState("neutral");
  const [intensity, setIntensity] = useState(0.2);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DebugResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"timeline" | "memories" | "metrics">("timeline");

  const runDebugQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryText.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/rag-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queryText,
          userId,
          emotionLabel,
          intensity,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "RAG retrieval failed");
      setResult(data.retrieved);
    } catch (err: any) {
      setError(err.message ?? "Unknown error occurred");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const getTierBadgeColor = (tier: string) => {
    switch (tier) {
      case "LTM_client": return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "LTM_user": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "MTM": return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
      default: return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
    }
  };

  return (
    <div className="min-h-screen p-6 md:p-10 font-body text-[var(--color-text-primary)]">
      <header className="mb-10">
        <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-gradient flex items-center gap-3">
          <Database className="w-8 h-8 text-[var(--color-accent-cyan)]" />
          RAG Explainability Debugger
        </h1>
        <p className="text-[var(--color-text-secondary)] mt-2 text-[15px]">
          Evaluate memory retrieval logic, inspect dynamic decay, view chronological event grouping, and audit selections.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Input Panel */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 shadow-lg">
            <h2 className="text-[11px] font-mono font-bold text-[var(--color-text-secondary)] uppercase tracking-widest mb-4">
              Query Settings
            </h2>
            <form onSubmit={runDebugQuery} className="space-y-4">
              <div>
                <label className="block text-[11px] font-mono font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                  Test Query / Turn Text
                </label>
                <textarea
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  placeholder="e.g. My call drops whenever I enter my basement, and I want service credit"
                  rows={4}
                  className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-border-active)] focus:outline-none rounded-xl p-3 text-[14px] text-white placeholder-zinc-500 resize-none transition-all"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-mono font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                    Mock User ID
                  </label>
                  <input
                    type="text"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-border-active)] focus:outline-none rounded-xl px-3 py-2.5 text-[13px] text-white font-mono transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                    Mock Emotion
                  </label>
                  <select
                    value={emotionLabel}
                    onChange={(e) => setEmotionLabel(e.target.value)}
                    className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-border-active)] focus:outline-none rounded-xl px-3 py-2.5 text-[13px] text-white transition-all"
                  >
                    <option value="neutral">Neutral</option>
                    <option value="frustration">Frustration</option>
                    <option value="distress">Distress</option>
                    <option value="anger">Anger</option>
                    <option value="sadness">Sadness</option>
                    <option value="joy">Joy</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-mono font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Emotion Intensity
                  </label>
                  <span className="text-[11px] font-mono font-bold text-[var(--color-accent-cyan)]">
                    {intensity.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.1"
                  value={intensity}
                  onChange={(e) => setIntensity(parseFloat(e.target.value))}
                  className="w-full accent-[var(--color-accent-cyan)] cursor-pointer"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !queryText.trim()}
                className="w-full py-3 px-4 rounded-xl font-bold text-[14px] flex items-center justify-center gap-2 cursor-pointer transition-all bg-gradient-to-r from-[var(--color-accent-cyan)] to-[var(--color-accent-violet)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_20px_rgba(6,182,212,0.15)]"
              >
                <Search className="w-4 h-4" />
                {loading ? "Evaluating RAG..." : "Run Retrieval Evaluation"}
              </button>
            </form>
          </div>

          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-5 text-[12px] text-[var(--color-text-secondary)] space-y-3">
            <h3 className="font-bold text-[11px] font-mono uppercase tracking-wider text-[var(--color-text-primary)] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Dynamic Ranking Model
            </h3>
            <p>
              Retrieval uses the dynamic scoring equation:
            </p>
            <div className="bg-[var(--color-bg-base)] p-3 rounded-lg border border-[var(--color-border-subtle)] font-mono text-[10px] overflow-x-auto text-[var(--color-accent-cyan)]">
              Score = w_sem * Sem + w_emo * Emo + w_rec * Recency + w_imp * DecayedImp - w_stale * Stale - w_redund * Redundancy
            </div>
            <ul className="list-disc pl-4 space-y-1.5 text-[11px] text-[var(--color-text-muted)]">
              <li><strong>Adaptive Score decay:</strong> Static importance decays using a 7-day half-life since last retrieve/write.</li>
              <li><strong>Preservation floor:</strong> Long-term facts or critical keyword matches preserve high scores and resist decay.</li>
              <li><strong>Retrieve boost:</strong> Memory importance gets a logarithmic boost (+0.05 * ln(1 + count)) each time it is picked.</li>
            </ul>
          </div>
        </div>

        {/* Right Column: Results Display */}
        <div className="lg:col-span-8">
          {error && (
            <div className="bg-red-950/20 border border-red-900/50 text-red-400 p-6 rounded-2xl flex items-start gap-3 mb-6">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-[14px]">Evaluation Error</h3>
                <p className="text-[13px] mt-1">{error}</p>
              </div>
            </div>
          )}

          {!result && !loading && !error && (
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl flex flex-col items-center justify-center py-20 px-8 text-center">
              <Database className="w-12 h-12 text-[var(--color-text-muted)] mb-4 stroke-1 animate-pulse" />
              <h3 className="text-lg font-bold text-white mb-2">No Evaluation Results</h3>
              <p className="text-[14px] text-[var(--color-text-secondary)] max-w-md">
                Enter a search query in the settings panel and click "Run Retrieval Evaluation" to run the ranking and timeline engine.
              </p>
            </div>
          )}

          {loading && (
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl flex flex-col items-center justify-center py-20 px-8">
              <div className="w-10 h-10 border-4 border-[var(--color-border-subtle)] border-t-[var(--color-accent-cyan)] rounded-full animate-spin mb-4" />
              <p className="text-[14px] text-[var(--color-text-muted)] font-mono">Running pgvector matching & explainability calculations...</p>
            </div>
          )}

          {result && !loading && (
            <div className="space-y-6">
              {/* Tab Navigation */}
              <div className="flex border-b border-[var(--color-border-subtle)] gap-6">
                <button
                  onClick={() => setActiveTab("timeline")}
                  className={`pb-3 font-semibold text-[14px] relative transition-all cursor-pointer ${
                    activeTab === "timeline" ? "text-[var(--color-accent-cyan)] font-bold" : "text-[var(--color-text-muted)] hover:text-white"
                  }`}
                >
                  Timeline Events ({result.timeline?.length ?? 0})
                  {activeTab === "timeline" && (
                    <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[var(--color-accent-cyan)]" />
                  )}
                </button>
                <button
                  onClick={() => setActiveTab("memories")}
                  className={`pb-3 font-semibold text-[14px] relative transition-all cursor-pointer ${
                    activeTab === "memories" ? "text-[var(--color-accent-cyan)] font-bold" : "text-[var(--color-text-muted)] hover:text-white"
                  }`}
                >
                  Retrieved Memories ({result.mtm.length + result.ltmUser.length + result.ltmClient.length})
                  {activeTab === "memories" && (
                    <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[var(--color-accent-cyan)]" />
                  )}
                </button>
              </div>

              {/* TAB 1: Chronological Event Timeline */}
              {activeTab === "timeline" && (
                <div className="space-y-6">
                  {(!result.timeline || result.timeline.length === 0) ? (
                    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-8 text-center text-[var(--color-text-muted)] text-[14px] italic">
                      No user timeline events identified (requires MTM/LTM_user memories to match).
                    </div>
                  ) : (
                    <div className="relative pl-6 border-l border-zinc-800 space-y-8 py-2">
                      {result.timeline.map((evt) => {
                        const start = new Date(evt.startDate).toLocaleDateString();
                        const end = new Date(evt.endDate).toLocaleDateString();
                        const dateString = start === end ? start : `${start} - ${end}`;
                        
                        return (
                          <div key={evt.id} className="relative group">
                            {/* Dot on the timeline line */}
                            <div className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full bg-[var(--color-bg-base)] border-2 border-[var(--color-accent-cyan)] shadow-[0_0_8px_rgba(6,182,212,0.5)] group-hover:scale-110 transition-transform" />
                            
                            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] hover:border-[var(--color-border-active)] rounded-2xl p-5 transition-all shadow-md">
                              <div className="flex justify-between items-start gap-4 mb-3 flex-wrap">
                                <div>
                                  <span className="text-[10px] font-mono font-bold tracking-widest text-[var(--color-accent-cyan)] bg-[var(--color-accent-cyan)]/5 border border-[var(--color-accent-cyan)]/15 px-2 py-0.5 rounded-md uppercase">
                                    {evt.topic}
                                  </span>
                                  <h3 className="text-md font-bold mt-1 text-white">{evt.summary}</h3>
                                </div>
                                <span className="text-[11px] font-mono text-[var(--color-text-muted)] bg-[var(--color-bg-base)] px-2.5 py-1 rounded-md border border-[var(--color-border-subtle)] flex items-center gap-1.5">
                                  <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                                  {dateString}
                                </span>
                              </div>

                              <div className="space-y-3 mt-4 border-t border-zinc-800/50 pt-4">
                                {evt.memories.map((mem) => {
                                  const explanation = result.explanations?.[mem.id];
                                  const ageDays = Math.round((Date.now() - mem.ts) / (1000 * 60 * 60 * 24));
                                  
                                  return (
                                    <div key={mem.id} className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl p-3.5 space-y-2">
                                      <div className="flex items-center justify-between flex-wrap gap-2 text-[11px]">
                                        <div className="flex items-center gap-2">
                                          <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold border uppercase ${getTierBadgeColor(mem.tier)}`}>
                                            {mem.tier.replace("_", " ")}
                                          </span>
                                          <span className="font-mono text-[10px] text-zinc-500">ID: {mem.id}</span>
                                        </div>
                                        <span className="text-[11px] text-[var(--color-text-muted)]">{ageDays}d ago</span>
                                      </div>
                                      <p className="text-[13px] text-[var(--color-text-secondary)] italic">"{mem.summary}"</p>
                                      {explanation && (
                                        <div className="text-[11px] text-[var(--color-accent-cyan)] bg-[var(--color-accent-cyan)]/5 border border-[var(--color-accent-cyan)]/10 p-2 rounded-lg mt-1 flex items-start gap-1.5">
                                          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--color-accent-cyan)]" />
                                          <span><strong>Retrieve Reason:</strong> {explanation.reason}</span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: Retrieved Memories and Explainability */}
              {activeTab === "memories" && (
                <div className="space-y-4">
                  {[...result.ltmClient, ...result.ltmUser, ...result.mtm].map((mem) => {
                    const scoreObj = result.scores.find((s) => s.id === mem.id);
                    const score = scoreObj ? scoreObj.score : 0;
                    const explanation = result.explanations?.[mem.id];
                    const ageDays = Math.round((Date.now() - mem.ts) / (1000 * 60 * 60 * 24));

                    return (
                      <div 
                        key={mem.id} 
                        className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] hover:border-[var(--color-border-active)] rounded-2xl p-5 space-y-4 transition-all"
                      >
                        {/* Header */}
                        <div className="flex justify-between items-start gap-4 flex-wrap">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold border uppercase tracking-wider ${getTierBadgeColor(mem.tier)}`}>
                                {mem.tier.replace("_", " ")}
                              </span>
                              <span className="text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-bg-surface)] px-2 py-0.5 rounded border border-[var(--color-border-subtle)]">
                                topic: {mem.topic}
                              </span>
                            </div>
                            <h3 className="text-[14px] font-bold text-white mt-2">
                              {mem.summary}
                            </h3>
                          </div>
                          
                          <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-2 text-right shrink-0">
                            <span className="text-[10px] font-mono font-bold text-[var(--color-text-muted)] block uppercase">RELEVANCE SCORE</span>
                            <span className="text-[16px] font-extrabold text-[var(--color-accent-cyan)] font-mono">
                              {score.toFixed(4)}
                            </span>
                          </div>
                        </div>

                        {/* Body Details */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl p-3 text-[11px] font-mono">
                          <div>
                            <span className="text-[9px] text-[var(--color-text-muted)] block">BASE IMPORTANCE</span>
                            <span className="text-white font-bold">{mem.importance.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-[var(--color-text-muted)] block">ADAPTIVE SCORE</span>
                            <span className="text-[var(--color-accent-violet)] font-bold">{(mem.importance_score ?? mem.importance).toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-[var(--color-text-muted)] block">RETRIEVED COUNTS</span>
                            <span className="text-cyan-400 font-bold">{mem.retrieval_count ?? 0} times</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-[var(--color-text-muted)] block">AGE / RECENCY</span>
                            <span className="text-white font-bold">{ageDays}d ago</span>
                          </div>
                        </div>

                        {/* Text detail */}
                        <div className="text-[13px] text-[var(--color-text-secondary)] border-l-2 border-zinc-700 pl-3 py-1 bg-[var(--color-bg-base)]/30 rounded p-2">
                          <span className="text-[10px] font-mono font-bold text-zinc-500 block mb-1">RAW EXTRACT:</span>
                          "{mem.text}"
                        </div>

                        {/* Explanation Reason */}
                        {explanation && (
                          <div className="bg-[var(--color-accent-cyan)]/5 border border-[var(--color-accent-cyan)]/15 rounded-xl p-4 space-y-2">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-accent-cyan)] font-mono uppercase tracking-wider">
                              <Info className="w-4 h-4" />
                              Selection Logic Reason
                            </div>
                            <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed">
                              {explanation.reason}
                            </p>
                            
                            {/* Metrics Breakdown */}
                            <div className="mt-3 pt-3 border-t border-[var(--color-accent-cyan)]/10 grid grid-cols-4 gap-2 text-[10px] font-mono">
                              <div>
                                <span className="text-zinc-500 block">Cosine Similarity</span>
                                <span className="text-zinc-300 font-semibold">{Math.round(explanation.metrics.similarity * 100)}%</span>
                              </div>
                              <div>
                                <span className="text-zinc-500 block">Importance Factor</span>
                                <span className="text-zinc-300 font-semibold">{Math.round(explanation.metrics.importance * 100)}%</span>
                              </div>
                              <div>
                                <span className="text-zinc-500 block">Freshness Boost</span>
                                <span className="text-zinc-300 font-semibold">{Math.round(explanation.metrics.recency * 100)}%</span>
                              </div>
                              <div>
                                <span className="text-zinc-500 block">Historical Loads</span>
                                <span className="text-zinc-300 font-semibold">{explanation.metrics.retrievalFrequency}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
