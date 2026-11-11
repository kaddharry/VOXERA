"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A single date + time-of-day + duration picker for one appointment.
 * Deliberately NOT built on components/admin/DateRangeTimePicker.tsx — that
 * component's DateSelectionValue.days is a multi-day/recurring selection
 * (shift-click ranges, built for outbound call campaigns) and its
 * KeyboardTimeInput/AnalogClockInput sub-components are private to that
 * file, not exported. This is a smaller, self-contained equivalent for the
 * "one appointment, one start time" case, styled to match (violet selected
 * day, same input/button classes as the rest of admin).
 */

export interface SingleDateTimeValue {
  dateKey: string; // "YYYY-MM-DD"
  hour12: number; // 1-12
  minute: number; // 0-59
  meridiem: "AM" | "PM";
  durationMinutes: number;
}

export function defaultSingleDateTimeValue(durationMinutes = 30): SingleDateTimeValue {
  const now = new Date(Date.now() + 15 * 60_000);
  const minute = Math.ceil(now.getMinutes() / 15) * 15;
  if (minute >= 60) now.setHours(now.getHours() + 1);
  now.setMinutes(minute % 60, 0, 0);
  const hour24 = now.getHours();
  return {
    dateKey: toDateKey(now),
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute: now.getMinutes(),
    meridiem: hour24 >= 12 ? "PM" : "AM",
    durationMinutes,
  };
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Combines the picker's value into real Date objects for the appointment's
 * start/end — local browser time, which is what the rest of the calendar
 * UI (TimeGrid, etc.) already operates in. */
export function singleDateTimeToRange(value: SingleDateTimeValue): { startsAt: Date; endsAt: Date } {
  const [y, m, d] = value.dateKey.split("-").map(Number);
  let hour24 = value.hour12 % 12;
  if (value.meridiem === "PM") hour24 += 12;
  const startsAt = new Date(y, m - 1, d, hour24, value.minute, 0, 0);
  const endsAt = new Date(startsAt.getTime() + value.durationMinutes * 60_000);
  return { startsAt, endsAt };
}

const DURATIONS = [15, 20, 30, 45, 60, 90];

export function SingleDateTimePicker({
  value,
  onChange,
  minDateKey,
}: {
  value: SingleDateTimeValue;
  onChange: (v: SingleDateTimeValue) => void;
  minDateKey?: string;
}) {
  const [y, m] = value.dateKey.split("-").map(Number);
  const [viewYear, setViewYear] = useState(y);
  const [viewMonth, setViewMonth] = useState(m - 1); // 0-indexed

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((year) => year - 1);
    } else {
      setViewMonth((month) => month - 1);
    }
  };
  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((year) => year + 1);
    } else {
      setViewMonth((month) => month + 1);
    }
  };

  const days = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startOffset = firstOfMonth.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (Date | null)[] = Array(startOffset).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewYear, viewMonth, d));
    return cells;
  }, [viewYear, viewMonth]);

  const todayKey = toDateKey(new Date());
  const min = minDateKey ?? todayKey;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={goToPrevMonth}
            className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[12.5px] font-semibold text-[var(--color-text-primary)]">
            {new Date(viewYear, viewMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </span>
          <button
            type="button"
            onClick={goToNextMonth}
            className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <span key={i} className="text-[10px] font-mono uppercase text-[var(--color-text-muted)] py-1">
              {d}
            </span>
          ))}
          {days.map((date, i) => {
            if (!date) return <span key={i} />;
            const key = toDateKey(date);
            const disabled = key < min;
            const selected = key === value.dateKey;
            const isToday = key === todayKey;
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...value, dateKey: key })}
                className={`h-7 rounded-md text-[12px] transition-colors ${
                  selected
                    ? "bg-[var(--color-accent-violet)] text-white font-semibold"
                    : disabled
                    ? "text-[var(--color-text-muted)]/40 cursor-not-allowed"
                    : isToday
                    ? "ring-1 ring-[var(--color-accent-violet)]/40 text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]"
                    : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]"
                }`}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-end gap-3">
        <div>
          <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Time</label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={12}
              value={value.hour12}
              onChange={(e) => onChange({ ...value, hour12: Math.min(12, Math.max(1, Number(e.target.value) || 1)) })}
              className="w-[56px] bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg px-2 py-2 text-[14px] text-center tabular-nums text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
            />
            <span className="text-[var(--color-text-muted)]">:</span>
            <input
              type="number"
              min={0}
              max={59}
              value={String(value.minute).padStart(2, "0")}
              onChange={(e) => onChange({ ...value, minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })}
              className="w-[56px] bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg px-2 py-2 text-[14px] text-center tabular-nums text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
            />
            <div className="flex rounded-lg border border-[var(--color-border-subtle)] overflow-hidden">
              {(["AM", "PM"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChange({ ...value, meridiem: m })}
                  className={`px-2.5 py-2 text-[12px] font-semibold transition-colors ${
                    value.meridiem === m ? "bg-[var(--color-accent-violet)] text-white" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Duration</label>
          <select
            value={value.durationMinutes}
            onChange={(e) => onChange({ ...value, durationMinutes: Number(e.target.value) })}
            className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} min
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
