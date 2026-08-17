/**
 * Tests: Persona hysteresis (lib/emotion/persona-lock.ts)
 *
 * Verifies the state machine directly: initial lock, streak building on a
 * sustained opposite-direction shift, streak reset on reinforcement, commit
 * once the configured threshold is reached, and that genuine distress
 * always overrides immediately regardless of streak state.
 */
import { describe, it, expect } from "vitest";
import { resolvePersonaLock } from "../../lib/emotion/persona-lock";
import { CONFIG } from "../../lib/config";
import type { EmotionContext, EmotionLabel } from "../../lib/types";

function makeContext(
  label: EmotionLabel,
  v: number,
  flags: Partial<EmotionContext["flags"]> = {}
): EmotionContext {
  return {
    current: {
      label,
      intensity: 0.6,
      confidence: 0.8,
      vad: { v, a: 0, d: 0 },
      source: "text",
      at: Date.now(),
    },
    trajectory: { slope_v: 0, slope_a: 0, window: 6 },
    zDeviation: 0,
    flags: {
      repeated_frustration: false,
      increasing_distress: false,
      affect_oscillation: false,
      chronic_negativity: false,
      ...flags,
    },
    baseline: { v: 0, a: 0, d: 0, sigma_v: 0.3, sigma_a: 0.3, sigma_d: 0.3 },
  };
}

const threshold = CONFIG.emotion.personaLockStreakThreshold;

describe("resolvePersonaLock — hysteresis state machine", () => {
  it("adopts the first turn's label as the initial lock", async () => {
    const sessionId = `test-lock-${Math.random()}`;
    const result = await resolvePersonaLock(sessionId, makeContext("anger", -0.8));
    expect(result.label).toBe("anger");
    expect(result.justShifted).toBe(true);
  });

  it("holds the locked persona steady across turns that stay the same direction", async () => {
    const sessionId = `test-lock-${Math.random()}`;
    await resolvePersonaLock(sessionId, makeContext("anger", -0.8));
    // Different specific negative label, same direction — should NOT shift.
    const r2 = await resolvePersonaLock(sessionId, makeContext("frustration", -0.5));
    const r3 = await resolvePersonaLock(sessionId, makeContext("sadness", -0.3));
    expect(r2.label).toBe("anger");
    expect(r2.justShifted).toBe(false);
    expect(r3.label).toBe("anger");
    expect(r3.justShifted).toBe(false);
  });

  it("does not shift on a single opposite-direction turn — builds a pending streak instead", async () => {
    const sessionId = `test-lock-${Math.random()}`;
    await resolvePersonaLock(sessionId, makeContext("anger", -0.8));
    const r2 = await resolvePersonaLock(sessionId, makeContext("joy", 0.6));
    expect(r2.label).toBe("anger"); // still locked
    expect(r2.justShifted).toBe(false);
    expect(r2.pendingStreak).toBe(1);
  });

  it("resets the pending streak if the caller reverts back toward the locked direction", async () => {
    const sessionId = `test-lock-${Math.random()}`;
    await resolvePersonaLock(sessionId, makeContext("anger", -0.8));
    await resolvePersonaLock(sessionId, makeContext("joy", 0.6)); // streak=1
    await resolvePersonaLock(sessionId, makeContext("joy", 0.6)); // streak=2
    const reverted = await resolvePersonaLock(sessionId, makeContext("frustration", -0.5)); // back to negative
    expect(reverted.label).toBe("anger");
    expect(reverted.pendingStreak).toBe(0);

    // Streak must start over from 1, not resume from where it left off.
    const afterRevert = await resolvePersonaLock(sessionId, makeContext("joy", 0.6));
    expect(afterRevert.pendingStreak).toBe(1);
  });

  it(`commits the shift once ${threshold} consecutive turns show the opposite direction`, async () => {
    const sessionId = `test-lock-${Math.random()}`;
    await resolvePersonaLock(sessionId, makeContext("anger", -0.8));

    let last;
    for (let i = 0; i < threshold - 1; i++) {
      last = await resolvePersonaLock(sessionId, makeContext("joy", 0.6));
      expect(last.label).toBe("anger"); // not yet
    }
    const committed = await resolvePersonaLock(sessionId, makeContext("joy", 0.6));
    expect(committed.label).toBe("joy");
    expect(committed.justShifted).toBe(true);
  });

  it("treats near-zero valence (within the deadband) as ambiguous, not a directional signal", async () => {
    const sessionId = `test-lock-${Math.random()}`;
    await resolvePersonaLock(sessionId, makeContext("anger", -0.8));
    const neutral = await resolvePersonaLock(sessionId, makeContext("neutral", 0.05));
    expect(neutral.label).toBe("anger");
    expect(neutral.pendingStreak).toBe(0);
  });

  it("distress overrides the lock immediately, regardless of pending streak state", async () => {
    const sessionId = `test-lock-${Math.random()}`;
    await resolvePersonaLock(sessionId, makeContext("joy", 0.7));
    // Building toward nothing in particular — then genuine distress hits.
    const distressed = await resolvePersonaLock(sessionId, makeContext("distress", -0.9, { increasing_distress: true }));
    expect(distressed.label).toBe("distress");
    expect(distressed.justShifted).toBe(true);
  });

  it("distress overrides even mid-way through an unrelated pending streak", async () => {
    const sessionId = `test-lock-${Math.random()}`;
    await resolvePersonaLock(sessionId, makeContext("neutral", 0.0));
    await resolvePersonaLock(sessionId, makeContext("joy", 0.6)); // pending streak building
    const distressed = await resolvePersonaLock(sessionId, makeContext("distress", -0.9, { increasing_distress: true }));
    expect(distressed.label).toBe("distress");

    // After distress passes, the lock should now be distress, not silently
    // still counting the old pending streak.
    const after = await resolvePersonaLock(sessionId, makeContext("neutral", 0.0));
    expect(after.label).toBe("distress");
    expect(after.pendingStreak).toBe(0);
  });

  it("independent sessions never share lock state", async () => {
    const sessionA = `test-lock-a-${Math.random()}`;
    const sessionB = `test-lock-b-${Math.random()}`;
    const a = await resolvePersonaLock(sessionA, makeContext("anger", -0.8));
    const b = await resolvePersonaLock(sessionB, makeContext("joy", 0.8));
    expect(a.label).toBe("anger");
    expect(b.label).toBe("joy");
  });
});
