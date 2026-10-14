"use client";

import type { ReactNode } from "react";

/** Frosted-glass card surface — translucent white panel + backdrop blur over
 * the page's ambient gradient wash, with a soft indigo-tinted shadow for
 * depth against the light background. The one shared "glassmorphism"
 * signature used across the admin platform (same recipe as .vxl-glass on
 * the landing page), so it reads as a deliberate system, not a one-off. */
export function GlassCard({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`bg-white/70 backdrop-blur-xl rounded-2xl border border-[var(--vx-indigo,#4F46E5)]/10 shadow-[0_8px_32px_rgba(79,70,229,0.10)] hover:border-[var(--vx-indigo,#4F46E5)]/25 transition-colors ${className}`}
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
          "radial-gradient(ellipse 900px 550px at 8% -8%, rgba(79,70,229,0.08), transparent 60%), " +
          "radial-gradient(ellipse 800px 550px at 100% 10%, rgba(124,92,250,0.08), transparent 55%), " +
          "radial-gradient(ellipse 700px 600px at 50% 110%, rgba(199,187,250,0.10), transparent 55%)",
      }}
    />
  );
}
