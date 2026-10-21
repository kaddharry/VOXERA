"use client";

import { useEffect, useRef, useState } from "react";

const FEATURES = [
  { id: "answers", title: "Calls every patient", description: "VOXERA picks up the schedule, greets the patient by name, and checks on recovery like your best care coordinator." },
  { id: "loop", title: "Books the follow-up", description: "It checks the discharge calendar, confirms the right day, and logs the outcome — no double-booking, no missed calls." },
  { id: "analyzes", title: "Keeps your team in the loop", description: "Every call gets a clean summary, synced straight to your tools, so nothing falls through the cracks after you hang up." },
];

export default function Features() {
  const titleRef = useRef<HTMLDivElement>(null);
  const [titleVisible, setTitleVisible] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setTitleVisible(true); }, { threshold: 0.1 });
    if (titleRef.current) obs.observe(titleRef.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section id="features" className="vxl-features-section">
      <div
        ref={titleRef}
        className="vxl-features-title"
        style={{
          opacity: titleVisible ? 1 : 0,
          transform: titleVisible ? "translateY(0)" : "translateY(32px)",
          transition: "opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1), transform 0.9s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <h2 className="vxl-features-h2">How VOXERA works</h2>
      </div>

      <div className="vxl-features-grid-static">
        {FEATURES.map((f, i) => (
          <HowCard key={f.id} feature={f} delay={i * 0.1} />
        ))}
      </div>
    </section>
  );
}

function HowCard({ feature, delay }: { feature: (typeof FEATURES)[number]; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.15 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="vxl-how-card"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(24px)",
        transitionDelay: `${delay}s`,
      }}
    >
      <div className="vxl-feature-card vxl-how-card-mock">
        <FeatureMockup id={feature.id} />
      </div>
      <h3 className="vxl-how-card-title">{feature.title}</h3>
      <p className="vxl-how-card-desc">{feature.description}</p>
    </div>
  );
}

function FeatureMockup({ id }: { id: string }) {
  if (id === "answers") {
    return (
      <div className="vxl-mock-transcript">
        <div className="vxl-mock-bubble vxl-mock-bubble-agent">Hi, this is Riverside General calling to check on your recovery.</div>
        <div className="vxl-mock-bubble vxl-mock-bubble-caller">&ldquo;Oh, hi — I&apos;m doing okay, a bit sore still.&rdquo;</div>
        <div className="vxl-mock-bubble vxl-mock-bubble-agent">That&apos;s normal at day 3. Any fever, or redness around the incision?</div>
      </div>
    );
  }
  if (id === "loop") {
    return (
      <div className="vxl-mock-escalation">
        <div className="vxl-mock-row">
          <span className="vxl-mock-row-dot" style={{ background: "#22C55E" }} />
          <span className="vxl-mock-row-text">Day-3 check-in completed — recovery on track</span>
          <span className="vxl-mock-row-tag" style={{ background: "rgba(34,197,94,0.16)", color: "#4ADE80" }}>Auto</span>
        </div>
        <div className="vxl-mock-row">
          <span className="vxl-mock-row-dot" style={{ background: "#F59E0B" }} />
          <span className="vxl-mock-row-text">Reported low-grade fever — flagged for review</span>
          <span className="vxl-mock-row-tag" style={{ background: "rgba(245,158,11,0.18)", color: "#FBBF24" }}>Needs you</span>
        </div>
        <div className="vxl-mock-row">
          <span className="vxl-mock-row-dot" style={{ background: "var(--vx-indigo)" }} />
          <span className="vxl-mock-row-text">Recovery note added to patient chart</span>
          <span className="vxl-mock-row-tag" style={{ background: "rgba(79,70,229,0.1)", color: "var(--vx-indigo)" }}>Auto</span>
        </div>
      </div>
    );
  }
  return (
    <div className="vxl-mock-analytics">
      <div className="vxl-mock-stat">
        <div className="vxl-mock-stat-value">94%</div>
        <div className="vxl-mock-stat-label">Follow-ups completed</div>
      </div>
      <div className="vxl-mock-stat">
        <div className="vxl-mock-stat-value">2.1</div>
        <div className="vxl-mock-stat-label">Avg. attempts to reach patient</div>
      </div>
      <div className="vxl-mock-stat">
        <div className="vxl-mock-stat-value">12%</div>
        <div className="vxl-mock-stat-label">Escalated to care team</div>
      </div>
    </div>
  );
}
