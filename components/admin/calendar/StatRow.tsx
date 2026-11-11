"use client";

import type { Appointment } from "./types";

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isThisWeek(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return d >= start && d < end;
}

/** A single compact strip, not a grid of cards — keeps the calendar's stat
 * summary from eating the vertical space the no-scroll grid below it needs.
 * Numbers in font-mono (tabular figures) for a crisp, dashboard-y feel;
 * color only appears on a count that actually needs attention, pulled from
 * the same --risk-* tokens used everywhere else, not a fresh accent. */
export function StatRow({ appointments }: { appointments: Appointment[] }) {
  const today = appointments.filter((a) => isToday(a.starts_at) && a.status !== "cancelled");
  const confirmed = today.filter((a) => a.status === "confirmed" || a.status === "checked_in" || a.status === "completed");
  const pending = today.filter((a) => a.status === "scheduled");
  const noShowsThisWeek = appointments.filter((a) => a.status === "no_show" && isThisWeek(a.starts_at));

  const stats: { label: string; value: number; accent?: string }[] = [
    { label: "Today", value: today.length },
    { label: "Confirmed", value: confirmed.length, accent: confirmed.length > 0 ? "var(--risk-low)" : undefined },
    { label: "Pending", value: pending.length, accent: pending.length > 0 ? "var(--risk-medium)" : undefined },
    { label: "No-shows (wk)", value: noShowsThisWeek.length, accent: noShowsThisWeek.length > 0 ? "var(--risk-critical)" : undefined },
  ];

  return (
    <div className="flex flex-none flex-wrap items-center gap-x-5 gap-y-1 border-b border-[var(--color-border-subtle)] px-6 py-2 md:px-10">
      {stats.map((s) => (
        <div key={s.label} className="flex items-baseline gap-1.5">
          <span className="font-mono text-[15px] font-bold leading-none" style={{ color: s.accent ?? "var(--color-text-primary)" }}>
            {s.value}
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
