import { describe, it, expect, vi } from "vitest";
import { runBackgroundAction, pendingAnnouncements, markAnnounced, unannounceSince, actionsContext, onActionSettled, confirmationLine, clearActions } from "../../lib/agent/background-actions";

const OK = JSON.stringify({ success: true, provider: "Dr. Priya", when: "Thursday 26 November at 11:30 am" });

describe("background action worker", () => {
  it("finishes the job even when nobody waits for it, and queues the confirmation", async () => {
    const s = "t1";
    const rec = runBackgroundAction(s, "book_appointment", { startsAt: "a" }, async () => OK);
    expect(actionsContext(s)).toMatch(/IN PROGRESS/);
    await rec.promise;
    expect(rec.success).toBe(true);
    expect(pendingAnnouncements(s)).toHaveLength(1);
    expect(actionsContext(s)).toMatch(/DONE.*NOT been told/);
    markAnnounced(rec);
    expect(pendingAnnouncements(s)).toHaveLength(0);
    unannounceSince(s, 0);
    expect(pendingAnnouncements(s)).toHaveLength(1);
    clearActions(s);
  });

  it("an identical repeat request joins the same job: one booking, not three", async () => {
    const s = "t2";
    const exec = vi.fn(async () => OK);
    const a = runBackgroundAction(s, "book_appointment", { b: 2, a: 1 }, exec);
    const b = runBackgroundAction(s, "book_appointment", { a: 1, b: 2 }, exec);
    await Promise.all([a.promise, b.promise]);
    expect(a).toBe(b);
    expect(exec).toHaveBeenCalledTimes(1);
    clearActions(s);
  });

  it("notifies listeners when a job settles, and a thrown job becomes a failure, not a crash", async () => {
    const s = "t3";
    const seen: boolean[] = [];
    onActionSettled(s, (r) => seen.push(r.success));
    const rec = runBackgroundAction(s, "book_appointment", { x: 1 }, async () => { throw new Error("db down"); });
    await rec.promise;
    expect(seen).toEqual([false]);
    expect(rec.resultStr).toMatch(/error/);
    expect(pendingAnnouncements(s)).toHaveLength(0);
    clearActions(s);
  });

  it("confirmation is spoken in the caller's script and only for a verified booking", () => {
    expect(confirmationLine("book_appointment", OK, "yes book it")).toMatch(/booked with Dr\. Priya on Thursday/);
    expect(confirmationLine("book_appointment", OK, "हाँ बुक कर दो")).toMatch(/[ऀ-ॿ]/);
    expect(confirmationLine("book_appointment", JSON.stringify({ error: "taken" }), "x")).toBeUndefined();
    expect(confirmationLine("cancel_appointment", OK, "x")).toBeUndefined();
  });
});
