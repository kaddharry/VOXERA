"use client";

/**
 * Parametrized arc gauge — same SVG technique as the landing page's
 * CAIGauge (components/ui/CAIGauge.tsx), generalized to take a real value
 * instead of a hardcoded animated-to-78 demo number.
 */
export function RiskGauge({
  value,
  label,
  sublabel,
  color = "var(--color-accent-cyan)",
}: {
  /** 0-100 */
  value: number;
  label: string;
  sublabel?: string;
  color?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75;
  const strokeDashoffset = arcLength - (clamped / 100) * arcLength;

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative h-[180px] w-[180px]">
        <svg className="absolute inset-0 h-full w-full -rotate-[135deg]" viewBox="0 0 160 160">
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke="var(--color-bg-surface)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
          />
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[28px] font-bold text-[var(--color-text-primary)]">{Math.round(clamped)}%</span>
          {sublabel && <span className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{sublabel}</span>}
        </div>
      </div>
      <p className="mt-2 text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)]">{label}</p>
    </div>
  );
}
