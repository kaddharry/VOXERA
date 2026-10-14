"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { PhoneInput } from "../_components/PhoneInput";

/**
 * Public, unauthenticated demo-request form — spec §5.2/§5.3 step 1.
 * Deliberately collects only what's needed to tailor a demo call, never
 * real patient medical records (spec §5.2's explicit instruction).
 */
export default function BookDemoPage() {
  const router = useRouter();
  const [hospitalName, setHospitalName] = useState("");
  const [institutionType, setInstitutionType] = useState("");
  const [contactName, setContactName] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/demo-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospitalName, institutionType, contactName, workEmail, phone, workflow, description, consent }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to submit request");
        return;
      }
      router.push(`/signup?demoRequestId=${encodeURIComponent(data.request.id)}`);
    } catch {
      setError("Failed to submit request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg-base)] font-body text-[var(--color-text-primary)]">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link href="/" className="inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>

        <h1 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight mb-3">Book a personalized demo</h1>
        <p className="text-[14.5px] text-[var(--color-text-secondary)] mb-10 max-w-xl leading-relaxed">
          Tell us about your hospital or clinic and we'll place a tailored sample call to the number you provide,
          so you can hear exactly how the agent would talk with your patients. This is a product demo, not real
          patient outreach.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Hospital / clinic name" required>
              <input
                required
                value={hospitalName}
                onChange={(e) => setHospitalName(e.target.value)}
                className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[14px] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
                placeholder="Example Hospital"
              />
            </Field>
            <Field label="Institution type">
              <input
                value={institutionType}
                onChange={(e) => setInstitutionType(e.target.value)}
                className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[14px] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
                placeholder="e.g. Multi-specialty hospital"
              />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Your name" required>
              <input
                required
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[14px] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
                placeholder="Dr. Jane Smith"
              />
            </Field>
            <Field label="Work email" required>
              <input
                required
                type="email"
                value={workEmail}
                onChange={(e) => setWorkEmail(e.target.value)}
                className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[14px] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
                placeholder="jane@example-hospital.com"
              />
            </Field>
          </div>

          <Field label="Phone number for the demo callback" required>
            <PhoneInput value={phone} onChange={setPhone} />
          </Field>

          <Field label="What follow-up workflow are you interested in?">
            <select
              value={workflow}
              onChange={(e) => setWorkflow(e.target.value)}
              className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[14px] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
            >
              <option value="">Select one…</option>
              <option value="post_discharge">Post-discharge / post-procedure check-in</option>
              <option value="appointment_reminder">Appointment reminder</option>
              <option value="feedback">Patient feedback survey</option>
              <option value="other">Other</option>
            </select>
          </Field>

          <Field label="Anything else we should know? (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[14px] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
            />
          </Field>

          <label className="flex items-start gap-2.5 text-[13px] text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5"
            />
            I consent to receive a demo phone call and related communication about VOXERA at the number above.
          </label>

          {error && <p className="text-[13px] text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !consent}
            className="group flex items-center justify-center gap-2 w-full px-4 py-3 text-[14px] font-semibold text-white btn-gradient rounded-xl transition-all hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Continue to create your account
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </button>
          <p className="text-[12px] text-[var(--color-text-muted)] text-center">
            Next, you'll create a free account so we can securely link this request before placing the call.
          </p>
        </form>
      </div>
    </main>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-semibold text-[var(--color-text-secondary)] mb-1.5 block">
        {label}
        {required && <span className="text-[var(--color-accent-violet)]"> *</span>}
      </label>
      {children}
    </div>
  );
}
