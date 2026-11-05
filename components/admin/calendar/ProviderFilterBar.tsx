"use client";

import { Plus } from "lucide-react";
import type { Provider } from "./types";

/** Color-coded provider chips to toggle in/out of the visible set — this
 * one filter is how both "hospital admin sees everyone" (select all) and
 * "a doctor's own agenda" (select just one) end up on the same calendar
 * page, with no separate route for either. */
export function ProviderFilterBar({
  providers,
  selectedIds,
  onToggle,
  onSelectAll,
  onSelectOnly,
  onAddProvider,
}: {
  providers: Provider[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSelectOnly: (id: string) => void;
  onAddProvider: () => void;
}) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-[var(--color-border-subtle)] px-6 py-1.5 md:px-10">
      <button
        onClick={onSelectAll}
        className={`rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
          selectedIds.size === providers.length
            ? "border-[var(--color-accent-violet)] bg-[var(--color-accent-violet)]/18 text-[var(--color-accent-violet)]"
            : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        }`}
      >
        All doctors
      </button>
      {providers.map((p) => {
        const active = selectedIds.has(p.id);
        return (
          <button
            key={p.id}
            onClick={() => onToggle(p.id)}
            onDoubleClick={() => onSelectOnly(p.id)}
            title="Click to toggle, double-click to show only this doctor"
            className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-semibold transition-all"
            style={{
              borderColor: active ? p.color : "var(--color-border-subtle)",
              backgroundColor: active ? `color-mix(in oklab, ${p.color} 22%, transparent)` : "transparent",
              color: active ? p.color : "var(--color-text-secondary)",
              opacity: active ? 1 : 0.55,
            }}
          >
            <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: p.color }} />
            {p.name}
          </button>
        );
      })}
      <button
        onClick={onAddProvider}
        className="flex items-center gap-1 rounded-md border border-dashed border-[var(--color-border-subtle)] px-2 py-1 text-[11.5px] font-semibold text-[var(--color-text-muted)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        <Plus className="h-3 w-3" /> Doctor
      </button>
    </div>
  );
}
