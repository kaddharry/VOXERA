"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Keyboard, Clock as ClockIcon } from "lucide-react";

/**
 * Replaces the native `<input type="datetime-local">` for the "schedule a
 * follow-up" flow. Two upgrades over the first version: (1) the calendar
 * now accumulates an arbitrary set of days — click toggles a single day,
 * shift+click fills everything between the last click and this one — so
 * "14, 16-18, 20-23, 27" is just four clicks (the three range ones held
 * with shift), not one contiguous range; (2) the time control has a
 * keyboard mode (type any minute, not just :00/:15/:30/:45) and an analog
 * clock mode (drag the hour hand, then the minute hand, like a phone's
 * native time picker), defaulting to the current time instead of a fixed
 * 10:00 AM.
 */

export interface DateSelectionValue {
  days: string[]; // sorted, unique "YYYY-MM-DD" keys
  hour12: number; // 1-12
  minute: number; // 0-59, any value
  meridiem: "AM" | "PM";
}

export function defaultDateSelectionValue(): DateSelectionValue {
  const now = new Date();
  const hour24 = now.getHours();
  return {
    days: [],
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute: now.getMinutes(),
    meridiem: hour24 >= 12 ? "PM" : "AM",
  };
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function timeOfDayToMinutes(hour12: number, minute: number, meridiem: "AM" | "PM"): number {
  const h24 = meridiem === "AM" ? hour12 % 12 : (hour12 % 12) + 12;
  return h24 * 60 + minute;
}

/** Every selected day at the given time-of-day, as unix-ms, sorted. */
export function expandDailyAttemptTimes(value: DateSelectionValue): number[] {
  const minutesOfDay = timeOfDayToMinutes(value.hour12, value.minute, value.meridiem);
  return value.days
    .map((key) => {
      const d = fromDateKey(key);
      d.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);
      return d.getTime();
    })
    .sort((a, b) => a - b);
}

/** Human-readable summary of the selected days, grouping consecutive runs
 * into "16–18" rather than listing every date ("14, 16–18, 20–23, 27"). */
export function summarizeSelectedDays(days: string[]): string {
  if (days.length === 0) return "No dates selected";
  const sorted = [...days].sort();
  const groups: string[][] = [];
  for (const key of sorted) {
    const last = groups[groups.length - 1];
    if (last) {
      const prevDate = fromDateKey(last[last.length - 1]);
      const thisDate = fromDateKey(key);
      const diffDays = Math.round((thisDate.getTime() - prevDate.getTime()) / 86_400_000);
      if (diffDays === 1) {
        last.push(key);
        continue;
      }
    }
    groups.push([key]);
  }
  const fmt = (k: string) => fromDateKey(k).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return groups.map((g) => (g.length === 1 ? fmt(g[0]) : `${fmt(g[0])}–${fmt(g[g.length - 1])}`)).join(", ");
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function DateRangeTimePicker({ value, onChange }: { value: DateSelectionValue; onChange: (v: DateSelectionValue) => void }) {
  const [viewMonth, setViewMonth] = useState(() => (value.days[0] ? fromDateKey(value.days[0]) : new Date()));
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [timeMode, setTimeMode] = useState<"keyboard" | "clock">("keyboard");

  const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const today = startOfDay(new Date());
  const daySet = new Set(value.days);

  const cells: Array<Date | null> = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1)),
  ];

  function handleDayClick(day: Date, shiftKey: boolean) {
    if (day.getTime() < today.getTime()) return;
    const key = toDateKey(day);
    if (shiftKey && lastClicked) {
      const anchor = fromDateKey(lastClicked);
      const [lo, hi] = anchor.getTime() <= day.getTime() ? [anchor, day] : [day, anchor];
      const next = new Set(daySet);
      const cursor = new Date(lo);
      while (cursor.getTime() <= hi.getTime()) {
        if (cursor.getTime() >= today.getTime()) next.add(toDateKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      onChange({ ...value, days: Array.from(next).sort() });
    } else {
      const next = new Set(daySet);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onChange({ ...value, days: Array.from(next).sort() });
    }
    setLastClicked(key);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Month grid */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-3.5">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
            className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:bg-[#4F46E5]/[0.08] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            {viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <button
            type="button"
            onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
            className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:bg-[#4F46E5]/[0.08] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-1.5">
          {WEEKDAYS.map((w, i) => (
            <div key={i} className="text-center text-[12px] font-mono uppercase text-[var(--color-text-muted)]">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (!day) return <div key={i} />;
            const key = toDateKey(day);
            const disabled = day.getTime() < today.getTime();
            const selected = daySet.has(key);
            return (
              <button
                key={i}
                type="button"
                disabled={disabled}
                onClick={(e) => handleDayClick(day, e.shiftKey)}
                title={disabled ? undefined : "Click to toggle · Shift+click to fill a range from your last click"}
                className={`aspect-square rounded-lg text-[14px] font-medium transition-colors
                  ${disabled ? "text-[var(--color-text-muted)]/40 cursor-not-allowed" : ""}
                  ${selected ? "bg-[var(--color-accent-violet)] text-white font-semibold" : ""}
                  ${!disabled && !selected ? "text-[var(--color-text-primary)] hover:bg-[#4F46E5]/[0.1]" : ""}
                  ${day.getTime() === today.getTime() && !selected ? "ring-1 ring-[var(--color-accent-violet)]/40" : ""}
                `}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
        <p className="text-[12px] text-[var(--color-text-muted)] mt-3">
          Click a day to toggle it · hold <kbd className="px-1 py-0.5 rounded bg-[#4F46E5]/[0.08] font-mono">Shift</kbd> and click another to fill everything between them
        </p>
      </div>

      {value.days.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-[13.5px] text-[var(--color-text-secondary)]">
            <span className="font-semibold text-[var(--color-text-primary)]">{value.days.length}</span> day{value.days.length === 1 ? "" : "s"}: {summarizeSelectedDays(value.days)}
          </p>
          <button type="button" onClick={() => onChange({ ...value, days: [] })} className="text-[13px] text-[var(--color-text-muted)] hover:text-red-500 transition-colors flex-none">
            Clear
          </button>
        </div>
      )}

      {/* Time of day */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] block">
            Call around this time
          </label>
          <div className="flex gap-1 p-0.5 rounded-lg bg-[#4F46E5]/[0.06]">
            <button
              type="button"
              onClick={() => setTimeMode("keyboard")}
              className={`p-1.5 rounded-md transition-colors ${timeMode === "keyboard" ? "bg-white shadow-sm text-[var(--color-accent-violet)]" : "text-[var(--color-text-muted)]"}`}
              aria-label="Type the time"
              title="Type the time"
            >
              <Keyboard className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setTimeMode("clock")}
              className={`p-1.5 rounded-md transition-colors ${timeMode === "clock" ? "bg-white shadow-sm text-[var(--color-accent-violet)]" : "text-[var(--color-text-muted)]"}`}
              aria-label="Set the time on a clock"
              title="Set the time on a clock"
            >
              <ClockIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {timeMode === "keyboard" ? (
          <KeyboardTimeInput value={value} onChange={onChange} />
        ) : (
          <AnalogClockInput value={value} onChange={onChange} />
        )}
      </div>
    </div>
  );
}

function KeyboardTimeInput({ value, onChange }: { value: DateSelectionValue; onChange: (v: DateSelectionValue) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={1}
        max={12}
        value={value.hour12}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange({ ...value, hour12: Math.min(12, Math.max(1, n)) });
        }}
        className="w-[72px] bg-white border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[16px] text-center tabular-nums text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
      />
      <span className="text-[16px] text-[var(--color-text-muted)]">:</span>
      <input
        type="number"
        min={0}
        max={59}
        value={String(value.minute).padStart(2, "0")}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange({ ...value, minute: Math.min(59, Math.max(0, n)) });
        }}
        className="w-[72px] bg-white border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[16px] text-center tabular-nums text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
      />
      <div className="flex gap-1 ml-1 p-1 rounded-lg bg-white border border-[var(--color-border-subtle)]">
        {(["AM", "PM"] as const).map((mer) => (
          <button
            key={mer}
            type="button"
            onClick={() => onChange({ ...value, meridiem: mer })}
            className={`px-3 py-1.5 rounded-md text-[13.5px] font-semibold transition-colors ${value.meridiem === mer ? "bg-[var(--color-accent-violet)] text-white" : "text-[var(--color-text-secondary)]"}`}
          >
            {mer}
          </button>
        ))}
      </div>
    </div>
  );
}

const CLOCK_SIZE = 200;
const CLOCK_CENTER = CLOCK_SIZE / 2;
const CLOCK_RADIUS = CLOCK_SIZE / 2 - 14;

function angleToHour(angleDeg: number): number {
  const h = Math.round(angleDeg / 30) % 12;
  return h === 0 ? 12 : h;
}
function angleToMinute(angleDeg: number): number {
  return Math.round(angleDeg / 6) % 60;
}
function hourToAngle(h12: number): number {
  return (h12 % 12) * 30;
}
function minuteToAngle(m: number): number {
  return m * 6;
}

/** Drag-to-set analog clock — first set the hour (12 numbered positions),
 * then it auto-advances to minutes (a free, continuously-draggable dial,
 * not snapped to 5-minute ticks, so any exact minute is reachable). */
function AnalogClockInput({ value, onChange }: { value: DateSelectionValue; onChange: (v: DateSelectionValue) => void }) {
  const [hand, setHand] = useState<"hour" | "minute">("hour");
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);

  function angleFromPointer(clientX: number, clientY: number): number {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = CLOCK_SIZE / rect.width;
    const x = (clientX - rect.left) * scale - CLOCK_CENTER;
    const y = (clientY - rect.top) * scale - CLOCK_CENTER;
    // 0deg = 12 o'clock, clockwise
    let deg = (Math.atan2(x, -y) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  }

  function applyAngle(deg: number) {
    if (hand === "hour") {
      onChange({ ...value, hour12: angleToHour(deg) });
    } else {
      onChange({ ...value, minute: angleToMinute(deg) });
    }
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    draggingRef.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    applyAngle(angleFromPointer(e.clientX, e.clientY));
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draggingRef.current) return;
    applyAngle(angleFromPointer(e.clientX, e.clientY));
  }
  function onPointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (hand === "hour") setHand("minute"); // auto-advance, like a phone's native picker
  }

  const angle = hand === "hour" ? hourToAngle(value.hour12) : minuteToAngle(value.minute);
  const handLength = hand === "hour" ? CLOCK_RADIUS * 0.55 : CLOCK_RADIUS * 0.82;
  const handX = CLOCK_CENTER + handLength * Math.sin((angle * Math.PI) / 180);
  const handY = CLOCK_CENTER - handLength * Math.cos((angle * Math.PI) / 180);
  const knobX = CLOCK_CENTER + CLOCK_RADIUS * Math.sin((angle * Math.PI) / 180);
  const knobY = CLOCK_CENTER - CLOCK_RADIUS * Math.cos((angle * Math.PI) / 180);

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setHand("hour")}
          className={`text-[28px] font-semibold tabular-nums transition-colors ${hand === "hour" ? "text-[var(--color-accent-violet)]" : "text-[var(--color-text-primary)]"}`}
        >
          {value.hour12}
        </button>
        <span className="text-[28px] font-semibold text-[var(--color-text-muted)]">:</span>
        <button
          type="button"
          onClick={() => setHand("minute")}
          className={`text-[28px] font-semibold tabular-nums transition-colors ${hand === "minute" ? "text-[var(--color-accent-violet)]" : "text-[var(--color-text-primary)]"}`}
        >
          {String(value.minute).padStart(2, "0")}
        </button>
        <div className="flex gap-1 ml-2 p-1 rounded-lg bg-white border border-[var(--color-border-subtle)]">
          {(["AM", "PM"] as const).map((mer) => (
            <button
              key={mer}
              type="button"
              onClick={() => onChange({ ...value, meridiem: mer })}
              className={`px-2.5 py-1 rounded-md text-[12.5px] font-semibold transition-colors ${value.meridiem === mer ? "bg-[var(--color-accent-violet)] text-white" : "text-[var(--color-text-secondary)]"}`}
            >
              {mer}
            </button>
          ))}
        </div>
      </div>

      <svg
        ref={svgRef}
        width={CLOCK_SIZE}
        height={CLOCK_SIZE}
        viewBox={`0 0 ${CLOCK_SIZE} ${CLOCK_SIZE}`}
        className="touch-none select-none cursor-pointer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <circle cx={CLOCK_CENTER} cy={CLOCK_CENTER} r={CLOCK_RADIUS + 10} fill="white" stroke="var(--color-border-subtle)" />
        {(hand === "hour" ? Array.from({ length: 12 }, (_, i) => i + 1) : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]).map((n) => {
          const deg = hand === "hour" ? hourToAngle(n === 12 ? 12 : n) : minuteToAngle(n);
          const lx = CLOCK_CENTER + CLOCK_RADIUS * Math.sin((deg * Math.PI) / 180);
          const ly = CLOCK_CENTER - CLOCK_RADIUS * Math.cos((deg * Math.PI) / 180);
          return (
            <text key={n} x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize="13" fill="var(--color-text-secondary)" className="pointer-events-none select-none">
              {hand === "minute" ? String(n).padStart(2, "0") : n}
            </text>
          );
        })}
        <line x1={CLOCK_CENTER} y1={CLOCK_CENTER} x2={handX} y2={handY} stroke="var(--color-accent-violet)" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={CLOCK_CENTER} cy={CLOCK_CENTER} r={4} fill="var(--color-accent-violet)" />
        <circle cx={knobX} cy={knobY} r={13} fill="var(--color-accent-violet)" opacity={0.18} />
        <circle cx={knobX} cy={knobY} r={5} fill="var(--color-accent-violet)" />
      </svg>

      <p className="text-[12px] text-[var(--color-text-muted)]">
        {hand === "hour" ? "Drag to set the hour, then the minute" : "Drag anywhere on the dial — any minute, not just 5s"}
      </p>
    </div>
  );
}
