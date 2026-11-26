import { describe, expect, it } from "vitest";
import { NO_PAIN, parseSummary } from "../../lib/agent/call-summary";

const base = { sentimentTrajectory: "flat", flaggedConcerns: [], recommendedAction: "routine", followUpOutcome: "resolved" };

describe("post-call summary: pain and medicines", () => {
  it("reads the pain the patient reported", () => {
    const s = parseSummary(JSON.stringify({ ...base, painReported: { present: true, location: "lower back", score: 6, description: "worse at night" } }));
    expect(s?.painReported).toEqual({ present: true, location: "lower back", score: 6, description: "worse at night" });
  });

  it("never keeps a guessed or impossible pain score", () => {
    expect(parseSummary(JSON.stringify({ ...base, painReported: { present: true, location: "knee", score: 14 } }))?.painReported.score).toBeNull();
    expect(parseSummary(JSON.stringify({ ...base, painReported: { present: true, location: "knee", score: "bad" } }))?.painReported.score).toBeNull();
    expect(parseSummary(JSON.stringify({ ...base, painReported: { present: true, score: 7.6 } }))?.painReported.score).toBe(8);
  });

  it("treats 'no pain', a missing field, or junk as no pain", () => {
    expect(parseSummary(JSON.stringify({ ...base, painReported: { present: false, location: "x", score: 9 } }))?.painReported).toEqual(NO_PAIN);
    expect(parseSummary(JSON.stringify(base))?.painReported).toEqual(NO_PAIN);
    expect(parseSummary(JSON.stringify({ ...base, painReported: "lots" }))?.painReported).toEqual(NO_PAIN);
  });

  it("keeps only medicine ids it was given, once each, so the model can't invent a prescription", () => {
    const s = parseSummary(
      JSON.stringify({ ...base, medicationReports: [{ medicationId: "med1", status: "missed", note: "felt sick" }, { medicationId: "med1", status: "taken" }, { medicationId: "invented", status: "taken" }, { medicationId: "med2", status: "weird" }, "junk"] }),
      new Set(["med1", "med2"]),
    );
    expect(s?.medicationReports).toEqual([{ medicationId: "med1", status: "missed", note: "felt sick" }, { medicationId: "med2", status: "unknown", note: null }]);
  });

  it("returns no medicine reports when none were listed", () => {
    expect(parseSummary(JSON.stringify({ ...base, medicationReports: [{ medicationId: "med1", status: "taken" }] }))?.medicationReports).toEqual([]);
  });

  it("copes with a code fence around the JSON, as before", () => {
    expect(parseSummary("```json\n" + JSON.stringify({ ...base, painReported: { present: true, location: "head" } }) + "\n```")?.painReported.present).toBe(true);
  });
});
