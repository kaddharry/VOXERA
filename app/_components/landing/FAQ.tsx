"use client";

import { useEffect, useRef, useState } from "react";

const FAQS = [
  { q: "What can VOXERA do on a follow-up call?", a: "VOXERA calls patients after discharge or a procedure, checks on recovery using your hospital's approved script, answers common questions from your own knowledge base, and escalates anything that needs a clinician — all in a natural voice." },
  { q: "How do I get started?", a: "Book a demo to hear VOXERA on a sample call tailored to your hospital, then configure your follow-up agent, upload your policies, and enroll your first patients." },
  { q: "Do I need to change our phone system?", a: "No. VOXERA places outbound calls through your existing number — no PBX changes or hardware required." },
  { q: "What does my care team still handle?", a: "Anything VOXERA flags as needing judgment — a reported symptom, a distressed patient, or anything outside the rules your hospital has set. Routine, confirmed check-ins are logged automatically." },
  { q: "Does VOXERA make clinical decisions?", a: "No. VOXERA surfaces what a patient said for a clinician to review — it never diagnoses, prescribes, or decides that a patient is medically safe." },
  { q: "What does VOXERA cost?", a: "Pricing depends on call volume and the number of follow-up workflows you run. Book a demo and we'll work out a quote for your hospital." },
  { q: "Is patient data secure?", a: "Call data and transcripts are encrypted in transit and at rest, and access is scoped to your hospital's account only. We never sell or share patient data." },
];

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { threshold: 0.08 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section ref={ref} id="faq" className="vxl-faq-section">
      <div className="vxl-faq-inner">
        <h2
          className="vxl-faq-h2"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(20px)",
            transition: "opacity 0.6s ease, transform 0.6s ease",
          }}
        >
          FAQ
        </h2>

        <div>
          {FAQS.map((item, i) => (
            <FAQItem
              key={item.q}
              question={item.q}
              answer={item.a}
              isOpen={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
              visible={visible}
              delay={i * 0.05}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQItem({
  question,
  answer,
  isOpen,
  onToggle,
  visible,
  delay,
}: {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
  visible: boolean;
  delay: number;
}) {
  return (
    <div
      className="vxl-faq-item"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transitionDelay: `${delay}s`,
      }}
    >
      <button type="button" onClick={onToggle} className="vxl-faq-trigger">
        <span className="vxl-faq-question">{question}</span>
        <span className={`vxl-faq-toggle ${isOpen ? "vxl-faq-open" : ""}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2V10M2 6H10" stroke={isOpen ? "white" : "var(--vx-indigo)"} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      <div className={`vxl-faq-answer ${isOpen ? "vxl-faq-open-answer" : ""}`}>
        <p className="vxl-faq-answer-text">{answer}</p>
      </div>
    </div>
  );
}
