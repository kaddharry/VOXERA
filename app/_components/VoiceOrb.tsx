"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Reusable wrapper around the .voxera-orb CSS (see globals.css) — the same
 * signature element already used in TestAgentDrawer.tsx's Live Test Call,
 * driven by real audio amplitude there. Here it's driven by whatever real
 * signal the caller has (e.g. LiveCallMonitor's live SSE emotion intensity)
 * via the `level` prop.
 *
 * `idle` switches to a gentle CSS "ambient breathing" animation instead —
 * deliberately distinct from the real-data-driven state, and only used when
 * there's genuinely no live signal to react to (no active call). Never
 * silently fakes reactivity: `level` always wins when `idle` is false.
 */
export function VoiceOrb({
  level,
  hue = "var(--color-accent-violet)",
  idle = false,
  size = 56,
  coreSize = 26,
  children,
}: {
  level: number;
  hue?: string;
  idle?: boolean;
  size?: number;
  coreSize?: number;
  children?: ReactNode;
}) {
  const style: CSSProperties & Record<string, string | number> = {
    width: size,
    height: size,
    "--hue": hue,
  };
  if (!idle) style["--level"] = level;

  return (
    <div className={`voxera-orb ${idle ? "is-idle" : ""}`} style={style}>
      <div className="voxera-orb-core" style={{ width: coreSize, height: coreSize }}>
        {children}
      </div>
    </div>
  );
}
