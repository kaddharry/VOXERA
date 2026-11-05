"use client";

import { forwardRef, useImperativeHandle, useState, type ComponentType } from "react";
// CrystalizedBall is vendored plain JS (see its own file header) — TS can
// only infer an overly strict shape from its unannotated destructuring, so
// it's treated as untyped here; AgentVoiceBall's own props are the real,
// checked contract the rest of the app uses.
import CrystalizedBallUntyped from "./CrystalizedBall";
const CrystalizedBall = CrystalizedBallUntyped as unknown as ComponentType<Record<string, unknown>>;

export interface AgentVoiceBallHandle {
  /** Push a new 0-1 amplitude reading without re-rendering the caller —
   * for a real meter running off requestAnimationFrame (mic/TTS analyser),
   * matching how the old `.voxera-orb`'s `--level` CSS var was updated
   * imperatively via a ref instead of React state, to avoid re-rendering a
   * large parent (e.g. TestAgentDrawer) on every animation frame. */
  setLevel: (level: number) => void;
}

/**
 * The one "agent is listening/speaking" visual, used everywhere that used to
 * show the plain CSS `.voxera-orb` — the TestAgentDrawer's live indicator
 * and the landing page's scripted demo. Same simple contract VoiceOrb had
 * (a 0-1 amplitude level + an active flag), translated into CrystalizedBall's
 * speed/glow/crackle so callers never touch the underlying WebGL component's
 * ~20 tuning props directly.
 *
 * Takes `level` two ways: as a controlled prop (fine for the landing page's
 * scripted ~once-a-second pulses, where re-rendering this small component is
 * cheap) or imperatively via `ref.setLevel()` (for a real 60fps amplitude
 * meter, where re-rendering anything bigger than this component every frame
 * would be wasteful) — CrystalizedBall re-reads its settings on every render
 * and wakes its own animation frame, so either path drives it correctly.
 */
export const AgentVoiceBall = forwardRef<AgentVoiceBallHandle, {
  level?: number;
  active?: boolean;
  size?: number;
  color?: string;
  className?: string;
}>(function AgentVoiceBall(
  { level = 0, active = false, size = 64, color = "#EF5A00", className = "" },
  ref
) {
  const [imperativeLevel, setImperativeLevel] = useState<number | null>(null);
  useImperativeHandle(ref, () => ({ setLevel: setImperativeLevel }), []);

  const raw = imperativeLevel ?? level;
  const clamped = Math.min(1, Math.max(0, raw));
  return (
    <div
      className={className}
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <CrystalizedBall
        preset="ember"
        color={color}
        size={0.82}
        speed={active ? 1 + clamped * 1.8 : 0.6}
        glow={0.7 + clamped * 0.6}
        crackle={0.5 + clamped * 0.5}
        flares={0.5 + clamped * 0.4}
        sparks={active ? 0.5 + clamped * 0.5 : 0.15}
        interactive={false}
        intro
      />
    </div>
  );
});
