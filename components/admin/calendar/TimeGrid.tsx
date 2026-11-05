"use client";

import { type ReactNode, useMemo } from "react";

/**
 * Shared hour-axis grid renderer — WeekGrid (columns = days) and DayGrid
 * (columns = providers) both build their own `columns`/`events` and hand
 * them to this one component, so the pixel-positioning math and overlap
 * layout only exist in one place.
 *
 * Fills whatever height its flex parent gives it — never scrolls. Rows are
 * positioned by percentage of the whole clinic-hours span, not a fixed
 * px-per-hour, so the grid always fits the viewport instead of requiring a
 * scrollbar to reach the end of the day.
 */

export interface TimeGridColumn {
  key: string;
  /** The calendar day this column represents, for positioning events within
   * it — for WeekGrid this differs per column; for DayGrid every column
   * shares the same date (the selected day) and differs by provider. */
  date: Date;
  title: string;
  subtitle?: string;
  accentColor?: string;
}

export interface TimeGridEvent {
  id: string;
  columnKey: string;
  start: Date;
  end: Date;
}

// A compact clinic day — wide enough for the vast majority of appointments
// without needing a scrollbar; outliers outside this window still get
// booked (the picker isn't restricted to it), they just clip at the edge
// of the visible grid rather than pushing it taller.
const START_HOUR = 8;
const END_HOUR = 18;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60;

function minutesFromGridStart(d: Date, columnDate: Date): number {
  const dayStart = new Date(columnDate);
  dayStart.setHours(START_HOUR, 0, 0, 0);
  return (d.getTime() - dayStart.getTime()) / 60_000;
}

function formatHourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? "a" : "p"}`;
}

/** Greedy lane assignment so overlapping events in the same column render
 * side-by-side instead of stacking illegibly on top of each other. Not a
 * minimal-width packing — every event in a column gets 1/maxLanes width —
 * but visually correct and simple, which is enough since same-provider
 * appointments can never truly overlap (the DB's overlap-safe booking
 * function guarantees that); this only ever matters for a WeekGrid day
 * column aggregating more than one provider. */
function assignLanes<T extends TimeGridEvent>(events: T[]): Map<string, { lane: number; laneCount: number }> {
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const ev of sorted) {
    let lane = laneEnds.findIndex((end) => end <= ev.start.getTime());
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(ev.end.getTime());
    } else {
      laneEnds[lane] = ev.end.getTime();
    }
    laneOf.set(ev.id, lane);
  }
  const laneCount = Math.max(1, laneEnds.length);
  const result = new Map<string, { lane: number; laneCount: number }>();
  for (const ev of sorted) result.set(ev.id, { lane: laneOf.get(ev.id)!, laneCount });
  return result;
}

export function TimeGrid<T extends TimeGridEvent>({
  columns,
  events,
  renderEvent,
  onSlotClick,
  emptyMessage,
}: {
  columns: TimeGridColumn[];
  events: T[];
  renderEvent: (event: T, layout: { lane: number; laneCount: number }) => ReactNode;
  onSlotClick?: (columnKey: string, clickedAt: Date) => void;
  emptyMessage?: string;
}) {
  const eventsByColumn = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const col of columns) map.set(col.key, []);
    for (const ev of events) {
      const list = map.get(ev.columnKey);
      if (list) list.push(ev);
    }
    return map;
  }, [columns, events]);

  if (columns.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-[var(--color-text-muted)]">
        {emptyMessage ?? "Nothing to show."}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Hour rail */}
      <div className="relative w-10 flex-none">
        <div className="h-7" />
        <div className="relative" style={{ height: "calc(100% - 28px)" }}>
          {HOURS.map((h) => (
            <span
              key={h}
              className="absolute right-1.5 -translate-y-1/2 font-mono text-[10px] text-[var(--color-text-muted)]"
              style={{ top: `${((h - START_HOUR) / (END_HOUR - START_HOUR)) * 100}%` }}
            >
              {formatHourLabel(h)}
            </span>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1">
        {columns.map((col) => {
          const colEvents = eventsByColumn.get(col.key) ?? [];
          const lanes = assignLanes(colEvents);
          return (
            <div key={col.key} className="flex min-w-[120px] flex-1 flex-col border-l border-[var(--color-border-subtle)] first:border-l-0">
              <div className="flex h-7 flex-none flex-col items-center justify-center border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                <span className="text-[12px] font-semibold leading-none text-[var(--color-text-primary)]" style={col.accentColor ? { color: col.accentColor } : undefined}>
                  {col.title}
                  {col.subtitle && <span className="ml-1 font-normal text-[var(--color-text-muted)]">{col.subtitle}</span>}
                </span>
              </div>
              <div
                className="relative min-h-0 flex-1"
                onClick={(e) => {
                  if (!onSlotClick) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = (e.clientY - rect.top) / rect.height;
                  const minutes = Math.round(pct * TOTAL_MINUTES);
                  const clicked = new Date(col.date);
                  clicked.setHours(START_HOUR, 0, 0, 0);
                  clicked.setMinutes(Math.round(minutes / 15) * 15);
                  onSlotClick(col.key, clicked);
                }}
              >
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-[var(--color-border-subtle)]/70"
                    style={{ top: `${((h - START_HOUR) / (END_HOUR - START_HOUR)) * 100}%` }}
                  />
                ))}
                {colEvents.map((ev) => {
                  const topPct = (minutesFromGridStart(ev.start, col.date) / TOTAL_MINUTES) * 100;
                  const heightPct = ((ev.end.getTime() - ev.start.getTime()) / 60_000 / TOTAL_MINUTES) * 100;
                  const layout = lanes.get(ev.id) ?? { lane: 0, laneCount: 1 };
                  const widthPct = 100 / layout.laneCount;
                  return (
                    <div
                      key={ev.id}
                      className="absolute px-0.5"
                      style={{
                        top: `${topPct}%`,
                        height: `${heightPct}%`,
                        minHeight: 18,
                        left: `${layout.lane * widthPct}%`,
                        width: `${widthPct}%`,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {renderEvent(ev, layout)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
