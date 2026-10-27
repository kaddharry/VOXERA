import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db/supabase", () => ({ supabase: {} }));

import { buildReport, groupTurns, type Row } from "../../scripts/emotion-report";

const ev = (ts: number, type: string, payload: Record<string, unknown>): Row => ({ ts, type, payload });

const rows: Row[] = [
  ev(1, "utterance", { role: "user", text: "I'm in a lot of pain" }),
  ev(2, "emotion", {
    label: "distress", intensity: 0.8, confidence: 0.7,
    textSignal: { label: "distress", confidence: 0.8, engine: "lexicon" },
    audioSignal: { label: "sadness", confidence: 0.5 },
    latencyMs: { text: 120, audioAndFusion: 2, total: 122 },
  }),
  ev(3, "acoustic", { pitchHz: 180, pitchVariation: 0.3, rmsEnergy: 900, speakingRateWPM: 120, pauseCount: 2, pauseDurationMs: 400 }),
  ev(4, "policy", { acknowledgeFirst: true, pace: "slow", escalate: "tier2" }),
  ev(5, "utterance", { role: "agent", text: "I'm sorry to hear that." }),
  ev(6, "utterance", { role: "user", text: "Thank you so much" }),
  ev(7, "emotion", {
    label: "gratitude", intensity: 0.5, confidence: 0.9,
    textSignal: { label: "gratitude", confidence: 0.9, engine: "lexicon" },
    audioSignal: { label: "gratitude", confidence: 0.6 },
    latencyMs: { text: 400, audioAndFusion: 1, total: 401 },
  }),
  // A diagnostic for turn 1 that was logged late, after turn 2 started.
  ev(8, "emotion_diagnostic", { text: "I'm in a lot of pain", lexicon: { available: true, label: "distress", confidence: 0.8, latencyMs: 0, matchedKeywords: ["pain"] } }),
];

describe("emotion report", () => {
  it("groups each patient turn with its own events, matching late diagnostics by text", () => {
    const turns = groupTurns(rows);
    expect(turns).toHaveLength(2);
    expect(turns[0].agent).toBe("I'm sorry to hear that.");
    expect(turns[0].policy?.escalate).toBe("tier2");
    expect(turns[0].diagnostic?.lexicon.matchedKeywords).toEqual(["pain"]);
    expect(turns[1].emotion?.label).toBe("gratitude");
    expect(turns[1].diagnostic).toBeUndefined();
  });

  it("summarises agreement, timing against 300ms, and which side the final label followed", () => {
    const md = buildReport("tel-x", { id: "CA1", startedAt: 0, durationMs: 42000, status: "completed" }, groupTurns(rows));
    expect(md).toContain("Words vs voice agreed on 1 of 2 turns");
    expect(md).toContain("average 262ms, slowest 401ms, 1 of 2 under 300ms");
    expect(md).toContain("| words |");
    expect(md).toContain("| both agree |");
    expect(md).toContain("Turns that escalated: 1");
    expect(md).toContain("## Every engine's verdict");
    expect(md).toContain("- Whole call: Mostly distress · 1 of 2 turns negative");
  });

  it("pairs events with their sentence by utterance id when turns overlap", () => {
    const turns = groupTurns([
      ev(1, "utterance", { role: "user", utteranceId: "u1", text: "Honestly," }),
      ev(2, "utterance", { role: "user", utteranceId: "u2", text: "Honestly, I'm in a lot of pain" }),
      ev(3, "emotion", { utteranceId: "u1", label: "neutral", intensity: 0 }),
      ev(4, "emotion", { utteranceId: "u2", label: "distress", intensity: 0.7 }),
      ev(5, "policy", { utteranceId: "u2", pace: "slow", escalate: "tier2" }),
    ]);
    expect(turns.map((t) => t.emotion?.label)).toEqual(["neutral", "distress"]);
    expect(turns[0].policy).toBeUndefined();
    expect(turns[1].policy?.escalate).toBe("tier2");
  });
});
