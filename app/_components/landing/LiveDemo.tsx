"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Circle, AlertTriangle } from "lucide-react";
import { AgentVoiceBall } from "../AgentVoiceBall";

type Actor = "Agent" | "Emotion engine" | "Care team";

interface Row {
  text: string;
  detail: string;
  actor: Actor;
  warn?: boolean;
}

// Who/what actually does each step — the point of the tag is that this
// isn't one system doing everything: the agent runs the call, the emotion
// engine reads it independently in the background, and the care team only
// enters once something's been routed to them.
const ROWS: Row[] = [
  { text: "Patient identity confirmed", detail: "Matched against today's discharge list", actor: "Agent" },
  { text: "Recovery questions completed", detail: "Pain, mobility, incision site", actor: "Agent" },
  { text: "Symptom flagged — mild fever", detail: "100.5°F, reported at day 3", actor: "Emotion engine", warn: true },
  { text: "Emotion engine read: Distress", detail: "81% confidence · fused from 4 engines", actor: "Emotion engine" },
  { text: "Routed to care team", detail: "Dr. Patel notified", actor: "Care team" },
  { text: "Nurse follow-up scheduled", detail: "Within 2 hours", actor: "Care team" },
];

/**
 * A single, self-playing status card — not a scroll-driven layout. The
 * checklist advances on its own timer once the card scrolls into view, the
 * same "a live product just updating itself" feel as polar.sh's hero card:
 * mostly black/white/gray, with orange spent on exactly one moment (the
 * flagged symptom) instead of spread across the whole thing.
 */
export default function LiveDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [doneIndex, setDoneIndex] = useState(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reducedMotionRef.current) {
      setDoneIndex(ROWS.length);
      return;
    }
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setStarted(true); }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!started || reducedMotionRef.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const playRow = (i: number) => {
      if (cancelled) return;
      setDoneIndex(i);
      timer = setTimeout(() => playRow(i + 1), i >= ROWS.length ? 2400 : 700);
      if (i >= ROWS.length) return;
    };
    playRow(0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [started]);

  const animating = doneIndex < ROWS.length;

  return (
    <section className="vxl-demo-section">
      <div className="vxl-demo-head">
        <span className="vxl-demo-eyebrow">See it in action</span>
        <h2 className="vxl-demo-h2">From a phone call to a clinician&rsquo;s desk.</h2>
        <p className="vxl-demo-sub">
          A real VOXERA follow-up call, start to finish — this is what runs the moment the agent
          dials, no steps to click through.
        </p>
      </div>

      <div ref={ref} className="vxl-demo-card">
        <div className="vxl-demo-card-left">
          <div className="vxl-demo-kicker">
            <AgentVoiceBall level={animating ? 0.5 : 0.15} active={animating} size={28} />
            <span className="vxl-demo-live-dot" />
            Live call
          </div>
          <h3 className="vxl-demo-patient">Margaret C.</h3>
          <span className="vxl-demo-patient-sub">Day-3 recovery check-in · 02:14</span>
          <blockquote className="vxl-demo-quote">&ldquo;I&rsquo;ve had a mild fever since this morning, maybe 100.5.&rdquo;</blockquote>
          <span className="vxl-demo-quote-cap">Said 1m 42s into the call</span>
        </div>

        <div className="vxl-demo-card-right">
          <div className="vxl-demo-card-right-head">
            <span className="vxl-demo-card-right-title">VOXERA</span>
            <span className="vxl-demo-tag">Care pipeline</span>
          </div>

          <div className="vxl-demo-checklist">
            {ROWS.map((row, i) => {
              const status = i < doneIndex ? "done" : i === doneIndex ? "active" : "pending";
              return (
                <div key={row.text} className={`vxl-demo-row vxl-demo-row-${status} ${row.warn ? "vxl-demo-row-warn" : ""}`}>
                  <span className="vxl-demo-row-icon">
                    {status === "pending" && <Circle size={14} />}
                    {status === "active" && <Loader2 size={14} className="vxl-demo-spin" />}
                    {status === "done" && (row.warn ? <AlertTriangle size={14} /> : <Check size={14} />)}
                  </span>
                  <span className="vxl-demo-row-text">
                    <span className="vxl-demo-row-title-line">
                      {row.text}
                      <span className="vxl-demo-row-actor">{row.actor}</span>
                    </span>
                    <span className="vxl-demo-row-detail">{row.detail}</span>
                  </span>
                </div>
              );
            })}
          </div>

          <p className="vxl-demo-footer-line">We take on the listening, the flagging, and the paperwork.</p>
        </div>
      </div>
    </section>
  );
}
