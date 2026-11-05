import { describe, it, expect } from "vitest";
import { buildListenParams } from "../../lib/deepgram/live";
import { CONFIG } from "../../lib/config";

/**
 * BUG-E19: CONFIG.deepgram.sttHindiCodeSwitching defaults to false — these
 * tests lock in that the default path is byte-for-byte today's production
 * behavior (model=nova-2, language=en, no language_hint), and that turning
 * the flag on switches to Deepgram's documented Hindi+English code-switching
 * params (model=nova-3, language=multi, language_hint=hi + en) rather than
 * silently changing behavior for everyone by default.
 */
describe("buildListenParams", () => {
  it("CONFIG's actual default is off", () => {
    expect(CONFIG.deepgram.sttHindiCodeSwitching).toBe(false);
  });

  it("defaults to unchanged nova-2/en with no language hints", () => {
    const params = buildListenParams(8000, { codeSwitching: false });
    expect(params.get("model")).toBe("nova-2");
    expect(params.get("language")).toBe("en");
    expect(params.getAll("language_hint")).toEqual([]);
    expect(params.get("sample_rate")).toBe("8000");
  });

  it("switches to nova-3 + multi + hi/en hints when the flag is on", () => {
    const params = buildListenParams(16000, { codeSwitching: true });
    expect(params.get("model")).toBe("nova-3");
    expect(params.get("language")).toBe("multi");
    expect(params.getAll("language_hint")).toEqual(["hi", "en"]);
    expect(params.get("endpointing")).toBe("100"); // Deepgram's recommended value for streaming code-switching
  });

  it("with no override, reads CONFIG directly (and CONFIG defaults off)", () => {
    const params = buildListenParams(8000);
    expect(params.get("model")).toBe("nova-2");
  });
});
