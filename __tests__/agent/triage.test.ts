import { describe, expect, it } from "vitest";
import {
  assessSeverity,
  decideBooking,
  EMPTY_EVIDENCE,
  gatherBookingEvidence,
  LOW_PRIORITY_THRESHOLD,
  priorityScoreFor,
  type BookingEvidence,
} from "../../lib/agent/triage";
import { createFakeDb } from "../helpers/fake-supabase";

const ev = (over: Partial<BookingEvidence> = {}): BookingEvidence => ({ ...EMPTY_EVIDENCE, utterances: [], lastCallConcerns: [], ...over });

describe("assessSeverity — what the call itself supports", () => {
  it("is routine when nothing clinical was said", () => {
    expect(assessSeverity(ev({ utterances: ["Hi, I want to see the doctor sometime next week", "Any day is fine"] })).level).toBe("routine");
  });

  it.each([
    ["English", "The pain is getting worse and I can't sleep"],
    ["English fever", "I have had a fever since yesterday and the wound is swollen"],
    ["Hinglish", "Mujhe bahut dard ho raha hai, sujan bhi badh gayi hai"],
    ["Hinglish fever", "Kal se bukhar hai aur aaram nahi hai"],
    ["Hindi", "मुझे बहुत दर्द है और सूजन बढ़ रही है"],
    ["Hindi fever", "बुखार है और चक्कर आ रहे हैं"],
  ])("rates a severe symptom as serious (%s)", (_lang, said) => {
    expect(assessSeverity(ev({ utterances: [said] })).level).toBe("serious");
  });

  it.each([
    ["English", "I can't breathe properly and my chest hurts"],
    ["Hinglish", "Mujhe saans nahi aa rahi"],
    ["Hindi", "मुझे सीने में दर्द है"],
  ])("rates emergency words as emergency (%s)", (_lang, said) => {
    expect(assessSeverity(ev({ utterances: [said] })).level).toBe("emergency");
  });

  it("treats a mild symptom as moderate, not serious", () => {
    expect(assessSeverity(ev({ utterances: ["a little pain in my knee"] })).level).toBe("moderate");
    expect(assessSeverity(ev({ utterances: ["thoda dard hai"] })).level).toBe("moderate");
    expect(assessSeverity(ev({ utterances: ["a slight fever"] })).level).toBe("moderate");
  });

  it("uses the emotion engine, open alerts, last call's pain and patient risk", () => {
    expect(assessSeverity(ev({ emotionPeak: { label: "pain", intensity: 0.85 } })).level).toBe("serious");
    expect(assessSeverity(ev({ emotionPeak: { label: "pain", intensity: 0.5 } })).level).toBe("moderate");
    expect(assessSeverity(ev({ emotionPeak: { label: "joy", intensity: 0.9 } })).level).toBe("routine");
    expect(assessSeverity(ev({ hasOpenHighAlert: true })).level).toBe("serious");
    expect(assessSeverity(ev({ lastCallPainScore: 8, utterances: ["it still hurts"] })).level).toBe("serious");
    expect(assessSeverity(ev({ lastCallPainScore: 8 })).level).toBe("routine");
    expect(assessSeverity(ev({ riskLevel: "critical", utterances: ["some pain"] })).level).toBe("serious");
    expect(assessSeverity(ev({ riskLevel: "high" })).level).toBe("moderate");
    expect(assessSeverity(ev({ lastCallConcerns: ["wound looked red"] })).level).toBe("moderate");
  });

  it("explains itself", () => {
    expect(assessSeverity(ev({ utterances: ["severe pain"] })).reasons.join(" ")).toMatch(/serious symptom/);
    expect(assessSeverity(ev()).reasons).toEqual(["Nothing in the call suggests a clinical need."]);
  });
});

describe("decideBooking — the server decides, not the model", () => {
  it("declines a routine request and tells the model what to say", () => {
    const d = decideBooking({ claimed: "routine", evidence: ev({ utterances: ["can I get an appointment next week"] }) });
    expect(d.allow).toBe(false);
    expect(d.refusal).toMatch(/Do NOT book/);
    expect(d.severity).toBe("routine");
  });

  it("caps a claimed 'serious' that the call doesn't support — and then declines without context", () => {
    const d = decideBooking({ claimed: "serious", evidence: ev({ utterances: ["I just want a check-up"] }) });
    expect(d.severity).toBe("moderate");
    expect(d.allow).toBe(false);
    expect(d.reasons.join(" ")).toMatch(/rated this "serious" but the call doesn't support that/);
  });

  it("allows a serious call, and never lets the model lower what the evidence shows", () => {
    const said = ev({ utterances: ["the pain is unbearable"] });
    expect(decideBooking({ claimed: "serious", evidence: said })).toMatchObject({ allow: true, severity: "serious" });
    expect(decideBooking({ claimed: "routine", evidence: said })).toMatchObject({ allow: true, severity: "serious" });
    expect(decideBooking({ claimed: null, evidence: said }).allow).toBe(true);
  });

  it("books an emergency", () => {
    expect(decideBooking({ claimed: "emergency", evidence: ev({ utterances: ["chest pain"] }) })).toMatchObject({ allow: true, severity: "emergency" });
  });

  it("books a moderate case only with supporting context", () => {
    const mild = ev({ utterances: ["a bit of pain"] });
    expect(decideBooking({ claimed: "moderate", evidence: mild }).allow).toBe(false);
    expect(decideBooking({ claimed: "moderate", evidence: { ...mild, riskLevel: "high" } }).allow).toBe(true);
    expect(decideBooking({ claimed: "moderate", evidence: { ...mild, lastCallConcerns: ["swelling"] } }).allow).toBe(true);
    expect(decideBooking({ claimed: "moderate", evidence: { ...mild, lastCallPainScore: 6 } }).allow).toBe(true);
  });

  it("never books on history alone: a flagged concern from last call doesn't justify an unrelated request", () => {
    const history = ev({ utterances: ["can I get a check-up sometime next week?"], riskLevel: "high", lastCallConcerns: ["back pain"], lastCallPainScore: 6 });
    expect(decideBooking({ claimed: "routine", evidence: history })).toMatchObject({ allow: false, severity: "moderate" });
    expect(decideBooking({ claimed: "moderate", evidence: history }).allow).toBe(false);
    // …but the same history plus the caller raising the pain again does.
    expect(decideBooking({ claimed: "moderate", evidence: { ...history, utterances: ["my back still hurts"] } }).allow).toBe(true);
  });

  it("lets a model claim 'moderate' but that alone books nothing", () => {
    expect(decideBooking({ claimed: "moderate", evidence: ev() })).toMatchObject({ allow: false, severity: "moderate" });
  });
});

describe("priority score", () => {
  it("orders emergency > serious > moderate > routine and adds risk and pain", () => {
    const s = (sev: Parameters<typeof priorityScoreFor>[0]) => priorityScoreFor(sev, "low", null);
    expect(s("emergency")).toBeGreaterThan(s("serious"));
    expect(s("serious")).toBeGreaterThan(s("moderate"));
    expect(s("moderate")).toBeGreaterThan(s("routine"));
    expect(priorityScoreFor("serious", "critical", 9)).toBeGreaterThan(s("serious"));
    expect(priorityScoreFor("emergency", "critical", 10)).toBeLessThanOrEqual(100);
  });

  it("puts routine visits under the low-priority line and serious ones over it", () => {
    expect(priorityScoreFor("routine", "low", null)).toBeLessThan(LOW_PRIORITY_THRESHOLD);
    expect(priorityScoreFor("serious", "low", null)).toBeGreaterThan(LOW_PRIORITY_THRESHOLD);
  });
});

describe("gatherBookingEvidence", () => {
  it("reads this call's words, emotion, alerts, the patient's risk and the last call's summary", async () => {
    const db = createFakeDb({
      patients: [{ id: "pt1", riskLevel: "high" }],
      session_logs: [
        { sessionId: "s1", type: "utterance", ts: 1, payload: { role: "user", text: "my wound hurts a lot" } },
        { sessionId: "s1", type: "utterance", ts: 2, payload: { role: "agent", text: "I'm sorry to hear that" } },
        { sessionId: "s1", type: "emotion", ts: 3, payload: { label: "pain", intensity: 0.7 } },
        { sessionId: "s1", type: "emotion", ts: 4, payload: { label: "pain", intensity: 0.9 } },
        { sessionId: "other", type: "utterance", ts: 1, payload: { role: "user", text: "someone else" } },
      ],
      alerts: [{ id: "a1", sessionId: "s1", status: "open", priority: "high" }],
      call_logs: [
        { id: "c1", clientId: "c", patientId: "pt1", startedAt: 100, summary: { flaggedConcerns: ["redness"], painReported: { present: true, score: 6 } } },
        { id: "c0", clientId: "c", patientId: "pt1", startedAt: 50, summary: { flaggedConcerns: ["old"], painReported: { present: false } } },
      ],
    });
    const e = await gatherBookingEvidence(db as never, { clientId: "c", patientId: "pt1", sessionId: "s1" });
    expect(e.utterances).toEqual(["my wound hurts a lot"]);
    expect(e.emotionPeak).toEqual({ label: "pain", intensity: 0.9 });
    expect(e.hasOpenHighAlert).toBe(true);
    expect(e.riskLevel).toBe("high");
    expect(e.lastCallConcerns).toEqual(["redness"]);
    expect(e.lastCallPainScore).toBe(6);
  });

  it("degrades to 'no evidence' (so: don't book) when nothing can be read", async () => {
    const e = await gatherBookingEvidence(createFakeDb() as never, { clientId: "c", patientId: "x" });
    expect(e).toMatchObject({ utterances: [], riskLevel: "low", hasOpenHighAlert: false, lastCallPainScore: null });
    expect(decideBooking({ claimed: "serious", evidence: e }).allow).toBe(false);
  });
});
