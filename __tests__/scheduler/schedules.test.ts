import { describe, it, expect } from "vitest";
import {
  dayLock,
  groupSchedules,
  isClearable,
  isDateLocked,
  planScheduleEdit,
  scheduleIdOf,
  zonedDateTimeToMs,
  type ScheduleTask,
} from "../../lib/scheduler/schedules";
import { isValidTimeZone } from "../../lib/scheduler/validation";

const TZ = "Asia/Kolkata"; // UTC+5:30, no DST
/** An instant given as Kolkata wall-clock time. */
const ist = (date: string, hh: number, mm = 0) => zonedDateTimeToMs(date, hh * 60 + mm, TZ);

let seq = 0;
function task(date: string, overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id: `t${++seq}`,
    status: "scheduled",
    nextAttemptAt: ist(date, 10),
    timezone: TZ,
    windowStartMinute: null,
    windowEndMinute: null,
    maxAttempts: 3,
    attemptCount: 0,
    retryDelayMinutes: 30,
    agentId: "agent-a",
    lastOutcome: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: 0,
    rangeGroupId: "range_1",
    programmeId: null,
    scheduledDate: date,
    scheduledMinute: 600,
    archivedAt: null,
    ...overrides,
  };
}

// "Now" = 26 Oct 2026, 3:30 pm in Kolkata.
const NOW = ist("2026-10-26", 15, 30);

describe("1. grouping daily tasks into their schedule", () => {
  it("groups a date range's days into one schedule, ordered by date", () => {
    const tasks = [task("2026-10-28"), task("2026-10-26", { status: "completed" }), task("2026-10-27")];
    const schedules = groupSchedules(tasks, NOW);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].days.map((d) => d.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
    expect(schedules[0].startDate).toBe("2026-10-26");
    expect(schedules[0].endDate).toBe("2026-10-28");
  });

  it("keeps separate ranges, programmes and single calls apart", () => {
    const tasks = [
      task("2026-10-27", { rangeGroupId: "range_1" }),
      task("2026-10-27", { rangeGroupId: "range_2" }),
      task("2026-10-29", { rangeGroupId: null, programmeId: "prog_1" }),
      task("2026-10-30", { rangeGroupId: null, programmeId: "prog_1" }),
      task("2026-11-02", { rangeGroupId: null, id: "solo" }),
    ];
    const ids = groupSchedules(tasks, NOW).map((s) => s.id).sort();
    expect(ids).toEqual(["programme:prog_1", "range:range_1", "range:range_2", "task:solo"]);
  });

  it("uses the planned time, not a retry's time, for the schedule's daily time", () => {
    // Retried from 10:00 to 10:30 — the plan was 10:00.
    const t = task("2026-10-27", { nextAttemptAt: ist("2026-10-27", 10, 30), attemptCount: 1 });
    expect(groupSchedules([t], NOW)[0].days[0].minute).toBe(600);
  });

  it("falls back to nextAttemptAt for rows created before migration v23", () => {
    const t = task("2026-10-27", { scheduledDate: null, scheduledMinute: null, nextAttemptAt: ist("2026-10-27", 9, 15) });
    const [day] = groupSchedules([t], NOW)[0].days;
    expect(day.date).toBe("2026-10-27");
    expect(day.minute).toBe(9 * 60 + 15);
  });

  it("leaves archived (cleared) tasks out", () => {
    expect(groupSchedules([task("2026-10-20", { status: "completed", archivedAt: 1 })], NOW)).toEqual([]);
  });
});

describe("2. current vs past", () => {
  it("keeps a multi-day schedule current after its first call, while days remain", () => {
    const [s] = groupSchedules([task("2026-10-25", { status: "completed" }), task("2026-10-27")], NOW);
    expect(s.section).toBe("current");
    expect(s.counts.completed).toBe(1);
    expect(s.counts.pending).toBe(1);
  });

  it("treats a schedule as past once every day is finished", () => {
    const [s] = groupSchedules(
      [task("2026-10-20", { status: "completed" }), task("2026-10-21", { status: "exhausted" }), task("2026-10-22", { status: "needs_review" })],
      NOW,
    );
    expect(s.section).toBe("past");
  });

  it("keeps a schedule with a call in progress current", () => {
    const [s] = groupSchedules([task("2026-10-26", { status: "calling" })], NOW);
    expect(s.section).toBe("current");
    expect(s.days[0].state).toBe("calling");
  });

  it("lists current schedules before past ones", () => {
    const schedules = groupSchedules(
      [task("2026-10-10", { rangeGroupId: "old", status: "completed" }), task("2026-10-27", { rangeGroupId: "new" })],
      NOW,
    );
    expect(schedules.map((s) => s.section)).toEqual(["current", "past"]);
  });

  it("labels what happened on each day", () => {
    const states = groupSchedules(
      [
        task("2026-10-20", { status: "completed" }),
        task("2026-10-21", { status: "exhausted" }),
        task("2026-10-22", { status: "needs_review" }),
        task("2026-10-26", { status: "scheduled", attemptCount: 1 }),
        task("2026-10-27"),
      ],
      NOW,
    )[0].days.map((d) => d.state);
    expect(states).toEqual(["completed", "exhausted", "needs_review", "retrying", "pending"]);
  });
});

describe("3. midnight locking in the schedule's timezone", () => {
  it("locks today and earlier, keeps tomorrow open", () => {
    expect(isDateLocked("2026-10-26", TZ, NOW)).toBe(true);
    expect(isDateLocked("2026-10-25", TZ, NOW)).toBe(true);
    expect(isDateLocked("2026-10-27", TZ, NOW)).toBe(false);
  });

  it("lets tomorrow be edited until 23:59:59 tonight, then locks it at midnight", () => {
    expect(isDateLocked("2026-10-27", TZ, ist("2026-10-26", 23, 59) + 59_000)).toBe(false);
    expect(isDateLocked("2026-10-27", TZ, ist("2026-10-27", 0, 0))).toBe(true);
  });

  it("uses the schedule's timezone, not the server's", () => {
    // 20:00 UTC on 26 Oct is already 01:30 on 27 Oct in Kolkata, but still
    // 13:00 on 26 Oct in Los Angeles.
    const now = Date.UTC(2026, 9, 26, 20, 0);
    expect(isDateLocked("2026-10-27", "Asia/Kolkata", now)).toBe(true);
    expect(isDateLocked("2026-10-27", "America/Los_Angeles", now)).toBe(false);
  });

  it("handles a DST change: midnight is still midnight local time", () => {
    // America/New_York leaves DST on 1 Nov 2026. 23:59 EDT on 31 Oct and
    // 00:00 EST... the lock flips exactly at local midnight on 1 Nov.
    const tz = "America/New_York";
    expect(isDateLocked("2026-11-01", tz, zonedDateTimeToMs("2026-10-31", 23 * 60 + 59, tz))).toBe(false);
    expect(isDateLocked("2026-11-01", tz, zonedDateTimeToMs("2026-11-01", 0, tz))).toBe(true);
  });

  it("says why a day can't be edited", () => {
    expect(dayLock(task("2026-10-26"), NOW)).toBe("today");
    expect(dayLock(task("2026-10-24", { status: "completed" }), NOW)).toBe("past");
    expect(dayLock(task("2026-10-28", { status: "calling" }), NOW)).toBe("in_progress");
    expect(dayLock(task("2026-10-28", { attemptCount: 1 }), NOW)).toBe("already_attempted");
    expect(dayLock(task("2026-10-28", { status: "cancelled" }), NOW)).toBe("finished");
    expect(dayLock(task("2026-10-28"), NOW)).toBeNull();
    expect(dayLock(task("2026-10-28", { status: "paused" }), NOW)).toBeNull();
  });

  it("disables editing and explains why when no future day is editable", () => {
    const [s] = groupSchedules([task("2026-10-25", { status: "completed" }), task("2026-10-26")], NOW);
    expect(s.editableDays).toBe(0);
    expect(s.editBlockedReason).toMatch(/Today's schedule is locked/);
  });
});

describe("4–7. editing future days", () => {
  const range = () => {
    seq = 100;
    return [
      task("2026-10-25", { status: "completed" }), // past
      task("2026-10-26", { status: "scheduled", attemptCount: 1 }), // today, retrying
      task("2026-10-27"),
      task("2026-10-28"),
      task("2026-10-29"),
    ];
  };

  it("only touches editable future days — never today or the past (4)", () => {
    const tasks = range();
    const plan = planScheduleEdit({ kind: "range", tasks }, { dates: ["2026-10-27", "2026-10-29", "2026-10-30"], minute: 11 * 60 }, NOW, isValidTimeZone);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const touched = [...plan.update.map((u) => u.taskId), ...plan.cancel];
    expect(touched).not.toContain(tasks[0].id); // past
    expect(touched).not.toContain(tasks[1].id); // today
    expect(plan.update.map((u) => u.date)).toEqual(["2026-10-27", "2026-10-29"]);
    expect(plan.cancel).toEqual([tasks[3].id]); // 28th removed → cancelled, not deleted
    expect(plan.create).toEqual(["2026-10-30"]);
  });

  it("rejects today's date (4)", () => {
    const plan = planScheduleEdit({ kind: "range", tasks: range() }, { dates: ["2026-10-26", "2026-10-27"] }, NOW, isValidTimeZone);
    expect(plan).toMatchObject({ ok: false, status: 409, lockedDates: ["2026-10-26"] });
  });

  it("rejects the edit when a date became locked while the form was open (5)", () => {
    // Form opened on the 26th; submitted at 00:00:30 on the 27th in Kolkata.
    const submittedAt = ist("2026-10-27", 0, 0) + 30_000;
    const plan = planScheduleEdit({ kind: "range", tasks: range() }, { dates: ["2026-10-27", "2026-10-28"], minute: 660 }, submittedAt, isValidTimeZone);
    expect(plan).toMatchObject({ ok: false, status: 409, lockedDates: ["2026-10-27"] });
  });

  it("rejects a timezone change that would make a date today in the new timezone (5)", () => {
    // At 23:00 on the 26th in Los Angeles it's already the 27th in Kolkata.
    const tasks = [task("2026-10-27", { timezone: "America/Los_Angeles", scheduledDate: "2026-10-27" })];
    const now = zonedDateTimeToMs("2026-10-26", 23 * 60, "America/Los_Angeles");
    const plan = planScheduleEdit({ kind: "range", tasks }, { dates: ["2026-10-27"], timezone: "Asia/Kolkata" }, now, isValidTimeZone);
    expect(plan).toMatchObject({ ok: false, status: 409 });
  });

  it("keeps retry settings and agent unless changed (6)", () => {
    const tasks = range().map((t) => ({ ...t, maxAttempts: 4, retryDelayMinutes: 45, agentId: "agent-b" }));
    const plan = planScheduleEdit({ kind: "range", tasks }, { minute: 9 * 60 }, NOW, isValidTimeZone);
    expect(plan).toMatchObject({ ok: true, settings: { maxAttempts: 4, retryDelayMinutes: 45, agentId: "agent-b", minute: 540, timezone: TZ } });
  });

  it("applies new retry settings and agent when they are changed (6)", () => {
    const plan = planScheduleEdit({ kind: "range", tasks: range() }, { maxAttempts: 5, retryDelayMinutes: 20, agentId: "agent-c" }, NOW, isValidTimeZone);
    expect(plan).toMatchObject({ ok: true, settings: { maxAttempts: 5, retryDelayMinutes: 20, agentId: "agent-c" } });
  });

  it("never touches a future day that is already calling or retrying, and won't double-book its date (7)", () => {
    seq = 200;
    const tasks = [task("2026-10-27", { status: "calling" }), task("2026-10-28", { attemptCount: 1 }), task("2026-10-29")];
    const ok = planScheduleEdit({ kind: "range", tasks }, { dates: ["2026-10-29"], minute: 700 }, NOW, isValidTimeZone);
    expect(ok).toMatchObject({ ok: true, update: [{ taskId: tasks[2].id }], cancel: [], create: [] });

    const clash = planScheduleEdit({ kind: "range", tasks }, { dates: ["2026-10-27", "2026-10-29"] }, NOW, isValidTimeZone);
    expect(clash).toMatchObject({ ok: false, status: 409, lockedDates: ["2026-10-27"] });
  });

  it("only lets date-range schedules add or remove days", () => {
    const plan = planScheduleEdit(
      { kind: "single", tasks: [task("2026-10-28", { rangeGroupId: null })] },
      { dates: ["2026-10-29"] },
      NOW,
      isValidTimeZone,
    );
    expect(plan).toMatchObject({ ok: false, status: 400 });
  });

  it("validates input", () => {
    const t = range();
    expect(planScheduleEdit({ kind: "range", tasks: t }, { timezone: "Mars/Olympus" }, NOW, isValidTimeZone)).toMatchObject({ ok: false });
    expect(planScheduleEdit({ kind: "range", tasks: t }, { minute: 1440 }, NOW, isValidTimeZone)).toMatchObject({ ok: false });
    expect(planScheduleEdit({ kind: "range", tasks: t }, { maxAttempts: 0 }, NOW, isValidTimeZone)).toMatchObject({ ok: false });
    expect(planScheduleEdit({ kind: "range", tasks: t }, { dates: ["2026-02-30"] }, NOW, isValidTimeZone)).toMatchObject({ ok: false });
  });
});

describe("8. which schedules may be cleared", () => {
  it("clears a schedule whose days are all finished and in the past", () => {
    expect(isClearable([task("2026-10-20", { status: "completed" }), task("2026-10-21", { status: "exhausted" })], NOW)).toBe(true);
  });

  it("never clears a schedule with a pending, retrying, paused or active day", () => {
    for (const status of ["scheduled", "paused", "dispatching", "calling"] as const) {
      expect(isClearable([task("2026-10-20", { status: "completed" }), task("2026-10-30", { status })], NOW)).toBe(false);
    }
  });

  it("never clears an old day that is still paused, pending or stuck calling", () => {
    for (const status of ["scheduled", "paused", "dispatching", "calling"] as const) {
      expect(isClearable([task("2026-10-15", { status: "completed" }), task("2026-10-16", { status })], NOW)).toBe(false);
    }
  });

  it("keeps a schedule that finished today until tomorrow", () => {
    expect(isClearable([task("2026-10-26", { status: "completed" })], NOW)).toBe(false);
  });

  it("allows clearing a cancelled schedule even if its cancelled days were in the future", () => {
    expect(isClearable([task("2026-10-20", { status: "completed" }), task("2026-11-05", { status: "cancelled" })], NOW)).toBe(true);
  });

  it("marks only past schedules as clearable", () => {
    const schedules = groupSchedules([task("2026-10-20", { rangeGroupId: "a", status: "completed" }), task("2026-10-30", { rangeGroupId: "b" })], NOW);
    expect(schedules.find((s) => s.id === "range:a")?.clearable).toBe(true);
    expect(schedules.find((s) => s.id === "range:b")?.clearable).toBe(false);
  });
});

describe("zonedDateTimeToMs", () => {
  it("converts local wall-clock time correctly, including across DST", () => {
    expect(zonedDateTimeToMs("2026-10-27", 600, "Asia/Kolkata")).toBe(Date.UTC(2026, 9, 27, 4, 30));
    // 10:00 in New York is 14:00 UTC in summer, 15:00 UTC in winter.
    expect(zonedDateTimeToMs("2026-07-01", 600, "America/New_York")).toBe(Date.UTC(2026, 6, 1, 14, 0));
    expect(zonedDateTimeToMs("2026-12-01", 600, "America/New_York")).toBe(Date.UTC(2026, 11, 1, 15, 0));
  });
});

describe("scheduleIdOf", () => {
  it("is stable per grouping", () => {
    expect(scheduleIdOf({ id: "x", rangeGroupId: "range_9", programmeId: null })).toBe("range:range_9");
    expect(scheduleIdOf({ id: "x", rangeGroupId: null, programmeId: "p" })).toBe("programme:p");
    expect(scheduleIdOf({ id: "x", rangeGroupId: null, programmeId: null })).toBe("task:x");
  });
});
