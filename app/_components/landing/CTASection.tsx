"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export default function CTASection() {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { threshold: 0.1 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section ref={ref} className="vxl-cta-section">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="vxl-cta-image"
        src="https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=2000&q=80"
        alt=""
        aria-hidden
      />
      <div className="vxl-cta-image-overlay" aria-hidden />
      <div className="vxl-hero-orbs" aria-hidden>
        <div className="vxl-hero-orb-blur" style={{ width: 300, height: 300, top: "10%", left: "-6%", background: "rgba(255,255,255,0.14)" }} />
        <div className="vxl-hero-orb-blur" style={{ width: 260, height: 260, bottom: "0%", right: "6%", background: "rgba(199,187,250,0.5)", animationDelay: "-4s" }} />
      </div>

      <div
        className="vxl-cta-content"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(30px)",
          transition: "opacity 0.8s ease, transform 0.8s ease",
        }}
      >
        <h2 className="vxl-cta-h2">
          A calmer way to run
          <br />
          <em className="vxl-accent">patient follow-ups</em>
        </h2>

        <div className="vxl-hero-cta-glass vxl-hero-cta-buttons">
          <Link href="/book-demo" className="vxl-hero-input-btn" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Book a Demo
          </Link>
          <Link href="/signup" className="vxl-hero-secondary-btn" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Sign Up Directly
          </Link>
        </div>
      </div>
    </section>
  );
}
