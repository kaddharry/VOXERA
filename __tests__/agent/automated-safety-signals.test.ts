import { describe, it, expect } from "vitest";
import { buildAutomatedSafetySignals } from "../../lib/agent/call-summary";

/**
 * BUG-E17: generateCallSummary() only ever sent the raw transcript to the
 * LLM — it never saw the emotion engine's own escalation events or
 * distress flags, so the clinician-facing "Flagged Concerns" list depended
 * entirely on the LLM re-reading the transcript correctly, with no
 * cross-check against the (now far more reliable, post-audit) deterministic
 * signal. A doctor reading the summary had no way to tell "the LLM didn't
 * mention X" from "the system never detected X". buildAutomatedSafetySignals
 * is a pure, deterministic function — independent of the LLM — that the
 * caller merges into the final summary unconditionally, so an escalation or
 * sustained-distress signal can never be silently dropped by an imperfect
 * LLM read.
 */
describe("buildAutomatedSafetySignals", () => {
  it("surfaces a policy escalation event with its reason", () => {
    const signals = buildAutomatedSafetySignals(
      [{ payload: { type: "human", reason: "SUSTAINED NEGATIVITY: repeated frustration + increasing distress" } }],
      []
    );
    expect(signals.some((s) => s.includes("SUSTAINED NEGATIVITY"))).toBe(true);
  });

  it("surfaces sustained/increasing distress even with no explicit escalation event", () => {
    const signals = buildAutomatedSafetySignals(
      [],
      [
        { payload: { label: "joy", flags: { increasing_distress: false } } },
        { payload: { label: "distress", flags: { increasing_distress: true } } },
      ]
    );
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.some((s) => /distress/i.test(s))).toBe(true);
  });

  it("returns an empty array for a call with no safety-relevant signal at all", () => {
    const signals = buildAutomatedSafetySignals(
      [],
      [
        { payload: { label: "joy", flags: { increasing_distress: false } } },
        { payload: { label: "neutral", flags: { increasing_distress: false } } },
      ]
    );
    expect(signals).toEqual([]);
  });

  it("deduplicates identical escalation reasons instead of repeating them", () => {
    const signals = buildAutomatedSafetySignals(
      [
        { payload: { type: "human", reason: "same reason" } },
        { payload: { type: "human", reason: "same reason" } },
      ],
      []
    );
    expect(signals.filter((s) => s.includes("same reason")).length).toBe(1);
  });
});
