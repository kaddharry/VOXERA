import { describe, it, expect } from "vitest";
import { endpointHoldMs } from "../../lib/deepgram/live";
import { CONFIG } from "../../lib/config";

describe("endpointHoldMs — how long to wait after the caller pauses", () => {
  it("finished-sounding sentences get the short hold", () => {
    expect(endpointHoldMs("What are your visiting hours?")).toBe(CONFIG.stt.completeHoldMs);
    expect(endpointHoldMs("I want to book an appointment.")).toBe(CONFIG.stt.completeHoldMs);
    expect(endpointHoldMs("मुझे अपॉइंटमेंट चाहिए।")).toBe(CONFIG.stt.completeHoldMs);
  });

  it("trailing-off speech gets the long hold", () => {
    expect(endpointHoldMs("I was wondering about my surgery and")).toBe(CONFIG.stt.incompleteHoldMs);
    expect(endpointHoldMs("So the thing is,")).toBe(CONFIG.stt.incompleteHoldMs);
    expect(endpointHoldMs("I'm really worried that um")).toBe(CONFIG.stt.incompleteHoldMs);
    expect(endpointHoldMs("Well...")).toBe(CONFIG.stt.incompleteHoldMs);
    expect(endpointHoldMs("मुझे दर्द है और")).toBe(CONFIG.stt.incompleteHoldMs);
  });

  it("unpunctuated text gets the middle hold, and every hold is shorter than the old fixed wait", () => {
    expect(endpointHoldMs("book me a table for two")).toBe(CONFIG.stt.uncertainHoldMs);
    expect(CONFIG.stt.completeHoldMs).toBeLessThan(CONFIG.stt.uncertainHoldMs);
    expect(CONFIG.stt.uncertainHoldMs).toBeLessThan(CONFIG.stt.incompleteHoldMs);
    expect(CONFIG.stt.incompleteHoldMs).toBeLessThanOrEqual(CONFIG.stt.utteranceEndMs);
  });
});
