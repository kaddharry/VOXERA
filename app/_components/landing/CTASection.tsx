"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
// GradientASCII is vendored plain JS (see its own file header) — treated as
// untyped here, same reasoning as AgentVoiceBall's CrystalizedBall cast.
import GradientASCIIUntyped from "../GradientASCII";
const GradientASCII = GradientASCIIUntyped as unknown as ComponentType<Record<string, unknown>>;

export default function CTASection() {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { threshold: 0.1 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section className="vxl-cta-frame">
    <section ref={ref} className="vxl-cta-section">
      <div className="vxl-cta-ascii-bg" aria-hidden>
        <GradientASCII
          colors={["#3a0f00", "#ffefe0", "#ffb37a", "#ef5a00"]}
          shape="horizon"
          cellSize={16}
          density={0.5}
          glyphOpacity={0.4}
          glow={0.22}
          softness={0.6}
          gradientOpacity={0.6}
          grain={0.05}
          mouseInteraction
          intro
        />
      </div>
      <div className="vxl-cta-scrim" aria-hidden />

      <div
        className="vxl-cta-content"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(30px)",
          transition: "opacity 0.8s ease, transform 0.8s ease",
        }}
      >
        <span className="vxl-cta-eyebrow">AI voice agent for patient follow-up</span>

        <h2 className="vxl-cta-h2">
          See what VOXERA would
          <br />
          catch at <em className="vxl-accent">your hospital.</em>
        </h2>

        <p className="vxl-cta-sub">
          Book a short call and we&rsquo;ll show you VOXERA running a follow-up call built around
          your own discharge process — or hear a sample call right now.
        </p>

        <div className="vxl-hero-cta-glass vxl-hero-cta-buttons">
          <Link href="/book-demo" className="vxl-hero-input-btn" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Book a Demo
          </Link>
          <Link href="/demo" className="vxl-hero-secondary-btn" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Hear a Sample Call
          </Link>
        </div>
      </div>
    </section>
    </section>
  );
}
