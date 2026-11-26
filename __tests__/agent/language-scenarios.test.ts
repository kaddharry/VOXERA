import { describe, expect, it } from "vitest";
import { LANGUAGE_SCENARIOS } from "../fixtures/language-scenarios";
import { assessSeverity, decideBooking, EMPTY_EVIDENCE, type BookingEvidence } from "../../lib/agent/triage";
import { isMedicationTurn, BOOKING_HINT } from "../../lib/agent/booking-intent";
import { buildLLMContext } from "../../lib/agent/context";
import { formatCarePlan } from "../../lib/agent/care-plan";
import { detectCallerLanguage } from "../../lib/agent/context";

const ev = (said: string, over: Partial<BookingEvidence> = {}): BookingEvidence => ({ ...EMPTY_EVIDENCE, utterances: [said], lastCallConcerns: [], ...over });

const NOW = Date.now();
const carePlan = formatCarePlan(
  {
    lastCall: { startedAt: NOW - 3 * 86_400_000, endedAt: NOW - 3 * 86_400_000, pain: { present: true, location: "knee", score: 6, description: null }, concerns: [] },
    medications: [{ id: "med1", clientId: "c", patientId: "p", providerId: null, name: "Metformin", dosage: "500 mg", frequency: "twice a day", timesPerDay: 2, instructions: null, startDate: 0, endDate: null, status: "active", createdAt: 0, updatedAt: 0 }],
    adherence: [],
    instructions: [],
  },
  NOW,
);

describe.each(LANGUAGE_SCENARIOS)("scripted call — $label", (sc) => {
  it("moment 3: a routine request for a visit is NOT booked", () => {
    expect(BOOKING_HINT.test(sc.routineRequest)).toBe(true); // it IS a booking conversation…
    const d = decideBooking({ claimed: "routine", evidence: ev(sc.routineRequest) });
    expect(d.allow).toBe(false); // …and the agent still doesn't book it
    expect(assessSeverity(ev(sc.routineRequest)).level).toBe("routine");
  });

  it("moment 4: a genuinely serious complaint IS booked", () => {
    const d = decideBooking({ claimed: "serious", evidence: ev(sc.seriousComplaint) });
    expect(d).toMatchObject({ allow: true, severity: "serious" });
  });

  it("moment 4b: a mild complaint alone is not enough", () => {
    expect(assessSeverity(ev(sc.mildComplaint)).level).toBe("moderate");
    expect(decideBooking({ claimed: "moderate", evidence: ev(sc.mildComplaint) }).allow).toBe(false);
  });

  it("…unless the patient is high-risk, in which case the same mild complaint is booked", () => {
    expect(decideBooking({ claimed: "moderate", evidence: ev(sc.mildComplaint, { riskLevel: "high" }) }).allow).toBe(true);
  });

  it("moment 2: talking about the medicine switches the care-plan tool on", () => {
    expect(isMedicationTurn(sc.medicineAnswers.taken, carePlan)).toBe(true);
    expect(isMedicationTurn(sc.medicineAnswers.missed, carePlan)).toBe(true);
    // Chat that isn't about medicines or a visit keeps the fast, tool-free path.
    expect(isMedicationTurn(sc.painAnswer, carePlan)).toBe(false);
  });

  it("moment 1: the prompt tells the agent to ask about last call's pain, and the caller's script is recognised", () => {
    const { system, user } = buildLLMContext({
      userId: "u", clientId: "c",
      userTurn: { id: "t", role: "user", text: sc.painAnswer, ts: 1 },
      retrieved: { mtm: [], ltmUser: [], ltmClient: [], stm: [] } as never,
      emotion: { current: { label: "neutral", intensity: 0, confidence: 0.5, vad: { v: 0, a: 0, d: 0 }, source: "text", at: 1 }, trajectory: { slope_v: 0, slope_a: 0, window: 0 }, zDeviation: 0, flags: { repeated_frustration: false, increasing_distress: false, affect_oscillation: false, chronic_negativity: false }, baseline: { v: 0, a: 0, d: 0, sigma_v: 0.3, sigma_a: 0.3, sigma_d: 0.3 } } as never,
      policy: { acknowledgeFirst: false, pace: "normal", allowUpsell: false, escalate: "none", notes: [] } as never,
      language: sc.language,
      carePlanContext: carePlan,
    });
    expect(system).toContain("pain in the knee, about 6/10");
    expect(system).toContain("record_medication_adherence");
    expect(user).toContain(`USER: ${sc.painAnswer}`);
  });

  it("the caller's language is detected from what they say", () => {
    const detected = detectCallerLanguage(sc.seriousComplaint);
    if (sc.id === "english") expect(detected).toBe("English");
    if (sc.id === "hinglish") expect(detected).toBe("Hinglish (Roman letters)");
    if (sc.id === "hindi") expect(detected).toBe("Hindi (Devanagari)");
  });
});
