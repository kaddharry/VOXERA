"use client";

import { useEffect, useRef } from "react";

/** Soft glow that follows the cursor over the page's card surfaces — a
 * tasteful "premium SaaS" touch. Doesn't replace or hide the real system
 * cursor, so normal pointer affordances and accessibility stay intact. */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleMove = (e: MouseEvent) => {
      el.style.transform = `translate(${e.clientX - 200}px, ${e.clientY - 200}px)`;
    };
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 w-[400px] h-[400px] z-0 opacity-[0.05] will-change-transform"
      style={{
        background: "radial-gradient(circle, var(--color-accent-violet) 0%, transparent 70%)",
        filter: "blur(10px)",
      }}
    />
  );
}
