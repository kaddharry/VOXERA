"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  History,
  Loader2,
  Lock,
  Pause,
  Pencil,
  Phone,
  Play,
  RotateCcw,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import { DateRangeTimePicker, timeOfDayToMinutes, type DateSelectionValue } from "./DateRangeTimePicker";
import { todayIn, type DayLockReason, type DayState, type Schedule } from "../../lib/scheduler/schedules";

/* ------------------------------------------------------------------ */
/* Types & formatting                                                  */
/* ------------------------------------------------------------------ */

interface Agent {
  id: string;
  name: string;
}

interface ScheduleCall {
  id: string;
  sessionId: string | null;
  taskId: string;
  status: string;
  startedAt: number;
  durationMs: number | null;
  outcome: string | null;
}

interface ScheduleAlert {
  id: string;
  taskId: string;
  reason: string;
  status: string;
  createdAt: number;
}

interface ScheduleDetails {
  schedule: Schedule;
  now: number;
  calls: ScheduleCall[];
  alerts: ScheduleAlert[];
}

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function formatDay(key: string, withWeekday = true): string {
  return keyToDate(key).toLocaleDateString(undefined, {
    ...(withWeekday ? { weekday: "short" as const } : {}),
    day: "numeric",
    month: "short",
  });
}

function formatRange(start: string, end: string): string {
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`;
}

export function formatMinute(minute: number): string {
  const d = new Date(2000, 0, 1, Math.floor(minute / 60), minute % 60);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatInstant(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleString(undefined, { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function timezoneLabel(timeZone: string): string {
  try {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return offset ? `${timeZone.replace(/_/g, " ")} (${offset})` : timeZone;
  } catch {
    return timeZone;
  }
}

const STATE_META: Record<DayState, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-sky-500/10 text-sky-300 border-sky-500/25" },
  retrying: { label: "Retrying", className: "bg-amber-500/10 text-amber-300 border-amber-500/25" },
  calling: { label: "Calling now", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  paused: { label: "Paused", className: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
  completed: { label: "Completed", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" },
  exhausted: { label: "Exhausted", className: "bg-red-500/10 text-red-300 border-red-500/25" },
  needs_review: { label: "Awaiting review", className: "bg-orange-500/10 text-orange-300 border-orange-500/25" },
  cancelled: { label: "Cancelled", className: "bg-slate-500/10 text-slate-400 border-slate-500/25" },
};

const LOCK_LABEL: Record<Exclude<DayLockReason, null>, string> = {
  today: "Today — locked",
  past: "Past",
  in_progress: "Call in progress",
  already_attempted: "Already attempted",
  finished: "Finished",
};

const KIND_LABEL: Record<Schedule["kind"], string> = {
  range: "Date range",
  programme: "Programme",
  single: "Single call",
};

function StateBadge({ state }: { state: DayState }) {
  const meta = STATE_META[state];
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${meta.className}`}>
      {meta.label}
    </span>
  );
}

/** One-line overall status for a schedule card. */
function scheduleStatus(s: Schedule): { label: string; state: DayState } {
  if (s.counts.calling > 0) return { label: "Calling now", state: "calling" };
  if (s.section === "past") {
    if (s.counts.needs_review > 0) return { label: "Finished · needs review", state: "needs_review" };
    if (s.counts.completed === 0 && s.counts.cancelled === s.days.length) return { label: "Cancelled", state: "cancelled" };
    return { label: "Finished", state: "completed" };
  }
  if (s.counts.retrying > 0) return { label: "Active · retrying", state: "retrying" };
  if (s.counts.pending === 0 && s.counts.paused > 0) return { label: "Paused", state: "paused" };
  return { label: "Active", state: "pending" };
}

function progressText(s: Schedule): string {
  const done = s.counts.completed + s.counts.exhausted + s.counts.needs_review;
  const upcoming = s.counts.pending + s.counts.paused + s.counts.retrying + s.counts.calling;
  const parts = [`${done} of ${s.days.length} day${s.days.length === 1 ? "" : "s"} done`];
  if (upcoming > 0) parts.push(`${upcoming} to go`);
  if (s.counts.cancelled > 0) parts.push(`${s.counts.cancelled} cancelled`);
  return parts.join(" · ");
}

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10.5px] font-mono uppercase tracking-widest text-[var(--color-text-muted)]">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-[13px] text-[var(--color-text-primary)] break-words">{children}</div>
    </div>
  );
}

function ConfigGrid({ schedule, agentName }: { schedule: Schedule; agentName: string }) {
  const c = schedule.config;
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
      <Field icon={<CalendarRange className="h-3 w-3" />} label="Dates">
        {formatRange(schedule.startDate, schedule.endDate)}
        <span className="text-[var(--color-text-muted)]"> · {schedule.days.length} day{schedule.days.length === 1 ? "" : "s"}</span>
      </Field>
      <Field icon={<Clock className="h-3 w-3" />} label="Daily time">
        {c.minutes.map(formatMinute).join(", ")}
        {c.minutes.length > 1 && <span className="text-[var(--color-text-muted)]"> (varies by day)</span>}
      </Field>
      <Field icon={<Globe className="h-3 w-3" />} label="Timezone">
        {timezoneLabel(c.timezone)}
      </Field>
      <Field icon={<RotateCcw className="h-3 w-3" />} label="Retries">
        Up to {c.maxAttempts} attempt{c.maxAttempts === 1 ? "" : "s"} a day, {c.retryDelayMinutes} min apart
      </Field>
      <Field icon={<User className="h-3 w-3" />} label="Agent">
        {agentName}
      </Field>
      {c.windowStartMinute != null && c.windowEndMinute != null && (
        <Field icon={<Lock className="h-3 w-3" />} label="Calling hours">
          {formatMinute(c.windowStartMinute)} – {formatMinute(c.windowEndMinute)}
        </Field>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Schedule card                                                       */
/* ------------------------------------------------------------------ */

function ScheduleCard({ schedule, agentName, onOpen }: { schedule: Schedule; agentName: string; onOpen: () => void }) {
  const status = scheduleStatus(schedule);
  const isPast = schedule.section === "past";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group w-full rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-violet)]/60 ${
        isPast
          ? "border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/60 hover:border-[var(--color-border-active)]"
          : "border-[var(--color-accent-violet)]/30 bg-[var(--color-accent-violet)]/[0.06] hover:border-[var(--color-accent-violet)]/60"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">{formatRange(schedule.startDate, schedule.endDate)}</div>
          <div className="mt-0.5 text-[11.5px] text-[var(--color-text-muted)]">
            {KIND_LABEL[schedule.kind]} · {progressText(schedule)}
          </div>
        </div>
        <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATE_META[status.state].className}`}>
          {status.label}
        </span>
      </div>

      {isPast ? (
        <div className="mt-2 text-[12px] text-[var(--color-text-secondary)]">
          {schedule.config.minutes.map(formatMinute).join(", ")} · {agentName}
        </div>
      ) : (
        <div className="mt-3">
          <ConfigGrid schedule={schedule} agentName={agentName} />
        </div>
      )}
      <div className="mt-3 text-[11.5px] font-semibold text-[var(--color-accent-violet)] group-hover:underline">
        {isPast ? "View history" : "View details & edit"} →
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

type View = { type: "list" } | { type: "details"; scheduleId: string } | { type: "edit"; scheduleId: string } | { type: "clear" };

/**
 * The Follow-ups panel for one patient: "Current ongoing schedule" (with
 * details and editing of upcoming days) and "Past schedule" (read-only
 * history, with "Clear past schedules"). Every rule shown here — which
 * days are locked, what counts as past, what can be cleared — comes from
 * the server (lib/scheduler/schedules.ts), which also enforces it.
 */
export function FollowUpSchedulesPanel({
  patientId,
  patientName,
  agents,
  onChanged,
}: {
  patientId: string;
  patientName: string;
  agents: Agent[];
  /** Called after an edit or clear, so the page can refresh other views. */
  onChanged?: () => void;
}) {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [serverNow, setServerNow] = useState<number>(() => Date.now());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ type: "list" });
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const listRef = useScrollToTopOnMount();

  const agentName = useCallback((id: string | null) => agents.find((a) => a.id === id)?.name ?? (id ? "Unknown agent" : "No agent"), [agents]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/patients/${patientId}/follow-ups`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { schedules?: Schedule[]; now?: number };
      setSchedules(data.schedules ?? []);
      setServerNow(data.now ?? Date.now());
    } catch {
      setLoadError("Couldn't load follow-ups. Check your connection and try again.");
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = (schedules ?? []).filter((s) => s.section === "current");
  const past = (schedules ?? []).filter((s) => s.section === "past");
  const clearable = past.filter((s) => s.clearable);

  async function afterChange(text: string) {
    setNotice({ kind: "success", text });
    await load();
    onChanged?.();
  }

  if (view.type === "details" || view.type === "edit") {
    const schedule = schedules?.find((s) => s.id === view.scheduleId);
    if (!schedule) {
      return (
        <BackBar onBack={() => setView({ type: "list" })}>
          <p className="py-6 text-center text-[12.5px] text-[var(--color-text-muted)]">This schedule no longer exists.</p>
        </BackBar>
      );
    }
    if (view.type === "edit") {
      return (
        <ScheduleEditor
          patientId={patientId}
          schedule={schedule}
          serverNow={serverNow}
          agents={agents}
          onCancel={() => setView({ type: "details", scheduleId: schedule.id })}
          onSaved={async (message) => {
            await afterChange(message);
            setView({ type: "details", scheduleId: schedule.id });
          }}
          onStale={async (message) => {
            setNotice({ kind: "error", text: message });
            await load();
          }}
        />
      );
    }
    return (
      <ScheduleDetailsView
        patientId={patientId}
        schedule={schedule}
        agentName={agentName}
        onDayAction={async (taskId, action) => {
          const res = await fetch(`/api/follow-ups/${taskId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            setNotice({ kind: "error", text: data.error ?? "That day's call couldn't be changed — it may have just started." });
            await load();
            return;
          }
          await afterChange(action === "pause" ? "Call paused." : action === "resume" ? "Call resumed." : "That day's call was cancelled.");
        }}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        onBack={() => {
          setNotice(null);
          setView({ type: "list" });
        }}
        onEdit={() => {
          setNotice(null);
          setView({ type: "edit", scheduleId: schedule.id });
        }}
      />
    );
  }

  if (view.type === "clear") {
    return (
      <ClearPastConfirm
        patientId={patientId}
        schedules={clearable}
        onCancel={() => setView({ type: "list" })}
        onCleared={async (text) => {
          setView({ type: "list" });
          await afterChange(text);
        }}
      />
    );
  }

  return (
    <div ref={listRef} className="flex flex-col gap-6">
      {notice && <Notice notice={notice} onDismiss={() => setNotice(null)} />}

      {loadError ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] p-5 text-center">
          <p className="text-[12.5px] text-red-300">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            Try again
          </button>
        </div>
      ) : schedules === null ? (
        <div className="flex justify-center py-8" role="status" aria-label="Loading follow-ups">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-text-muted)]" />
        </div>
      ) : (
        <>
          <section aria-labelledby="current-schedule-heading">
            <h3 id="current-schedule-heading" className="mb-2.5 flex items-center gap-1.5 text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)]">
              <CalendarClock className="h-3.5 w-3.5" /> Current ongoing schedule
            </h3>
            {current.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--color-border-subtle)] p-4 text-[12.5px] text-[var(--color-text-muted)]">
                No active schedule for {patientName}. Use &ldquo;Schedule&rdquo; to set one up.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {current.map((s) => (
                  <ScheduleCard key={s.id} schedule={s} agentName={agentName(s.config.agentId)} onOpen={() => setView({ type: "details", scheduleId: s.id })} />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="past-schedule-heading">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <h3 id="past-schedule-heading" className="flex items-center gap-1.5 text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)]">
                <History className="h-3.5 w-3.5" /> Past schedule
              </h3>
              {clearable.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setView({ type: "clear" });
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-[11.5px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-red-500/40 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear past schedules
                </button>
              )}
            </div>
            {past.length === 0 ? (
              <p className="text-[12.5px] text-[var(--color-text-muted)]">No past schedules.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {past.map((s) => (
                  <ScheduleCard key={s.id} schedule={s} agentName={agentName(s.config.agentId)} onOpen={() => setView({ type: "details", scheduleId: s.id })} />
                ))}
                {clearable.length < past.length && (
                  <p className="text-[11.5px] text-[var(--color-text-muted)]">Schedules that finished today can be cleared from tomorrow.</p>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Notice({ notice, onDismiss }: { notice: { kind: "success" | "error"; text: string }; onDismiss: () => void }) {
  const ok = notice.kind === "success";
  return (
    <div
      role={ok ? "status" : "alert"}
      className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] ${
        ok ? "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-300" : "border-red-500/30 bg-red-500/[0.07] text-red-300"
      }`}
    >
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" /> : <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />}
      <span className="min-w-0 flex-1">{notice.text}</span>
      <button type="button" onClick={onDismiss} className="flex-none text-[11px] font-semibold opacity-80 hover:opacity-100">
        Dismiss
      </button>
    </div>
  );
}

/**
 * Each view of the panel (list, details, edit, clear) starts at the top of
 * whatever scrolls it. Without this, switching views kept the previous
 * view's scroll position, and the edit form opened halfway down — below
 * its lock notice.
 */
function useScrollToTopOnMount() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let el: HTMLElement | null = ref.current?.parentElement ?? null;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    el?.scrollTo({ top: 0 });
  }, []);
  return ref;
}

function BackBar({ onBack, title, children }: { onBack: () => void; title?: ReactNode; children: ReactNode }) {
  const ref = useScrollToTopOnMount();
  return (
    <div ref={ref} className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[12px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-violet)]/60"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        {title && <div className="min-w-0 truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{title}</div>}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Details                                                             */
/* ------------------------------------------------------------------ */

function ScheduleDetailsView({
  patientId,
  schedule,
  agentName,
  onDayAction,
  notice,
  onDismissNotice,
  onBack,
  onEdit,
}: {
  patientId: string;
  schedule: Schedule;
  agentName: (id: string | null) => string;
  onDayAction: (taskId: string, action: "pause" | "resume" | "cancel") => Promise<void>;
  notice: { kind: "success" | "error"; text: string } | null;
  onDismissNotice: () => void;
  onBack: () => void;
  onEdit: () => void;
}) {
  const [details, setDetails] = useState<ScheduleDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPast = schedule.section === "past";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/patients/${patientId}/schedules/${encodeURIComponent(schedule.id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return (await r.json()) as ScheduleDetails;
      })
      .then((d) => {
        if (!cancelled) setDetails(d);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load call history for this schedule.");
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, schedule]);

  const callsByTask = useMemo(() => {
    const map = new Map<string, ScheduleCall[]>();
    for (const c of details?.calls ?? []) map.set(c.taskId, [...(map.get(c.taskId) ?? []), c]);
    return map;
  }, [details]);
  const alertsByTask = useMemo(() => {
    const map = new Map<string, ScheduleAlert[]>();
    for (const a of details?.alerts ?? []) map.set(a.taskId, [...(map.get(a.taskId) ?? []), a]);
    return map;
  }, [details]);

  return (
    <BackBar onBack={onBack} title={formatRange(schedule.startDate, schedule.endDate)}>
      {notice && <Notice notice={notice} onDismiss={onDismissNotice} />}

      <section aria-labelledby="configured-heading" className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="configured-heading" className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)]">
            Configured schedule
          </h3>
          <span className="text-[11px] text-[var(--color-text-muted)]">{KIND_LABEL[schedule.kind]}</span>
        </div>
        <ConfigGrid schedule={schedule} agentName={agentName(schedule.config.agentId)} />
      </section>

      <section aria-labelledby="history-heading">
        <h3 id="history-heading" className="mb-2.5 text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-muted)]">
          {isPast ? "What happened" : "Day by day"}
        </h3>
        {error && <p className="mb-2 text-[12px] text-red-300">{error}</p>}
        <ol className="flex flex-col gap-2">
          {schedule.days.map((day) => {
            const calls = callsByTask.get(day.taskId) ?? [];
            const alerts = alertsByTask.get(day.taskId) ?? [];
            return (
              <li key={day.taskId} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{formatDay(day.date)}</span>
                    <span className="text-[12px] text-[var(--color-text-muted)]"> · {formatMinute(day.minute)}</span>
                    {day.label && <span className="text-[12px] text-[var(--color-text-muted)]"> · {day.label}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!isPast && day.lock && day.lock !== "finished" && day.lock !== "past" && (
                      <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--color-text-muted)]">
                        <Lock className="h-3 w-3" /> {LOCK_LABEL[day.lock]}
                      </span>
                    )}
                    <StateBadge state={day.state} />
                  </div>
                </div>
                <div className="mt-1 text-[11.5px] text-[var(--color-text-muted)]">
                  {day.attemptCount > 0
                    ? `${day.attemptCount} of ${day.maxAttempts} attempt${day.maxAttempts === 1 ? "" : "s"} made`
                    : `Up to ${day.maxAttempts} attempt${day.maxAttempts === 1 ? "" : "s"}`}
                  {day.state === "retrying" && ` · next try ${formatInstant(day.nextAttemptAt, schedule.config.timezone)}`}
                  {day.lastOutcome && ` · last result: ${day.lastOutcome.replace(/_/g, " ")}`}
                </div>
                {calls.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {calls.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-[var(--color-text-secondary)]">
                        <Phone className="h-3 w-3 flex-none text-[var(--color-text-muted)]" />
                        <span>{formatInstant(c.startedAt, schedule.config.timezone)}</span>
                        <span className="text-[var(--color-text-muted)]">· {c.status}</span>
                        {c.durationMs != null && <span className="text-[var(--color-text-muted)]">· {Math.round(c.durationMs / 1000)}s</span>}
                        {c.outcome && <span className="text-[var(--color-text-muted)]">· outcome: {c.outcome.replace(/_/g, " ")}</span>}
                        {c.sessionId && (
                          <Link href={`/admin/live_dashboard?session=${c.sessionId}`} className="inline-flex items-center gap-0.5 font-semibold text-[var(--color-accent-violet)] hover:underline">
                            Transcript <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {alerts.map((a) => (
                  <p key={a.id} className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-orange-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" /> {a.reason}
                  </p>
                ))}
                {(day.status === "scheduled" || day.status === "paused") && (
                  <DayCallControls status={day.status} date={day.date} onAction={(action) => onDayAction(day.taskId, action)} />
                )}
              </li>
            );
          })}
        </ol>
        {!details && !error && (
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-muted)]">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading call history…
          </p>
        )}
      </section>

      {isPast ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-muted)]">
          <Lock className="h-3 w-3" /> Past schedules are read-only.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-end">
          {schedule.editableDays === 0 && (
            <p id="edit-blocked" className="text-[11.5px] text-[var(--color-text-muted)] sm:mr-auto">
              {schedule.editBlockedReason}
            </p>
          )}
          <button
            type="button"
            onClick={onEdit}
            disabled={schedule.editableDays === 0}
            aria-describedby={schedule.editableDays === 0 ? "edit-blocked" : undefined}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent-violet)] px-4 py-2 text-[13px] font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit schedule
          </button>
        </div>
      )}
    </BackBar>
  );
}

/**
 * Pause / resume / cancel one day's call — the same controls the old
 * Follow-ups list had, kept separate from "Edit schedule". They work on
 * today's call too, so staff can always stop a call (e.g. the patient
 * asked not to be called today); they never change the schedule's
 * configuration. Cancelling asks for confirmation first.
 */
function DayCallControls({
  status,
  date,
  onAction,
}: {
  status: "scheduled" | "paused";
  date: string;
  onAction: (action: "pause" | "resume" | "cancel") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const run = async (action: "pause" | "resume" | "cancel") => {
    setBusy(true);
    try {
      await onAction(action);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  const btn =
    "inline-flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-[11.5px] font-semibold transition-colors disabled:opacity-40";

  if (confirming) {
    return (
      <div role="group" aria-label={`Cancel the call on ${formatDay(date)}?`} className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--color-text-secondary)]">
        <span>Cancel the call on {formatDay(date)}? Other days aren&rsquo;t affected.</span>
        <button type="button" disabled={busy} onClick={() => void run("cancel")} className={`${btn} border-red-500/40 text-red-300 hover:bg-red-500/10`}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />} Yes, cancel
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={`${btn} text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]`}>
          Keep it
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(status === "scheduled" ? "pause" : "resume")}
        className={`${btn} text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]`}
      >
        {status === "scheduled" ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        {status === "scheduled" ? "Pause" : "Resume"}
      </button>
      <button type="button" disabled={busy} onClick={() => setConfirming(true)} className={`${btn} text-[var(--color-text-secondary)] hover:border-red-500/40 hover:text-red-300`}>
        <XCircle className="h-3 w-3" /> Cancel call
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Edit                                                                */
/* ------------------------------------------------------------------ */

const EDIT_NOTICE =
  "Only upcoming days can be edited. Today's schedule is locked and cannot be changed. Future dates can be modified until 11:59 PM on the preceding day, according to the patient's schedule timezone.";

function minuteToPicker(minute: number): Pick<DateSelectionValue, "hour12" | "minute" | "meridiem"> {
  const h24 = Math.floor(minute / 60);
  return { hour12: h24 % 12 === 0 ? 12 : h24 % 12, minute: minute % 60, meridiem: h24 >= 12 ? "PM" : "AM" };
}

function allTimezones(current: string): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    list = [];
  }
  return list.includes(current) ? list : [current, ...list];
}

function ScheduleEditor({
  patientId,
  schedule,
  serverNow,
  agents,
  onCancel,
  onSaved,
  onStale,
}: {
  patientId: string;
  schedule: Schedule;
  serverNow: number;
  agents: Agent[];
  onCancel: () => void;
  onSaved: (message: string) => void | Promise<void>;
  onStale: (message: string) => void | Promise<void>;
}) {
  const editableDays = schedule.days.filter((d) => d.lock === null);
  const lockedDays = schedule.days.filter((d) => d.lock !== null && d.state !== "cancelled");
  const startMinute = editableDays[0]?.minute ?? schedule.config.minutes[0] ?? 600;

  const [value, setValue] = useState<DateSelectionValue>(() => ({ days: editableDays.map((d) => d.date), ...minuteToPicker(startMinute) }));
  const [timeText, setTimeText] = useState(() => `${String(Math.floor(startMinute / 60)).padStart(2, "0")}:${String(startMinute % 60).padStart(2, "0")}`);
  const [timezone, setTimezone] = useState(schedule.config.timezone);
  const [maxAttempts, setMaxAttempts] = useState(schedule.config.maxAttempts);
  const [retryDelay, setRetryDelay] = useState(schedule.config.retryDelayMinutes);
  const [agentId, setAgentId] = useState(schedule.config.agentId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timezones = useMemo(() => allTimezones(schedule.config.timezone), [schedule.config.timezone]);

  // Earliest editable date: tomorrow in the schedule's own timezone.
  const firstEditable = addDays(todayIn(schedule.config.timezone, serverNow), 1);
  const futureLocked = lockedDays.filter((d) => d.date >= firstEditable).map((d) => d.date);

  const isRange = schedule.kind === "range";
  const minute = isRange ? timeOfDayToMinutes(value.hour12, value.minute, value.meridiem) : (() => {
    const [h, m] = timeText.split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  })();

  const existing = new Set(editableDays.map((d) => d.date));
  const wanted = new Set(value.days);
  const adding = [...wanted].filter((d) => !existing.has(d)).length;
  const removing = [...existing].filter((d) => !wanted.has(d)).length;
  const keeping = [...wanted].filter((d) => existing.has(d)).length;

  const invalid =
    !Number.isFinite(minute) ||
    !agentId ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 10 ||
    !Number.isInteger(retryDelay) ||
    retryDelay < 1 ||
    retryDelay > 1440;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/patients/${patientId}/schedules/${encodeURIComponent(schedule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isRange ? { dates: value.days } : {}),
          minute,
          timezone,
          maxAttempts,
          retryDelayMinutes: retryDelay,
          agentId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string | null };
      if (res.status === 409) {
        await onStale(data.error ?? "Some days became locked while you were editing. The schedule has been reloaded.");
        onCancel();
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Couldn't save the changes.");
        return;
      }
      await onSaved(data.message ?? "Schedule updated. Only upcoming days were changed.");
    } catch {
      setError("Couldn't save the changes. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-[13.5px] text-[var(--color-text-primary)] focus:border-[var(--color-accent-violet)]/60 focus:outline-none";
  const labelClass = "mb-1.5 block text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)]";

  return (
    <BackBar onBack={onCancel} title="Edit schedule">
      <div role="note" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-200">
        <Lock className="mt-0.5 h-4 w-4 flex-none" />
        <span>{EDIT_NOTICE}</span>
      </div>

      {lockedDays.length > 0 && (
        <div>
          <div className={labelClass}>Locked days — these won&rsquo;t change</div>
          <ul className="flex flex-wrap gap-1.5">
            {lockedDays.map((d) => (
              <li
                key={d.taskId}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2 py-1 text-[11.5px] text-[var(--color-text-muted)]"
              >
                <Lock className="h-3 w-3" />
                {formatDay(d.date)} · {d.lock ? LOCK_LABEL[d.lock] : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isRange ? (
        <div>
          <div className={labelClass}>Upcoming days &amp; daily time (from {formatDay(firstEditable)})</div>
          <div className="max-w-md">
            <DateRangeTimePicker value={value} onChange={setValue} minDateKey={firstEditable} disabledKeys={futureLocked} />
          </div>
          <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">
            {keeping} kept · {adding} added · {removing} removed{removing > 0 ? " (removed days are cancelled, not deleted)" : ""}
          </p>
        </div>
      ) : (
        <div>
          <label htmlFor="schedule-time" className={labelClass}>
            Call time {schedule.kind === "programme" ? "for every upcoming step" : ""}
          </label>
          <input id="schedule-time" type="time" value={timeText} onChange={(e) => setTimeText(e.target.value)} className={`${inputClass} sm:w-48`} />
          <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">
            Applies to {editableDays.length} upcoming day{editableDays.length === 1 ? "" : "s"}: {editableDays.map((d) => formatDay(d.date)).join(", ")}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="schedule-tz" className={labelClass}>
            Timezone
          </label>
          <select id="schedule-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputClass}>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="schedule-attempts" className={labelClass}>
            Max attempts / day
          </label>
          <input id="schedule-attempts" type="number" min={1} max={10} value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))} className={inputClass} />
        </div>
        <div>
          <label htmlFor="schedule-retry" className={labelClass}>
            Retry after (min)
          </label>
          <input id="schedule-retry" type="number" min={1} max={1440} value={retryDelay} onChange={(e) => setRetryDelay(Number(e.target.value))} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="schedule-agent" className={labelClass}>
            Agent
          </label>
          <select id="schedule-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} className={inputClass}>
            <option value="">Select an agent…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-[12.5px] text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || invalid}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent-violet)] px-4 py-2 text-[13px] font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save changes
        </button>
      </div>
    </BackBar>
  );
}

/* ------------------------------------------------------------------ */
/* Clear past                                                          */
/* ------------------------------------------------------------------ */

function ClearPastConfirm({
  patientId,
  schedules,
  onCancel,
  onCleared,
}: {
  patientId: string;
  schedules: Schedule[];
  onCancel: () => void;
  onCleared: (message: string) => void | Promise<void>;
}) {
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dayCount = schedules.reduce((n, s) => n + s.days.length, 0);

  async function confirm() {
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/patients/${patientId}/schedules/clear-past`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; clearedSchedules?: number };
      if (!res.ok) {
        setError(data.error ?? "Couldn't clear past schedules.");
        return;
      }
      const n = data.clearedSchedules ?? 0;
      await onCleared(n === 0 ? "Nothing to clear." : `Cleared ${n} past schedule${n === 1 ? "" : "s"}.`);
    } catch {
      setError("Couldn't clear past schedules. Check your connection and try again.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <BackBar onBack={onCancel} title="Clear past schedules">
      <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] p-4 text-[12.5px] leading-relaxed text-[var(--color-text-secondary)]">
        <p className="font-semibold text-[var(--color-text-primary)]">
          This hides {schedules.length} finished schedule{schedules.length === 1 ? "" : "s"} ({dayCount} day{dayCount === 1 ? "" : "s"}) from this list:
        </p>
        <ul className="mt-2 list-disc pl-5">
          {schedules.map((s) => (
            <li key={s.id}>{formatRange(s.startDate, s.endDate)}</li>
          ))}
        </ul>
        <p className="mt-3">
          <strong className="text-[var(--color-text-primary)]">Nothing is deleted.</strong> Call recordings, transcripts, summaries and alerts stay
          available in Calls &amp; Insights and the patient&rsquo;s call history. Current and upcoming schedules, calls in progress and pending
          retries are never affected.
        </p>
        <p className="mt-2">This can&rsquo;t be undone from the dashboard.</p>
      </div>

      {error && (
        <p role="alert" className="text-[12.5px] text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={clearing}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-red-500/90 px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-red-500 disabled:opacity-50"
        >
          {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Clear {schedules.length} past schedule{schedules.length === 1 ? "" : "s"}
        </button>
      </div>
    </BackBar>
  );
}
