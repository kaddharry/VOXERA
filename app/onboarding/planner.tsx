"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  Check, 
  ArrowRight, 
  Loader2, 
  Sparkles, 
  Building2, 
  Stethoscope, 
  Briefcase, 
  Phone, 
  AlertCircle, 
  Bot 
} from "lucide-react";
import { cn } from "@/lib/utils";

// ==========================================
// Types & Configuration Definitions
// ==========================================

type Industry = "healthcare" | "hospitality" | "local-services" | "sales" | "other";
type Workflow = "receptionist" | "booking" | "aftercare" | "support" | "sales" | "reminders";

const industryOptions: Array<{ value: Industry; label: string; icon: any }> = [
  { value: "healthcare", label: "Clinic / Hospital", icon: Stethoscope },
  { value: "hospitality", label: "Restaurant / Hotel", icon: Building2 },
  { value: "local-services", label: "Local Services", icon: Briefcase },
  { value: "sales", label: "Sales Team", icon: Phone },
  { value: "other", label: "Other", icon: Sparkles },
];

const workflowOptions: Array<{ value: Workflow; label: string }> = [
  { value: "receptionist", label: "Answer inbound calls & FAQs" },
  { value: "booking", label: "Book & manage appointments" },
  { value: "aftercare", label: "Outbound post-service follow-up" },
  { value: "support", label: "Handle support & refunds" },
  { value: "sales", label: "Qualify inbound leads" },
  { value: "reminders", label: "Automated reminder calls" },
];

const knowledgeOptions = [
  "FAQs", "Pricing", "Policies", "Service list", "Booking rules", "Aftercare scripts", "Escalation rules"
];

const steps = ["Business", "Workflow", "Context"];

// ==========================================
// Main Component
// ==========================================

export function OnboardingPlanner() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  
  // Form State
  const [industry, setIndustry] = useState<Industry>("healthcare");
  const [workflow, setWorkflow] = useState<Workflow>("aftercare");
  const [businessName, setBusinessName] = useState("");
  const [callGoal, setCallGoal] = useState("");
  const [selectedKnowledge, setSelectedKnowledge] = useState<string[]>(["FAQs", "Policies"]);
  const [escalation, setEscalation] = useState("Human handoff for urgent cases");
  const [openingTime, setOpeningTime] = useState("09:00");
  const [closingTime, setClosingTime] = useState("18:00");
  const [language, setLanguage] = useState("English");
  const [tone, setTone] = useState("Professional");
  const [greeting, setGreeting] = useState(
  "Hello! Thank you for calling. How may I help you today?"
);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Computed AI Recommendations
  const recommendation = useMemo(
    () => getRecommendation(industry, workflow, selectedKnowledge.length),
    [industry, workflow, selectedKnowledge.length],
  );

  // Helper Handlers
  function toggleKnowledge(item: string) {
    setSelectedKnowledge((current) =>
      current.includes(item) ? current.filter((v) => v !== item) : [...current, item],
    );
  }

  const handleNext = () => { if (step < steps.length - 1) setStep(step + 1); };
  const handleBack = () => { if (step > 0) setStep(step - 1); };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          businessName, 
          industry, 
          workflow, 
          callGoal, 
          escalation, 
          openingTime,
          closingTime,
          language,
          tone,
          greeting,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save configuration.");
      router.push("/onboarding/success");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      {/* Wizard Form Area */}
      <div className="flex-1 w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 md:p-10 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
        
        {/* Progress Tracker */}
        <div className="flex items-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={i} className="flex-1 flex flex-col gap-2">
              <div className="h-1 rounded-full bg-[var(--color-bg-base)] overflow-hidden border border-[var(--color-border-subtle)]">
                <div 
                  className={cn(
                    "h-full transition-all duration-300", 
                    i <= step ? "bg-[var(--color-accent-cyan)] shadow-[0_0_8px_var(--color-accent-cyan)]" : "bg-transparent"
                  )}
                  style={{ width: i <= step ? "100%" : "0%" }}
                />
              </div>
              <span className={cn(
                "font-mono text-[10px] font-bold uppercase tracking-widest", 
                i <= step ? "text-[var(--color-accent-cyan)]" : "text-[var(--color-text-muted)]"
              )}>
                {s}
              </span>
            </div>
          ))}
        </div>

        {/* Form Wizard Step Controls */}
        <div className="min-h-[360px]">
          {/* STEP 0: Business Info */}
          {step === 0 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-2">
                <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
                  What is your business name?
                </label>
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Acme Dental Clinic"
                  className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[14px] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-cyan)] focus:border-[var(--color-accent-cyan)] transition-colors placeholder:text-[var(--color-text-muted)]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
                  Select your industry
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {industryOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setIndustry(opt.value)}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                        industry === opt.value 
                          ? "bg-[var(--color-bg-base)] border-[var(--color-border-active)] shadow-[0_0_10px_var(--color-accent-glow)] text-[var(--color-text-primary)]" 
                          : "bg-[var(--color-bg-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]"
                      )}
                    >
                      <opt.icon className={cn("w-4 h-4", industry === opt.value ? "text-[var(--color-accent-cyan)]" : "")} />
                      <span className="text-[14px] font-semibold">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 1: Agent Goal */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-2">
                <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
                  What is the primary goal of this AI agent?
                </label>
                <div className="grid gap-2">
                  {workflowOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setWorkflow(opt.value)}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                        workflow === opt.value 
                          ? "bg-[var(--color-bg-base)] border-[var(--color-border-active)] shadow-[0_0_10px_var(--color-accent-glow)] text-[var(--color-text-primary)]" 
                          : "bg-[var(--color-bg-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]"
                      )}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded-full border flex items-center justify-center", 
                        workflow === opt.value ? "border-[var(--color-accent-cyan)]" : "border-[var(--color-border-subtle)]"
                      )}>
                        {workflow === opt.value && <div className="w-2 h-2 rounded-full bg-[var(--color-accent-cyan)] shadow-[0_0_5px_var(--color-accent-cyan)]" />}
                      </div>
                      <span className="text-[14px] font-semibold">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
                  Describe the specific call scenario (Optional)
                </label>
                <textarea
                  value={callGoal}
                  onChange={(e) => setCallGoal(e.target.value)}
                  rows={3}
                  placeholder="e.g. I want the agent to call patients a day after their dental surgery..."
                  className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[14px] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-cyan)] focus:border-[var(--color-accent-cyan)] transition-colors placeholder:text-[var(--color-text-muted)] resize-none"
                />
              </div>
            </div>
          )}

          {/* STEP 2: Context / Operations */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-3">
                <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
                  What knowledge do you have ready to upload?
                </label>
                <div className="flex flex-wrap gap-2">
                  {knowledgeOptions.map((item) => (
                    <button
                      key={item}
                      onClick={() => toggleKnowledge(item)}
                      className={cn(
                        "px-4 py-2 rounded-full border text-[13px] font-semibold transition-all",
                        selectedKnowledge.includes(item)
                          ? "bg-[var(--color-accent-violet)] border-[var(--color-accent-violet)] text-white shadow-[0_0_10px_var(--color-accent-glow)]"
                          : "bg-[var(--color-bg-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]"
                      )}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              {/* Operating Hours */}
              <div className="space-y-3 pt-4 border-t border-[var(--color-border-subtle)]">
                <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
                  Operating Hours
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] text-[var(--color-text-secondary)] mb-2">
                      Opening Time
                    </label>
                    <input
                      type="time"
                      value={openingTime}
                      onChange={(e) => setOpeningTime(e.target.value)}
                      className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[14px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] text-[var(--color-text-secondary)] mb-2">
                      Closing Time
                    </label>
                    <input
                      type="time"
                      value={closingTime}
                      onChange={(e) => setClosingTime(e.target.value)}
                      className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[14px]"
                    />
                  </div>
                </div>
              </div>
{/* AI Settings */}
<div className="space-y-4 pt-4 border-t border-[var(--color-border-subtle)]">
  <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)]">
    AI Settings
  </label>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div>
      <label className="block text-[12px] text-[var(--color-text-secondary)] mb-2">
        Language
      </label>

      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[14px] text-[var(--color-text-primary)]"
      >
        <option value="English">English</option>
        <option value="Hindi">Hindi</option>
        <option value="Hinglish">Hinglish</option>
      </select>
    </div>

    <div>
      <label className="block text-[12px] text-[var(--color-text-secondary)] mb-2">
        Tone
      </label>

      <select
        value={tone}
        onChange={(e) => setTone(e.target.value)}
        className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[14px] text-[var(--color-text-primary)]"
      >
        <option value="Professional">Professional</option>
        <option value="Friendly">Friendly</option>
        <option value="Formal">Formal</option>
      </select>
    </div>
  </div>

  <div>
    <label className="block text-[12px] text-[var(--color-text-secondary)] mb-2">
      Greeting Message
    </label>

    <textarea
      rows={3}
      value={greeting}
      onChange={(e) => setGreeting(e.target.value)}
      className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[14px] text-[var(--color-text-primary)] resize-none"
      placeholder="Hello! Thank you for calling. How may I help you today?"
    />
  </div>
</div>
              {/* Escalation Config */}
              <div className="space-y-2 pt-4 border-t border-[var(--color-border-subtle)]">
                <label className="text-[13px] font-mono uppercase tracking-widest font-semibold text-[var(--color-text-secondary)] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  When should the AI escalate to a human?
                </label>
                <input
                  value={escalation}
                  onChange={(e) => setEscalation(e.target.value)}
                  className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[14px] text-[var(--color-text-primary)]"
                />
              </div>

              {error && (
                <p className="text-[13px] text-red-500 font-medium pt-2 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" /> {error}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer Navigation Buttons */}
        <div className="flex justify-between items-center pt-8 mt-4 border-t border-[var(--color-border-subtle)]">
          <button
            onClick={handleBack}
            disabled={step === 0 || isSubmitting}
            className="px-4 py-2 text-[14px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
          >
            Back
          </button>
          
          {step < steps.length - 1 ? (
            <button
              onClick={handleNext}
              disabled={step === 0 && !businessName.trim()}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] text-[14px] font-semibold hover:border-[var(--color-border-active)] hover:text-[var(--color-accent-cyan)] transition-colors disabled:opacity-30"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="group flex items-center gap-2 px-6 py-2.5 rounded-xl btn-gradient text-white text-[14px] font-semibold transition-all hover:scale-[1.02] shadow-[0_0_15px_var(--color-accent-glow)] disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-white" />}
              Deploy Workspace
            </button>
          )}
        </div>
      </div>

      {/* Recommendation Side Card */}
      <div className="w-full lg:w-[320px] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 lg:sticky lg:top-[100px] shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-2 mb-4 text-[var(--color-text-primary)]">
          <Bot className="w-4 h-4 text-[var(--color-accent-cyan)]" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">AI Recommendation</span>
        </div>
        
        <h3 className="font-display font-bold text-2xl text-[var(--color-text-primary)] mb-2 tracking-tight text-gradient">
          {recommendation.agentName}
        </h3>
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed mb-6">
          {recommendation.summary}
        </p>
        
        <div className="space-y-3">
          <div className="bg-[var(--color-bg-base)] rounded-xl p-4 border border-[var(--color-border-subtle)]">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-1">Target Business</p>
            <p className="text-[14px] text-[var(--color-text-primary)] font-semibold truncate">{businessName || "Your Business"}</p>
          </div>
          
          <div className="bg-[var(--color-bg-base)] rounded-xl p-4 border border-[var(--color-border-subtle)]">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-1">Core Workflow</p>
            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">{recommendation.workflow}</p>
          </div>
          
          <div className="bg-[var(--color-bg-base)] rounded-xl p-4 border border-[var(--color-border-subtle)]">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-1">Readiness</p>
            <div className="flex items-start gap-2 mt-1">
              <Check className={cn("w-4 h-4 shrink-0 mt-0.5", selectedKnowledge.length >= 3 ? "text-[var(--color-accent-cyan)]" : "text-amber-500")} />
              <p className="text-[13px] text-[var(--color-text-primary)] font-medium">{recommendation.readiness}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Helper Engine Functions
// ==========================================

function getRecommendation(industry: Industry, workflow: Workflow, knowledgeCount: number) {
  if (workflow === "aftercare" || (industry === "healthcare" && workflow === "receptionist")) {
    return {
      agentName: "Aftercare Agent",
      workflow: "Outbound recovery calls, red-flag triage, and staff escalation.",
      readiness: readinessLabel(knowledgeCount),
      summary: "Best for clinics needing safe post-procedure follow-ups.",
    };
  }

  if (workflow === "booking" || industry === "hospitality") {
    return {
      agentName: "Booking Agent",
      workflow: "Inbound reservations, cancellations, and confirmations.",
      readiness: readinessLabel(knowledgeCount),
      summary: "Best for restaurants and salons preventing lost revenue.",
    };
  }

  if (workflow === "sales" || industry === "sales") {
    return {
      agentName: "Qualification Agent",
      workflow: "Lead intake, qualification questions, and meeting booking.",
      readiness: readinessLabel(knowledgeCount),
      summary: "Best for teams executing fast inbound lead follow-up.",
    };
  }

  return {
    agentName: "Receptionist Agent",
    workflow: "Inbound call answering, FAQs, routing, and message taking.",
    readiness: readinessLabel(knowledgeCount),
    summary: "Best for reliable general phone coverage and human handoff.",
  };
}

function readinessLabel(count: number) {
  if (count >= 5) return "Strong context. Ready for production draft.";
  if (count >= 3) return "Good context. Ready for a focused demo agent.";
  return "Light context. Add more policies before launch.";
}