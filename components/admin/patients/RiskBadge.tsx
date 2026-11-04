import type { RiskLevel } from "../../../lib/db/patients";

const RISK_META: Record<RiskLevel, { label: string; color: string }> = {
  low: { label: "Low", color: "var(--risk-low)" },
  medium: { label: "Medium", color: "var(--risk-medium)" },
  high: { label: "High", color: "var(--risk-high)" },
  critical: { label: "Critical", color: "var(--risk-critical)" },
};

export function riskColor(level: RiskLevel): string {
  return RISK_META[level].color;
}

export function RiskBadge({ level, className = "" }: { level: RiskLevel; className?: string }) {
  const { label, color } = RISK_META[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${className}`}
      style={{ color, borderColor: `color-mix(in oklab, ${color} 40%, transparent)`, backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
