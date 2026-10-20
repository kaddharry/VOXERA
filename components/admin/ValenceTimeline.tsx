"use client";

import { useState } from "react";

export interface ValencePoint {
  ts: number;
  /** Raw VAD valence, already on a [-1, 1] scale centered at zero — see
   * lib/emotion/lexicon.ts. Never renormalized here: spec §11.3 explicitly
   * warns not to assume a 0-1 score needs converting without checking the
   * engine's real semantics, and this engine's `v` is already [-1, 1]. */
  v: number;
  label: string;
  confidence: number;
  escalation?: boolean;
  /** The caller's own words nearest this moment, if any were transcribed —
   * what turns this from an abstract score into "here's what was actually
   * said when the mood shifted." */
  text?: string;
  /** Which side spoke the nearest line — lets the callout read "Patient
   * said" vs "Agent said" instead of an unattributed quote. */
  speaker?: "user" | "agent";
}

const WIDTH = 760;
const HEIGHT = 200;
const PAD_X = 36;
const PAD_Y = 16;
const PLOT_W = WIDTH - PAD_X * 2;
const PLOT_H = HEIGHT - PAD_Y * 2;
const LOW_CONFIDENCE_THRESHOLD = 0.5;

function dotColor(label: string, confidence: number): string {
  if (confidence < LOW_CONFIDENCE_THRESHOLD) return "#71717a"; // zinc-500 — low-confidence/unknown reads stay visually muted
  switch (label) {
    case "anger":
    case "frustration":
    case "distress":
      return "#f87171"; // red-400
    case "fear":
    case "confusion":
    case "disappointment":
      return "#fbbf24"; // amber-400
    case "joy":
    case "gratitude":
    case "excitement":
    case "calm":
      return "#34d399"; // emerald-400
    default:
      return "#22d3ee"; // cyan-400 — neutral
  }
}

/** Plain-English read of the label, for a hospital staff member who has
 * never heard of "valence" or "confidence" — the whole point of this
 * callout is to replace ML jargon with "here's roughly how they felt". */
function plainLanguage(label: string, confidence: number): string {
  if (confidence < LOW_CONFIDENCE_THRESHOLD) return "Unclear — not enough signal to read the mood here";
  switch (label) {
    case "anger":
      return "Sounded angry";
    case "frustration":
      return "Sounded frustrated";
    case "distress":
      return "Sounded distressed";
    case "fear":
      return "Sounded anxious or fearful";
    case "confusion":
      return "Sounded confused";
    case "disappointment":
      return "Sounded disappointed";
    case "joy":
    case "excitement":
      return "Sounded happy";
    case "gratitude":
      return "Sounded grateful";
    case "calm":
      return "Sounded calm";
    default:
      return "Neutral tone";
  }
}

/**
 * Horizontal zero-centered valence timeline (spec §11.3): x = elapsed call
 * time, y = valence (positive above the zero line, negative below, neutral
 * at/near it). Tapping or hovering a point surfaces a callout with a plain-
 * language read of the mood plus the nearest actual quote from the call —
 * the chart IS the transcript view now, instead of a separate list below
 * it that a reader had to cross-reference by eye.
 */
export function ValenceTimeline({ points }: { points: ValencePoint[] }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (points.length === 0) {
    return <div className="text-[13px] text-[var(--color-text-muted)] italic px-1">No emotion data recorded for this session.</div>;
  }

  const minTs = points[0].ts;
  const maxTs = points[points.length - 1].ts;
  const span = Math.max(1, maxTs - minTs);

  const toXY = (p: ValencePoint) => {
    const x = PAD_X + ((p.ts - minTs) / span) * PLOT_W;
    const y = PAD_Y + PLOT_H / 2 - (p.v * PLOT_H) / 2;
    return { x, y };
  };

  const dots = points.map((p) => ({ ...toXY(p), point: p }));
  const path = dots.map((d, i) => `${i === 0 ? "M" : "L"} ${d.x.toFixed(1)} ${d.y.toFixed(1)}`).join(" ");
  const zeroY = PAD_Y + PLOT_H / 2;

  const shownIdx = activeIdx ?? hoverIdx;
  const shown = shownIdx !== null ? dots[shownIdx] : null;

  // Keep the callout on-screen near either edge of the chart instead of
  // letting it run off the side.
  const xPct = shown ? (shown.x / WIDTH) * 100 : 0;
  const yPct = shown ? (shown.y / HEIGHT) * 100 : 0;
  const horizAnchor = xPct < 20 ? "left" : xPct > 80 ? "right" : "center";
  const vertAnchor = yPct < 35 ? "below" : "above";

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label="Mood over the course of the call, with the caller's actual words at each point"
      >
        {/* Zero line */}
        <line x1={PAD_X} y1={zeroY} x2={WIDTH - PAD_X} y2={zeroY} stroke="var(--color-border-subtle)" strokeWidth={1} strokeDasharray="4 4" />
        <text x={4} y={PAD_Y + 8} fontSize={9} fill="var(--color-text-muted)" fontFamily="monospace">Positive</text>
        <text x={4} y={HEIGHT - PAD_Y} fontSize={9} fill="var(--color-text-muted)" fontFamily="monospace">Negative</text>

        {/* Trend line */}
        <path d={path} fill="none" stroke="var(--color-accent-violet)" strokeWidth={1.5} opacity={0.5} />

        {/* Guide line from the active point down to the time axis, so it's
            visually obvious which moment in the call the callout belongs to. */}
        {shown && (
          <line x1={shown.x} y1={shown.y} x2={shown.x} y2={HEIGHT - PAD_Y} stroke={dotColor(shown.point.label, shown.point.confidence)} strokeWidth={1} strokeDasharray="2 3" opacity={0.5} />
        )}

        {/* Turn/event markers */}
        {dots.map((d, i) => {
          const isShown = shownIdx === i;
          const color = dotColor(d.point.label, d.point.confidence);
          return (
            <g
              key={i}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              onClick={() => setActiveIdx((cur) => (cur === i ? null : i))}
            >
              {/* Invisible, larger hit target — the visible dot is small, but
                  tapping it precisely shouldn't be required. */}
              <circle cx={d.x} cy={d.y} r={14} fill="transparent" />
              {d.point.escalation && (
                <circle cx={d.x} cy={d.y} r={9} fill="none" stroke="#f87171" strokeWidth={1.5} opacity={0.6} />
              )}
              <circle
                cx={d.x}
                cy={d.y}
                r={isShown ? 6 : 4}
                fill={color}
                stroke={isShown ? "white" : "none"}
                strokeWidth={isShown ? 1.5 : 0}
                opacity={d.point.confidence < LOW_CONFIDENCE_THRESHOLD ? 0.55 : 0.9}
              />
            </g>
          );
        })}

        <text x={PAD_X} y={HEIGHT - 2} fontSize={9} fill="var(--color-text-muted)" fontFamily="monospace">
          {new Date(minTs).toLocaleTimeString()}
        </text>
        <text x={WIDTH - PAD_X} y={HEIGHT - 2} fontSize={9} fill="var(--color-text-muted)" fontFamily="monospace" textAnchor="end">
          {new Date(maxTs).toLocaleTimeString()}
        </text>
      </svg>

      {shown && (
        <div
          className="pointer-events-none absolute z-10 w-64 max-w-[80vw] rounded-xl border border-[var(--color-border-active)] bg-[var(--color-bg-elevated)] p-3.5 shadow-xl"
          style={{
            left: `${xPct}%`,
            top: `${yPct}%`,
            transform: `translate(${horizAnchor === "left" ? "0" : horizAnchor === "right" ? "-100%" : "-50%"}, ${
              vertAnchor === "above" ? "calc(-100% - 14px)" : "14px"
            })`,
          }}
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-semibold text-[var(--color-text-primary)]">
              {plainLanguage(shown.point.label, shown.point.confidence)}
            </span>
            <span className="flex-none font-mono text-[10px] text-[var(--color-text-muted)]">
              {new Date(shown.point.ts).toLocaleTimeString()}
            </span>
          </div>
          {shown.point.escalation && (
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-red-400">⚑ Flagged for review</div>
          )}
          <p className="text-[12px] italic leading-snug text-[var(--color-text-secondary)]">
            {shown.point.text
              ? `"${shown.point.text.length > 140 ? `${shown.point.text.slice(0, 140)}…` : shown.point.text}"`
              : "No speech captured at this exact moment."}
          </p>
          {shown.point.text && shown.point.speaker && (
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {shown.point.speaker === "agent" ? "Agent said" : "Patient said"}
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
        Hover or tap a point to see what was said and how the mood read at that moment.
      </p>
    </div>
  );
}
