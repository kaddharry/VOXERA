import { describe, it, expect } from "vitest";
import { detectTextEmotionLexicon, fuseEmotion } from "../../lib/emotion/detect";
import { extractAcousticFeatures, isolateLastUtterance } from "../../lib/audio/acoustic";
import { buildEmotionContext } from "../../lib/emotion/context";
import { resolvePersonaLock } from "../../lib/emotion/persona-lock";
import type { EmotionSignal, Utterance } from "../../lib/types";

/**
 * Regression tests for the 2026-11-05 emotion-engine audit. Each block names
 * the concrete, user-visible symptom it reproduces before the fix landed.
 */

describe("BUG-E5 — contraction negation never fires", () => {
  // NEGATION_RE's "n't" alternative required a \b immediately before "n",
  // but in every real contraction ("don't", "isn't", "can't"...) the
  // character before "n" is a letter, not a word boundary — so \bn't can
  // never match inside a contraction. Only the spelled-out "not"/"never"/
  // "no" worked; the single most common way people negate a feeling in
  // speech ("I don't feel good") was silently ignored.
  it.each([
    ["I don't feel good", "sadness"],
    ["I don't feel good about this", "sadness"],
    ["honestly I don't feel happy", "sadness"],
    ["I wasn't happy with that", "sadness"],
    ["I can't say I'm pleased", "sadness"],
  ])("flips positive→negative for %j", (text, expectedLabel) => {
    const sig = detectTextEmotionLexicon(text);
    expect(sig.label).toBe(expectedLabel);
    expect(sig.vad.v).toBeLessThan(0);
  });

  it("still handles the spelled-out form it always worked for", () => {
    expect(detectTextEmotionLexicon("I am not feeling good").label).toBe("sadness");
  });

  it("does not over-match real words ending in -nt as if they were a contraction", () => {
    // "patient", "recent", "moment", "important" all end in "nt" — a naive
    // \w*n't fix would turn every one of these into a false negation trigger.
    const sig = detectTextEmotionLexicon("the patient is feeling good about the recent, important moment");
    expect(sig.label).toBe("joy");
    expect(sig.vad.v).toBeGreaterThan(0);
  });
});

describe("BUG-E6 — 'sick' collides with excitement in a clinical app", () => {
  // The excitement pattern's bare \bsick\b fires on a patient literally
  // reporting nausea/illness post-surgery, scoring it as positive (v≈+0.9).
  // It also out-competes the dedicated "sick of" frustration phrase, since
  // both patterns match the same text and excitement's weight (1.0) beats
  // frustration's (0.9) — this is the collision the existing
  // lexicon-frustration.test.ts `it.todo` already flagged as blocked.
  it("does not read a reported symptom as excitement", () => {
    const sig = detectTextEmotionLexicon("I've been feeling really sick since the surgery");
    expect(sig.label).not.toBe("excitement");
    expect(sig.vad.v).toBeLessThanOrEqual(0);
  });

  it("'sick of' reads as frustration, not excitement", () => {
    const sig = detectTextEmotionLexicon("I'm sick of waiting for this pain to go away");
    expect(sig.label).toBe("frustration");
  });

  it("genuine excitement slang ('that's sick!') is not required to carry the clinical risk", () => {
    // Documents the tradeoff: removing "sick" from excitement is a one-sided
    // but deliberate choice given the domain — a false negative on slang
    // excitement is far cheaper than a false positive on a reported symptom.
    const sig = detectTextEmotionLexicon("that's sick!!");
    expect(sig.label).not.toBe("distress");
  });
});

describe("BUG-E7 — speaking rate goes unphysical when a turn is merged across a gap", () => {
  const RATE = 8000;
  function tone(ms: number, amplitude = 4000, hz = 180): Buffer {
    const n = Math.round((ms / 1000) * RATE);
    const buf = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / RATE) * amplitude), i * 2);
    return buf;
  }
  const silence = (ms: number) => Buffer.alloc(Math.round((ms / 1000) * RATE) * 2);

  it("isolateLastUtterance drops an earlier fragment across a >1.5s thinking pause, but stream-handler's merge path still counts its words", () => {
    // Mirrors lib/telephony/stream-handler.ts's onTranscript merge branch:
    // "I'm really worried that something" (fragment 1, isFinal) ... 2s while
    // the agent is still composing a reply ... "went wrong in the surgery"
    // (fragment 2, isFinal) — the two get concatenated into one `text` for
    // the turn, but the accumulated PCM only yields the last speech span
    // once isolateLastUtterance runs, because the gap exceeds
    // UTTERANCE_GAP_MS. wordCount is computed from the FULL merged text.
    const fragment1 = "I'm really worried that something";
    const fragment2 = "went wrong in the surgery";
    const merged = `${fragment1} ${fragment2}`;
    const wordCount = merged.split(/\s+/).filter(Boolean).length; // 11 words

    const turnPcm = Buffer.concat([tone(1800), silence(2000), tone(1300)]);
    const isolated = isolateLastUtterance(turnPcm);
    const features = extractAcousticFeatures(isolated, wordCount);

    // Human speech tops out well under 400 wpm even for fast talkers; the
    // mismatch here would otherwise produce a physically impossible rate
    // (uncapped, this scenario computes ~429 wpm) — extractAcousticFeatures
    // now clamps to a generous ceiling as a safety net (see BUG-E7 comment
    // in lib/audio/acoustic.ts) while the real fix is a telephony-layer one.
    expect(features.speakingRateWPM).toBeLessThanOrEqual(400);
  });
});

describe("BUG-E8 — fuseEmotion rewards disagreement with a flat confidence bonus", () => {
  // The fixed +0.05 is added to the text/audio average regardless of
  // whether the two signals agree, so a call where the words say "joy" and
  // the voice says "anger" reports a HIGHER confidence than either engine
  // reported on its own — the opposite of what a sensor-fusion confidence
  // should do when its inputs disagree.
  it("does not report fused confidence higher than either disagreeing input alone", () => {
    const text = detectTextEmotionLexicon("I'm feeling great today");
    const audio = {
      label: "anger" as const,
      intensity: 0.6,
      confidence: 0.55,
      confidenceCategory: { level: "medium" as const, explanation: "" },
      vad: { v: -0.7, a: 0.8, d: 0.4 },
      source: "audio" as const,
      at: Date.now(),
    };
    const fused = fuseEmotion(text, audio);
    expect(fused.confidence).toBeLessThanOrEqual(Math.max(text.confidence, audio.confidence));
  });
});

describe("BUG-E10 — buildEmotionContext's trend window is silently halved by interleaved agent turns", () => {
  // `recentSignals` used to be `args.stm.slice(-window).map(u => u.emotion).filter(...)`
  // — slicing the raw, role-mixed STM array to `window` entries BEFORE
  // dropping the agent turns (which never carry `.emotion`). Since a real
  // call alternates user/agent turns ~1:1, the last `window` raw entries
  // contain only ~window/2 actual emotion readings — the trend/flag
  // calculations silently ran on half the intended history. This directly
  // feeds flags.increasing_distress, which drives both the persona-lock
  // safety override (persona-lock.ts) and policy escalation
  // (orchestrator.ts's `policy.escalate`), so a genuinely declining patient
  // could go undetected simply because the agent's own replies were sitting
  // in the window budget.
  function sig(v: number, a: number, label: EmotionSignal["label"]): EmotionSignal {
    return {
      label, intensity: 0.7, confidence: 0.7,
      confidenceCategory: { level: "medium", explanation: "" },
      vad: { v, a, d: 0 }, source: "text", at: Date.now(),
    };
  }
  function utt(role: "user" | "agent", emotion?: EmotionSignal): Utterance {
    return { id: Math.random().toString(36), role, text: "x", emotion, ts: Date.now() };
  }

  it("reads the same declining trend whether or not agent turns sit between the user's turns in STM", () => {
    // Six real patient turns: three clearly positive, then three clearly
    // negative with rising arousal — a textbook "mood is declining" shape.
    const userTurns = [
      sig(0.8, 0.1, "joy"), sig(0.8, 0.1, "joy"), sig(0.8, 0.1, "joy"),
      sig(-0.8, 0.6, "sadness"), sig(-0.8, 0.6, "sadness"), sig(-0.8, 0.6, "sadness"),
    ];
    const current = sig(-0.9, 0.7, "sadness");

    const stmClean: Utterance[] = userTurns.map((e) => utt("user", e));
    const stmInterleaved: Utterance[] = userTurns.flatMap((e) => [utt("agent"), utt("user", e)]);

    const clean = buildEmotionContext({ current, stm: stmClean, ltmUser: [] });
    const interleaved = buildEmotionContext({ current, stm: stmInterleaved, ltmUser: [] });

    // Agent turns carry no emotion signal at all — their mere presence in
    // STM must not change the computed trend.
    expect(interleaved.trajectory.slope_v).toBeCloseTo(clean.trajectory.slope_v, 5);
    expect(interleaved.flags.increasing_distress).toBe(clean.flags.increasing_distress);
  });

  it("actually detects the decline once the full 6-turn window is used", () => {
    const userTurns = [
      sig(0.8, 0.1, "joy"), sig(0.8, 0.1, "joy"), sig(0.8, 0.1, "joy"),
      sig(-0.8, 0.6, "sadness"), sig(-0.8, 0.6, "sadness"), sig(-0.8, 0.6, "sadness"),
    ];
    const current = sig(-0.9, 0.7, "sadness");
    const stmInterleaved: Utterance[] = userTurns.flatMap((e) => [utt("agent"), utt("user", e)]);
    const ctx = buildEmotionContext({ current, stm: stmInterleaved, ltmUser: [] });
    expect(ctx.trajectory.slope_v).toBeLessThan(-0.1);
  });
});

describe("BUG-E11 — persona-lock reports justShifted=true every turn while distress continues", () => {
  // The distress safety-override branch always returns justShifted: true,
  // even on the 2nd/3rd/... consecutive distressed turn where the lock was
  // ALREADY "distress" — `justShifted` is documented as "this turn just
  // committed a lock CHANGE", so staying distressed shouldn't keep reporting
  // a fresh shift. Low-severity (logging/debugging signal only, doesn't
  // affect which persona is used), but misleading for anyone reading the
  // trace to understand what happened during a call.
  it("only reports justShifted on the turn that actually enters distress, not every turn after", async () => {
    const sessionId = `test-lock-e11-${Math.random()}`;
    const ctx = (v: number, flags: Partial<import("../../lib/types").EmotionContext["flags"]> = {}) => ({
      current: {
        label: "distress" as const, intensity: 0.8, confidence: 0.8,
        vad: { v, a: 0.5, d: -0.3 }, source: "text" as const, at: Date.now(),
      },
      trajectory: { slope_v: 0, slope_a: 0, window: 6 },
      zDeviation: 0,
      flags: { repeated_frustration: false, increasing_distress: false, affect_oscillation: false, chronic_negativity: false, ...flags },
      baseline: { v: 0, a: 0, d: 0, sigma_v: 0.3, sigma_a: 0.3, sigma_d: 0.3 },
    });

    const first = await resolvePersonaLock(sessionId, ctx(-0.9));
    expect(first.justShifted).toBe(true); // genuinely new

    const second = await resolvePersonaLock(sessionId, ctx(-0.85));
    expect(second.justShifted).toBe(false); // still the same lock — nothing shifted
  });
});
