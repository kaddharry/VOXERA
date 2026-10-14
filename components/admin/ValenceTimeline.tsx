"use client";

import { useMemo } from "react";

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
}

const WIDTH = 760;
const HEIGHT = 180;
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

/**
 * Horizontal zero-centered valence timeline (spec §11.3): x = elapsed call
 * time, y = valence (positive above the zero line, negative below, neutral
 * at/near it). Low-confidence reads render muted rather than a confident
 * color, and clicking a point calls onSelect so the caller can link it to
 * the matching transcript turn — this is deliberately a dumb, controlled
 * component; the sessions page owns selection state so the transcript list
 * can drive it the other way too (selecting a turn highlights its point).
 */
export function ValenceTimeline({
  points,
  selectedTs,
  onSelect,
}: {
  points: ValencePoint[];
  selectedTs?: number | null;
  onSelect?: (ts: number) => void;
}) {
  const { path, dots, minTs, maxTs } = useMemo(() => {
    if (points.length === 0) return { path: "", dots: [], minTs: 0, maxTs: 0 };
    const minTs = points[0].ts;
    const maxTs = points[points.length - 1].ts;
    const span = Math.max(1, maxTs - minTs);

    const toXY = (p: ValencePoint) => {
      const x = PAD_X + ((p.ts - minTs) / span) * PLOT_W;
      // v in [-1, 1] -> y in [PAD_Y, PAD_Y + PLOT_H], flipped (positive up).
      const y = PAD_Y + PLOT_H / 2 - (p.v * PLOT_H) / 2;
      return { x, y };
    };

    const dots = points.map((p) => ({ ...toXY(p), point: p }));
    const path = dots.map((d, i) => `${i === 0 ? "M" : "L"} ${d.x.toFixed(1)} ${d.y.toFixed(1)}`).join(" ");
    return { path, dots, minTs, maxTs };
  }, [points]);

  if (points.length === 0) {
    return <div className="text-[13px] text-[var(--color-text-muted)] italic px-1">No emotion data recorded for this session.</div>;
  }

  const zeroY = PAD_Y + PLOT_H / 2;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full h-auto"
      role="img"
      aria-label="Valence over the course of the call, positive above the center line, negative below"
    >
      {/* Zero line */}
      <line x1={PAD_X} y1={zeroY} x2={WIDTH - PAD_X} y2={zeroY} stroke="var(--color-border-subtle)" strokeWidth={1} strokeDasharray="4 4" />
      <text x={4} y={zeroY + 4} fontSize={9} fill="var(--color-text-muted)" fontFamily="monospace">0</text>
      <text x={4} y={PAD_Y + 8} fontSize={9} fill="var(--color-text-muted)" fontFamily="monospace">+1</text>
      <text x={4} y={HEIGHT - PAD_Y} fontSize={9} fill="var(--color-text-muted)" fontFamily="monospace">-1</text>

      {/* Trend line */}
      <path d={path} fill="none" stroke="var(--color-accent-violet)" strokeWidth={1.5} opacity={0.5} />

      {/* Turn/event markers */}
      {dots.map((d, i) => {
        const isSelected = selectedTs === d.point.ts;
        const color = dotColor(d.point.label, d.point.confidence);
        return (
          <g key={i} style={{ cursor: onSelect ? "pointer" : undefined }} onClick={() => onSelect?.(d.point.ts)}>
            {d.point.escalation && (
              <circle cx={d.x} cy={d.y} r={9} fill="none" stroke="#f87171" strokeWidth={1.5} opacity={0.6} />
            )}
            <circle
              cx={d.x}
              cy={d.y}
              r={isSelected ? 6 : 4}
              fill={color}
              stroke={isSelected ? "white" : "none"}
              strokeWidth={isSelected ? 1.5 : 0}
              opacity={d.point.confidence < LOW_CONFIDENCE_THRESHOLD ? 0.55 : 0.9}
            >
              <title>
                {d.point.label} (valence {d.point.v.toFixed(2)}, confidence {(d.point.confidence * 100).toFixed(0)}%) at{" "}
                {new Date(d.point.ts).toLocaleTimeString()}
              </title>
            </circle>
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
  );
}
