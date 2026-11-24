"use client";

import { useRef, useState } from "react";
import { Wand2, PenLine, Sparkles, Loader2, ArrowLeft, X, AlertCircle, Upload, FileText, Check } from "lucide-react";
import type { GeneratedAgentDraft } from "./types";
import { GNANI_LANGUAGES } from "./types";
import { CustomToolPicker } from "./CustomToolPicker";
import { BuiltInToolsPicker } from "./BuiltInToolsPicker";
import { PrebuiltIntegrationsPicker } from "./PrebuiltIntegrationsPicker";
import { MCPToolsPanel } from "./MCPToolsPanel";

interface CreateAgentDialogProps {
  onClose: () => void;
  onManual: () => void;
  onGenerated: (draft: GeneratedAgentDraft) => void;
}

type Mode = "choose" | "ai";

interface AttachedFile {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  extractedTextPreview?: string;
  error?: string;
}

const ACCEPTED_EXTENSIONS = ".txt,.pdf,.md,.markdown,.csv,.json,.docx";
const MAX_FILE_CONTEXT_CHARS = 8000;

export function CreateAgentDialog({ onClose, onManual, onGenerated }: CreateAgentDialogProps) {
  const [mode, setMode] = useState<Mode>("choose");
  const [description, setDescription] = useState("");
  const [successOutcome, setSuccessOutcome] = useState("");
  const [tone, setTone] = useState("");
  const [language, setLanguage] = useState("en-IN");
  const [provider, setProvider] = useState<"deepgram" | "gnani">("deepgram");
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = (fileList: FileList) => {
    const newFiles: AttachedFile[] = Array.from(fileList).map((file) => ({ file, status: "pending" }));
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadFile = async (attached: AttachedFile, index: number) => {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: "uploading" } : f)));
    try {
      const formData = new FormData();
      formData.append("file", attached.file);
      const res = await fetch("/api/knowledge/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, status: "done", extractedTextPreview: data.extractedTextPreview } : f))
      );
      return data.extractedTextPreview as string | undefined;
    } catch (e) {
      setFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, status: "error", error: e instanceof Error ? e.message : String(e) } : f))
      );
      throw e;
    }
  };

  const generate = async () => {
    if (!description.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      // Upload any files that haven't been uploaded yet (also seeds the
      // knowledge base for this account — not just prompt context).
      const pending = files.map((f, i) => ({ f, i })).filter(({ f }) => f.status === "pending" || f.status === "error");
      const uploadedPreviews = await Promise.all(pending.map(({ f, i }) => uploadFile(f, i)));

      // Upload results are reflected asynchronously in React state; use the
      // returned previews in this request so the first draft sees its files.
      const completedFiles = files.map((f, i) => {
        const pendingIndex = pending.findIndex((item) => item.i === i);
        return pendingIndex >= 0 ? { ...f, extractedTextPreview: uploadedPreviews[pendingIndex] } : f;
      });
      const fileContext = completedFiles
        .filter((f) => f.extractedTextPreview)
        .map((f) => `--- ${f.file.name} ---\n${f.extractedTextPreview}`)
        .join("\n\n")
        .slice(0, MAX_FILE_CONTEXT_CHARS);

      const res = await fetch("/api/admin/agents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          successOutcome,
          tone,
          language,
          speechProvider: provider,
          enabledTools,
          knowledgeConnected: files.length > 0,
          fileContext: fileContext || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate an agent.");
      onGenerated({ ...data.agent, language, speech_provider: provider, enabledTools } as GeneratedAgentDraft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-2">
            {mode === "ai" && (
              <button
                onClick={() => setMode("choose")}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="font-display font-bold text-[17px] text-[var(--color-text-primary)]">
              New Agent
            </h2>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {mode === "choose" && (
          <div className="p-6 flex flex-col gap-3">
            <button
              onClick={() => setMode("ai")}
              className="flex items-start gap-3.5 p-4 rounded-xl border border-[var(--color-border-subtle)] hover:border-[var(--color-accent-violet)]/50 hover:bg-[var(--color-bg-base)] text-left transition-all group"
            >
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-accent-violet)]/10 text-[var(--color-accent-violet)] flex-none group-hover:scale-105 transition-transform">
                <Wand2 className="w-5 h-5" />
              </span>
              <span>
                <div className="text-[14.5px] font-semibold text-[var(--color-text-primary)]">Describe it — I'll build it</div>
                <div className="text-[12.5px] text-[var(--color-text-secondary)] mt-0.5">
                  Tell me about your business and what the agent should handle — optionally attach a
                  pricing sheet, FAQ, or policy doc. I'll draft the name, personality, prompt, and
                  greeting for you to review.
                </div>
              </span>
            </button>

            <button
              onClick={onManual}
              className="flex items-start gap-3.5 p-4 rounded-xl border border-[var(--color-border-subtle)] hover:border-[var(--color-accent-cyan)]/50 hover:bg-[var(--color-bg-base)] text-left transition-all group"
            >
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-accent-cyan)]/10 text-[var(--color-accent-cyan)] flex-none group-hover:scale-105 transition-transform">
                <PenLine className="w-5 h-5" />
              </span>
              <span>
                <div className="text-[14.5px] font-semibold text-[var(--color-text-primary)]">Start from scratch</div>
                <div className="text-[12.5px] text-[var(--color-text-secondary)] mt-0.5">
                  Write the name, prompt, and everything else yourself, from a blank agent.
                </div>
              </span>
            </button>
          </div>
        )}

        {mode === "ai" && (
          <div className="p-6 flex flex-col gap-4">
            <p className="text-[12.5px] text-[var(--color-text-secondary)] -mb-1">A few details help tailor the agent's goal, voice, language, and actions. You can review and edit the full prompt before saving.</p>
            <div>
              <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
                Describe your business and this agent's job
              </label>
              <textarea
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="e.g. We're a dental clinic called Acme Dental. This agent should answer calls, help patients book or reschedule appointments, answer basic questions about our services and hours, and offer to connect a caller to the front desk for anything urgent."
                className="w-full px-4 py-3 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-violet)] focus:border-[var(--color-accent-violet)] text-[13.5px] text-[var(--color-text-primary)] transition-colors placeholder:text-[var(--color-text-muted)] resize-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">What does a successful call achieve?</label>
                <input value={successOutcome} onChange={(e) => setSuccessOutcome(e.target.value)} placeholder="e.g. confirm recovery and book a follow-up" className="w-full px-3 py-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl text-[13px] text-[var(--color-text-primary)]" />
              </div>
              <div>
                <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">How should it sound?</label>
                <input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. calm, warm, concise, not scripted" className="w-full px-3 py-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl text-[13px] text-[var(--color-text-primary)]" />
              </div>
              <div>
                <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">Primary language</label>
                <select value={language} onChange={(e) => { const value = e.target.value; setLanguage(value); if (value !== "en-IN") setProvider("gnani"); }} className="w-full px-3 py-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl text-[13px] text-[var(--color-text-primary)]">
                  <option value="en-IN">English (India)</option>
                  {GNANI_LANGUAGES.filter((item) => item.id !== "en-IN").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">Speech provider</label>
                <select value={provider} onChange={(e) => setProvider(e.target.value as "deepgram" | "gnani")} className="w-full px-3 py-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl text-[13px] text-[var(--color-text-primary)]">
                  <option value="deepgram" disabled={language !== "en-IN"}>Deepgram · English</option>
                  <option value="gnani">Gnani · Indian languages and English</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">Choose call tools <span className="font-normal normal-case text-[var(--color-text-muted)]">(optional)</span></label>
              <div className="space-y-3">
                <BuiltInToolsPicker enabledTools={enabledTools} onChange={setEnabledTools} />
                <PrebuiltIntegrationsPicker enabledTools={enabledTools} onChange={setEnabledTools} />
                <MCPToolsPanel enabledTools={enabledTools} onChange={setEnabledTools} />
                <CustomToolPicker enabledTools={enabledTools} onChange={setEnabledTools} />
              </div>
              <p className="mt-2 text-[10.5px] text-[var(--color-text-muted)]">Only selected actions are exposed to the agent and included when its prompt is generated. Connect prebuilt apps under Tools first.</p>
            </div>

            <div>
              <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
                Attach reference material <span className="font-normal normal-case text-[var(--color-text-muted)]">(optional)</span>
              </label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-4 px-4 cursor-pointer transition-colors text-center ${
                  dragOver
                    ? "border-[var(--color-accent-cyan)] bg-[var(--color-bg-base)]"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:border-[var(--color-border-active)]"
                }`}
              >
                <Upload className="w-5 h-5 text-[var(--color-text-muted)]" />
                <p className="text-[12.5px] text-[var(--color-text-secondary)]">
                  <span className="font-semibold text-[var(--color-accent-violet)]">Upload files</span> or drag and drop
                </p>
                <p className="text-[10.5px] text-[var(--color-text-muted)] font-mono">
                  TXT · PDF · MD · CSV · JSON · DOCX
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_EXTENSIONS}
                  className="hidden"
                  onChange={(e) => e.target.files?.length && addFiles(e.target.files)}
                />
              </div>

              {files.length > 0 && (
                <div className="flex flex-col gap-1.5 mt-2.5">
                  {files.map((f, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[12px]"
                    >
                      <FileText className="w-3.5 h-3.5 text-[var(--color-accent-violet)] flex-none" />
                      <span className="truncate flex-1 text-[var(--color-text-primary)]">{f.file.name}</span>
                      {f.status === "uploading" && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-text-muted)] flex-none" />}
                      {f.status === "done" && <Check className="w-3.5 h-3.5 text-emerald-500 flex-none" />}
                      {f.status === "error" && (
                        <span className="text-red-500 text-[10.5px] flex-none" title={f.error}>
                          failed
                        </span>
                      )}
                      <button
                        onClick={() => removeFile(i)}
                        disabled={f.status === "uploading"}
                        className="text-[var(--color-text-muted)] hover:text-red-500 transition-colors flex-none disabled:opacity-40"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10.5px] text-[var(--color-text-muted)] mt-1.5">
                Files are added to your knowledge base (shared across agents on your account) and used
                to ground this agent's drafted prompt in real specifics.
              </p>
            </div>

            {error && (
              <p className="text-[13px] text-red-500 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 flex-none" /> {error}
              </p>
            )}

            <button
              onClick={generate}
              disabled={generating || !description.trim()}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl btn-gradient text-white text-[13.5px] font-semibold shadow-[0_0_15px_var(--color-accent-glow)] transition-all hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? "Building your agent…" : "Generate Agent"}
            </button>
            <p className="text-[11.5px] text-[var(--color-text-muted)] text-center -mt-1">
              You'll get to review and edit everything before it's saved.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
