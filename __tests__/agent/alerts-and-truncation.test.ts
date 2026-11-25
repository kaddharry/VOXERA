import { describe, it, expect } from "vitest";
import { alertPriority, isTestSession } from "../../lib/agent/alert-priority";
import { mergeAlertReason } from "../../lib/db/alerts";
import { endsSentence, trimToLastSentence } from "../../lib/agent/llm";

describe("alertPriority", () => {
  it("'a little pain' is low, not high", () => {
    expect(alertPriority({ label: "pain", intensity: 0.6, text: "I have a little pain in my knee" })).toBe("low");
    expect(alertPriority({ label: "pain", intensity: 0.9, escalate: "human", text: "थोड़ा दर्द है" })).toBe("low");
  });
  it("emergencies are high whatever the label", () => {
    expect(alertPriority({ label: "neutral", intensity: 0.2, text: "I can't breathe properly" })).toBe("high");
    expect(alertPriority({ label: "pain", intensity: 0.5, text: "सीने में दर्द हो रहा है" })).toBe("high");
  });
  it("clear pain is medium, strong distress or a human escalation is high", () => {
    expect(alertPriority({ label: "pain", intensity: 0.6, text: "my back hurts a lot" })).toBe("normal");
    expect(alertPriority({ label: "distress", intensity: 0.85, text: "please help me" })).toBe("high");
    expect(alertPriority({ label: "frustration", intensity: 0.8, escalate: "human", text: "nobody is listening" })).toBe("high");
    expect(alertPriority({ label: "frustration", intensity: 0.5, escalate: "tier2", text: "kab se wait kar raha hoon" })).toBe("normal");
  });
});

describe("one alert per call", () => {
  it("a repeat of the same problem leaves the reason unchanged; a new one is added", () => {
    const r1 = 'Caller sounded pain: "dard ho raha hai"';
    expect(mergeAlertReason(r1, "Caller sounded pain", '"again"')).toBe(r1);
    expect(mergeAlertReason(r1, "Escalation (tier2)", "frustration")).toBe(`${r1} · Escalation (tier2): frustration`);
  });
  it("test sessions are told apart from real phone calls", () => {
    expect(isTestSession("browser-abc")).toBe(true);
    expect(isTestSession("demo-session")).toBe(true);
    expect(isTestSession("tel-abc")).toBe(false);
    expect(isTestSession(null)).toBe(false);
  });
});

describe("token-limit cut-offs", () => {
  it("drops the unfinished last sentence", () => {
    const cut = "कृपया शांत रहें। अगर दर्द बढ़े तो तुरंत आपातकालीन लाइन से संपर्क";
    expect(endsSentence(cut)).toBe(false);
    expect(trimToLastSentence(cut)).toBe("कृपया शांत रहें।");
    expect(trimToLastSentence("All good. Thanks!")).toBe("All good. Thanks!");
    expect(trimToLastSentence("no sentence end at all")).toBe("no sentence end at all");
  });
});
