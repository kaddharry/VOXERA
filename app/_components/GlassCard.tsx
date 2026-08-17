"use client";

import type { ReactNode } from "react";

/** Frosted-glass card surface — translucent white + backdrop blur over the
 * page's ambient gradient wash, with a soft violet-tinted shadow instead of
 * a flat drop shadow. The one shared "glassmorphism" signature used across
 * every admin page, so it reads as a deliberate system, not a one-off. */
export function GlassCard({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`bg-white/70 backdrop-blur-xl rounded-2xl border border-white/60 shadow-[0_8px_32px_rgba(124,58,237,0.07)] hover:shadow-[0_8px_32px_rgba(124,58,237,0.12)] transition-shadow ${className}`}
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
          "radial-gradient(ellipse 800px 500px at 10% -5%, rgba(124,58,237,0.06), transparent 60%), " +
          "radial-gradient(ellipse 700px 500px at 95% 15%, rgba(6,182,212,0.06), transparent 55%)",
      }}
    />
  );
}
