import { describe, it, expect } from "vitest";
import { createFollowUpTask, createFollowUpRange } from "../../lib/db/follow-up-tasks";

/** Fake Supabase client that records what gets inserted. */
function recordingDb() {
  const inserted: any[] = [];
  const db: any = {
    from: () => ({
      insert: (rows: any) => {
        inserted.push(...(Array.isArray(rows) ? rows : [rows]));
        const result = { data: rows, error: null };
        return { select: () => ({ single: async () => result, then: (r: any) => Promise.resolve(result).then(r) }) };
      },
    }),
  };
  return { db, inserted };
}

// 10:00–18:00 IST
const window = { timezone: "Asia/Kolkata", windowStartMinute: 600, windowEndMinute: 1080 };

describe("first attempt obeys the calling window", () => {
  it("moves a single follow-up booked for 11pm to 10am the next morning", async () => {
    const { db, inserted } = recordingDb();
    // 2026-10-26 23:00 IST
    await createFollowUpTask(db, "c1", { patientId: "p1", scheduledAt: Date.UTC(2026, 9, 26, 17, 30), ...window });
    // 2026-10-27 10:00 IST == 04:30 UTC
    expect(inserted[0].nextAttemptAt).toBe(Date.UTC(2026, 9, 27, 4, 30));
  });

  it("moves each day of a range booked for 8am to that day's 10am opening", async () => {
    const { db, inserted } = recordingDb();
    // 2026-10-27 and 2026-10-28, 08:00 IST (02:30 UTC)
    await createFollowUpRange(db, "c1", {
      patientId: "p1",
      dailyAttemptTimes: [Date.UTC(2026, 9, 27, 2, 30), Date.UTC(2026, 9, 28, 2, 30)],
      ...window,
    });
    expect(inserted.map((r) => r.nextAttemptAt)).toEqual([Date.UTC(2026, 9, 27, 4, 30), Date.UTC(2026, 9, 28, 4, 30)]);
  });

  it("leaves a time that's already inside the window alone", async () => {
    const { db, inserted } = recordingDb();
    const noon = Date.UTC(2026, 9, 27, 6, 30); // 12:00 IST
    await createFollowUpTask(db, "c1", { patientId: "p1", scheduledAt: noon, ...window });
    expect(inserted[0].nextAttemptAt).toBe(noon);
  });
});
