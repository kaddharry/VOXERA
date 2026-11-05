import { describe, it, expect } from "vitest";
import { matchUtteranceForEvent } from "../../lib/insights/timeline-match";

describe("BUG-E12 — emotion timeline quote/label attribution", () => {
  it("picks the utterance with the matching utteranceId, even when a different turn is closer in time", () => {
    const emotionEvent = { ts: 1000, payload: { utteranceId: "u-sad", label: "sadness" } };
    const utteranceEvents = [
      // Closer in time, but a DIFFERENT turn — this is the exact failure
      // mode from the live screenshot: a neutral-labeled point quoting
      // "I feel very low" from a nearby but different turn.
      { ts: 1010, payload: { utteranceId: "u-neutral", role: "user", text: "Okay." } },
      { ts: 5000, payload: { utteranceId: "u-sad", role: "user", text: "I feel very low." } },
    ];
    const match = matchUtteranceForEvent(emotionEvent, utteranceEvents);
    expect(match?.payload.text).toBe("I feel very low.");
  });

  it("falls back to nearest-in-time when utteranceId is missing (older rows)", () => {
    const emotionEvent = { ts: 1000, payload: { label: "sadness" } };
    const utteranceEvents = [
      { ts: 980, payload: { role: "user", text: "closer" } },
      { ts: 3000, payload: { role: "user", text: "farther" } },
    ];
    expect(matchUtteranceForEvent(emotionEvent, utteranceEvents)?.payload.text).toBe("closer");
  });

  it("falls back to nearest-in-time when the utteranceId doesn't resolve to any known utterance", () => {
    const emotionEvent = { ts: 1000, payload: { utteranceId: "missing", label: "sadness" } };
    const utteranceEvents = [{ ts: 1050, payload: { utteranceId: "other", text: "closest available" } }];
    expect(matchUtteranceForEvent(emotionEvent, utteranceEvents)?.payload.text).toBe("closest available");
  });

  it("returns null rather than a misleadingly-attributed quote past the drift window", () => {
    const emotionEvent = { ts: 1000, payload: {} };
    const utteranceEvents = [{ ts: 10000, payload: { text: "too far away" } }];
    expect(matchUtteranceForEvent(emotionEvent, utteranceEvents)).toBeNull();
  });

  it("returns null when there are no utterances at all", () => {
    expect(matchUtteranceForEvent({ ts: 1000, payload: {} }, [])).toBeNull();
  });
});
