import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { isValidTimeZone, validateCallingWindow } from "../../lib/scheduler/validation";

let patient: any;
vi.mock("../../lib/db/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "c1" } } }) } }),
}));
vi.mock("../../lib/db/patients", () => ({ getPatient: vi.fn(async () => patient) }));
vi.mock("../../lib/db/follow-up-tasks", () => ({
  createFollowUpTask: vi.fn(async () => ({ id: "task1" })),
  createFollowUpRange: vi.fn(async (_db: any, _c: string, f: any) => f.dailyAttemptTimes.map((_: number, i: number) => ({ id: `t${i}` }))),
  listFollowUpTasksForPatient: vi.fn(async () => []),
}));

const { createFollowUpTask, createFollowUpRange } = await import("../../lib/db/follow-up-tasks");
const singleRoute = await import("../../app/api/admin/patients/[id]/follow-ups/route");
const rangeRoute = await import("../../app/api/admin/patients/[id]/schedule-range/route");

const post = (body: unknown) =>
  new NextRequest("https://example.test/x", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const params = { params: Promise.resolve({ id: "p1" }) };
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  patient = { id: "p1", doNotContact: false, assignedAgentId: "a1" };
  vi.clearAllMocks();
});

describe("single follow-up", () => {
  it("refuses a Do Not Contact patient", async () => {
    patient.doNotContact = true;
    const res = await singleRoute.POST(post({ scheduledAt: Date.now() + HOUR }), params);
    expect(res.status).toBe(400);
    expect(createFollowUpTask).not.toHaveBeenCalled();
  });

  it("refuses a patient with no agent instead of silently creating a review alert later", async () => {
    patient.assignedAgentId = null;
    const res = await singleRoute.POST(post({ scheduledAt: Date.now() + HOUR }), params);
    expect(res.status).toBe(400);
    expect(createFollowUpTask).not.toHaveBeenCalled();
  });

  it("refuses an unknown timezone and a half-set window", async () => {
    expect((await singleRoute.POST(post({ scheduledAt: Date.now() + HOUR, timezone: "Mars/Olympus" }), params)).status).toBe(400);
    expect((await singleRoute.POST(post({ scheduledAt: Date.now() + HOUR, windowStartMinute: 600 }), params)).status).toBe(400);
    expect(createFollowUpTask).not.toHaveBeenCalled();
  });

  it("schedules a valid request", async () => {
    const res = await singleRoute.POST(post({ scheduledAt: Date.now() + HOUR, timezone: "Asia/Kolkata" }), params);
    expect(res.status).toBe(201);
  });
});

describe("date range", () => {
  it("skips today when today's time has already passed, instead of rejecting the whole range", async () => {
    const past = Date.now() - 3 * HOUR;
    const future = [Date.now() + 21 * HOUR, Date.now() + 45 * HOUR];
    const res = await rangeRoute.POST(post({ dailyAttemptTimes: [past, ...future], timezone: "UTC" }), params);
    expect(res.status).toBe(201);
    expect((await res.json()).skippedPastDays).toBe(1);
    expect(vi.mocked(createFollowUpRange).mock.calls[0][2].dailyAttemptTimes).toEqual(future);
  });

  it("explains clearly when every selected day is already past", async () => {
    const res = await rangeRoute.POST(post({ dailyAttemptTimes: [Date.now() - HOUR], timezone: "UTC" }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already passed/);
  });

  it("refuses a daily time after the calling window closes (it would land on the next day's slot)", async () => {
    // 20:00 UTC tomorrow, window 09:00–17:00 UTC
    const d = new Date(Date.now() + 24 * HOUR);
    const eightPm = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 20, 0);
    const res = await rangeRoute.POST(
      post({ dailyAttemptTimes: [eightPm], timezone: "UTC", windowStartMinute: 540, windowEndMinute: 1020 }),
      params,
    );
    expect(res.status).toBe(400);
    expect(createFollowUpRange).not.toHaveBeenCalled();
  });
});

describe("validateCallingWindow / isValidTimeZone", () => {
  it("accepts no window, a day window and an overnight window", () => {
    expect(validateCallingWindow(null, null)).toBeNull();
    expect(validateCallingWindow(undefined, undefined)).toBeNull();
    expect(validateCallingWindow(600, 1080)).toBeNull();
    expect(validateCallingWindow(1200, 120)).toBeNull();
  });

  it("rejects half-set, out-of-range, non-integer and zero-length windows", () => {
    expect(validateCallingWindow(600, null)).not.toBeNull();
    expect(validateCallingWindow(-1, 600)).not.toBeNull();
    expect(validateCallingWindow(600, 1440)).not.toBeNull();
    expect(validateCallingWindow(600.5, 900)).not.toBeNull();
    expect(validateCallingWindow("600", 900)).not.toBeNull();
    expect(validateCallingWindow(600, 600)).not.toBeNull();
  });

  it("recognises real IANA timezones only", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});
