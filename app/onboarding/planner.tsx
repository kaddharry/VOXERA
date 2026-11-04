"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Loader2,
  Sparkles,
  PenLine,
  Wand2,
  UploadCloud,
  FileText,
  X,
  CheckCircle2,
  AlertCircle,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/utils";

const VOICE_PERSONAS = [
  { id: "female-friendly", label: "Female · Friendly" },
  { id: "male-formal", label: "Male · Formal" },
  { id: "female-formal", label: "Female · Formal" },
  { id: "male-friendly", label: "Male · Friendly" },
];

const STEPS = ["Basics", "Prompt", "Knowledge", "Review"];

type PromptMode = "manual" | "ai";

interface UploadedFile {
  file: File;
  status: "uploading" | "done" | "error";
  error?: string;
}

export function OnboardingPlanner() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // Step 1 — basics
  // VOXERA now deploys one hospital per account — onboarding no longer asks
  // for a business name (that was for the old multi-hospital signup flow).
  // The tenant row created on submit still needs a name, so this stays a
  // fixed internal label rather than a field the user fills in.
  const businessName = "Hospital";
  const [agentName, setAgentName] = useState("");
  const [description, setDescription] = useState("");

  // Step 2 — prompt
  const [promptMode, setPromptMode] = useState<PromptMode>("ai");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [greeting, setGreeting] = useState("");
  const [voicePersona, setVoicePersona] = useState("female-friendly");

  // Step 3 — knowledge
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Submit
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinueStep0 = description.trim().length > 0;
  const canContinueStep1 = systemPrompt.trim().length > 0;

  const handleNext = () => {
    if (step === 0 && !canContinueStep0) return;
    if (step === 1 && !canContinueStep1) return;
    if (step < STEPS.length - 1) setStep(step + 1);
  };
  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const generatePrompt = useCallback(async () => {
    if (!businessName.trim() || !description.trim()) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/onboarding/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate a prompt.");
      setSystemPrompt(data.prompt);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [businessName, description]);

  const uploadFiles = useCallback(async (fileList: FileList) => {
    const newEntries: UploadedFile[] = Array.from(fileList).map((file) => ({ file, status: "uploading" }));
    setFiles((prev) => [...prev, ...newEntries]);

    for (const entry of newEntries) {
      const formData = new FormData();
      formData.append("file", entry.file);
      try {
        const res = await fetch("/api/knowledge/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        setFiles((prev) =>
          prev.map((f) => (f.file === entry.file ? { ...f, status: "done" } : f))
        );
      } catch (e) {
        setFiles((prev) =>
          prev.map((f) =>
            f.file === entry.file
              ? { ...f, status: "error", error: e instanceof Error ? e.message : String(e) }
              : f
          )
        );
      }
    }
  }, []);

  const removeFile = (file: File) => setFiles((prev) => prev.filter((f) => f.file !== file));

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          agentName: agentName.trim() || "Follow-Up Agent",
          description,
          systemPrompt,
          greeting: greeting.trim() || undefined,
          voicePersona,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create your agent.");

      router.push(`/onboarding/success?agentId=${encodeURIComponent(data.agent.id)}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-xl p-6 md:p-10 shadow-xl">
      {/* Progress */}
      <div className="flex items-center gap-2 mb-10">
        {STEPS.map((s, i) => (
          <div key={i} className="flex-1 flex flex-col gap-2">
            <div className="h-1 rounded-full bg-[var(--color-bg-base)] overflow-hidden border border-[var(--color-border-subtle)]">
              <div
                className={cn(
                  "h-full transition-all duration-300",
                  i <= step ? "bg-[var(--color-accent-violet)]" : "bg-transparent"
                )}
                style={{ width: i <= step ? "100%" : "0%" }}
              />
            </div>
            <span
              className={cn(
                "font-mono text-[10px] font-bold uppercase tracking-widest",
                i <= step ? "text-[var(--color-accent-violet)]" : "text-[var(--color-text-muted)]"
              )}
            >
              {s}
            </span>
          </div>
        ))}
      </div>

      <div className="min-h-[380px]">
        {/* STEP 0 — Basics */}
        {step === 0 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-2">
              <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
                Agent name <span className="normal-case font-normal text-[var(--color-text-muted)]">(optional)</span>
              </label>
              <input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. Discharge Follow-Up Agent"
                className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[14px] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-violet)] focus:border-[var(--color-accent-violet)] transition-colors placeholder:text-[var(--color-text-muted)]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
                What should this agent do?
              </label>
              <p className="text-[12.5px] text-[var(--color-text-muted)]">
                Describe your business and what you want the agent to handle on calls — this is what
                we'll use to draft its personality and prompt in the next step.
              </p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="e.g. We're a dental clinic. The agent should answer calls, help patients book or reschedule appointments, answer basic questions about our services and hours, and offer to connect a caller to the front desk for anything urgent."
                className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[14px] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-violet)] focus:border-[var(--color-accent-violet)] transition-colors placeholder:text-[var(--color-text-muted)] resize-none"
              />
            </div>
          </div>
        )}

        {/* STEP 1 — Prompt */}
        {step === 1 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-2">
              <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
                How do you want to write the prompt?
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPromptMode("ai")}
                  className={cn(
                    "flex items-center gap-2.5 p-3.5 rounded-xl border text-left transition-all",
                    promptMode === "ai"
                      ? "bg-[var(--color-bg-base)] border-[var(--color-border-active)]"
                      : "bg-[var(--color-bg-surface)] border-[var(--color-border-subtle)] hover:border-[var(--color-border-active)]"
                  )}
                >
                  <Wand2 className={cn("w-4 h-4 flex-none", promptMode === "ai" ? "text-[var(--color-accent-violet)]" : "text-[var(--color-text-muted)]")} />
                  <span className="text-[13.5px] font-semibold text-[var(--color-text-primary)]">Generate with AI</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPromptMode("manual")}
                  className={cn(
                    "flex items-center gap-2.5 p-3.5 rounded-xl border text-left transition-all",
                    promptMode === "manual"
                      ? "bg-[var(--color-bg-base)] border-[var(--color-border-active)]"
                      : "bg-[var(--color-bg-surface)] border-[var(--color-border-subtle)] hover:border-[var(--color-border-active)]"
                  )}
                >
                  <PenLine className={cn("w-4 h-4 flex-none", promptMode === "manual" ? "text-[var(--color-accent-violet)]" : "text-[var(--color-text-muted)]")} />
                  <span className="text-[13.5px] font-semibold text-[var(--color-text-primary)]">Write it myself</span>
                </button>
              </div>
            </div>

            {promptMode === "ai" && !systemPrompt && (
              <button
                type="button"
                onClick={generatePrompt}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl btn-gradient text-white text-[13.5px] font-semibold disabled:opacity-60"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {generating ? "Writing your agent's prompt…" : "Generate prompt from your description"}
              </button>
            )}

            {generateError && (
              <p className="text-[13px] text-red-500 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 flex-none" /> {generateError}
              </p>
            )}

            {(systemPrompt || promptMode === "manual") && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
                    System prompt
                  </label>
                  {promptMode === "ai" && systemPrompt && (
                    <button
                      type="button"
                      onClick={generatePrompt}
                      disabled={generating}
                      className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-accent-violet)] hover:brightness-110 disabled:opacity-50"
                    >
                      {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      Regenerate
                    </button>
                  )}
                </div>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={7}
                  placeholder="You are the voice agent for..."
                  className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[13.5px] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-violet)] focus:border-[var(--color-accent-violet)] transition-colors placeholder:text-[var(--color-text-muted)] resize-none"
                />
                <p className="text-[12px] text-[var(--color-text-muted)]">
                  Fully editable — tweak anything before continuing, however it was written.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-[var(--color-border-subtle)]">
              <div className="space-y-2">
                <label className="block text-[12px] font-semibold text-[var(--color-text-secondary)]">
                  Greeting <span className="font-normal text-[var(--color-text-muted)]">(optional)</span>
                </label>
                <input
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                  placeholder="Hey, thanks for calling!"
                  className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-3.5 py-2.5 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-violet)]"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-[12px] font-semibold text-[var(--color-text-secondary)]">Voice</label>
                <select
                  value={voicePersona}
                  onChange={(e) => setVoicePersona(e.target.value)}
                  className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-3.5 py-2.5 text-[13px] text-[var(--color-text-primary)]"
                >
                  {VOICE_PERSONAS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2 — Knowledge */}
        {step === 2 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-2">
              <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
                Give it something to know <span className="normal-case font-normal text-[var(--color-text-muted)]">(optional)</span>
              </label>
              <p className="text-[12.5px] text-[var(--color-text-muted)]">
                Upload FAQs, policies, price lists, or anything else — the agent will look things up
                in these on calls instead of guessing. Text and PDF files. You can add more later.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="text/plain,application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
              }}
              className="w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--color-border-subtle)] hover:border-[var(--color-border-active)] py-10 transition-colors"
            >
              <UploadCloud className="w-6 h-6 text-[var(--color-text-muted)]" />
              <span className="text-[13.5px] font-semibold text-[var(--color-text-primary)]">
                Drop files here or click to browse
              </span>
              <span className="text-[11.5px] text-[var(--color-text-muted)]">.txt or .pdf, up to 5MB each</span>
            </button>

            {files.length > 0 && (
              <ul className="space-y-2">
                {files.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 py-3"
                  >
                    <FileText className="w-4 h-4 text-[var(--color-text-muted)] flex-none" />
                    <span className="flex-1 min-w-0 truncate text-[13px] text-[var(--color-text-primary)]">{f.file.name}</span>
                    {f.status === "uploading" && <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-muted)] flex-none" />}
                    {f.status === "done" && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-none" />}
                    {f.status === "error" && (
                      <span className="text-[11.5px] text-red-500 flex-none" title={f.error}>
                        failed
                      </span>
                    )}
                    <button type="button" onClick={() => removeFile(f.file)} className="flex-none text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* STEP 3 — Review */}
        {step === 3 && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
              Review your agent
            </label>

            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 space-y-3">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)]">Agent</div>
                <div className="text-[14.5px] font-semibold text-[var(--color-text-primary)]">
                  {agentName.trim() || "Follow-Up Agent"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)]">System prompt</div>
                <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed line-clamp-4">{systemPrompt}</p>
              </div>
              {greeting && (
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)]">Greeting</div>
                  <p className="text-[13px] text-[var(--color-text-secondary)]">{greeting}</p>
                </div>
              )}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-muted)]">Knowledge files</div>
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  {files.filter((f) => f.status === "done").length > 0
                    ? `${files.filter((f) => f.status === "done").length} file(s) ready`
                    : "None added — you can add these later"}
                </p>
              </div>
            </div>

            {error && (
              <p className="text-[13px] text-red-500 font-medium flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 flex-none" /> {error}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center pt-8 mt-4 border-t border-[var(--color-border-subtle)]">
        <button
          onClick={handleBack}
          disabled={step === 0 || isSubmitting}
          className="flex items-center gap-1.5 px-4 py-2 text-[14px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        {step < STEPS.length - 1 ? (
          <button
            onClick={handleNext}
            disabled={(step === 0 && !canContinueStep0) || (step === 1 && !canContinueStep1)}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] text-[14px] font-semibold hover:border-[var(--color-border-active)] hover:text-[var(--color-accent-violet)] transition-colors disabled:opacity-30"
          >
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="group flex items-center gap-2 px-6 py-2.5 rounded-xl btn-gradient text-white text-[14px] font-semibold disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            {isSubmitting ? "Creating…" : "Create Agent"}
          </button>
        )}
      </div>
    </div>
  );
}
