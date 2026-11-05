/** Shared stat tile — lifted verbatim from app/admin/patients/page.tsx so
 * every admin page's stat strip reads as one system instead of each page
 * reinventing it slightly differently. */
export function StatCard({
  title,
  value,
  icon: Icon,
  accent,
  urgent = false,
}: {
  title: string;
  value: number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent: string;
  /** Renders as a bold, fully-saturated color block instead of a calm dark
   * card — reserved for counts that actually need attention right now
   * (a risk/alert/overdue stat sitting above zero), so it reads as a real
   * signal rather than decoration. */
  urgent?: boolean;
}) {
  if (urgent) {
    return (
      <div
        className="rounded-xl p-4 flex items-center gap-3 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.5)]"
        style={{ background: `linear-gradient(135deg, ${accent}, color-mix(in oklab, ${accent} 55%, black))` }}
      >
        <div className="p-2.5 rounded-lg bg-black/15 flex-none">
          <Icon className="w-4 h-4 text-black" />
        </div>
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-widest text-black/55 truncate">{title}</p>
          <p className="text-[24px] font-extrabold text-black leading-none">{value}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl p-4 flex items-center gap-3 border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
      <div className="p-2.5 rounded-lg flex-none" style={{ backgroundColor: `color-mix(in oklab, ${accent} 20%, transparent)` }}>
        <Icon className="w-4 h-4" style={{ color: accent }} />
      </div>
      <div className="min-w-0">
        <p className="text-[10.5px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] truncate">{title}</p>
        <p className="text-[22px] font-bold text-[var(--color-text-primary)] leading-none">{value}</p>
      </div>
    </div>
  );
}
