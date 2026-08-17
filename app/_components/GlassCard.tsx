"use client";

import type { ReactNode } from "react";

/** Frosted-glass card surface — translucent dark panel + backdrop blur over
 * the page's ambient gradient wash, with a soft black shadow for depth
 * against the dark background instead of a flat drop shadow. The one shared
 * "glassmorphism" signature used across the admin platform, so it reads as
 * a deliberate system, not a one-off. */
export function GlassCard({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`bg-white/[0.045] backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.35)] hover:border-white/[0.16] transition-colors ${className}`}
    >
      {children}
    </div>
  );
}

/** Very low-opacity ambient gradient wash behind a page's content — what
 * the glass cards are actually showing through. Fixed so it stays put
 * under scrollable content. Render once per page, near the root. */
export function AmbientBackground() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0"
      style={{
        background:
          "radial-gradient(ellipse 900px 550px at 8% -8%, rgba(255,138,76,0.10), transparent 60%), " +
          "radial-gradient(ellipse 800px 550px at 100% 10%, rgba(167,139,250,0.09), transparent 55%), " +
          "radial-gradient(ellipse 700px 600px at 50% 110%, rgba(34,211,238,0.05), transparent 55%)",
      }}
    />
  );
}
