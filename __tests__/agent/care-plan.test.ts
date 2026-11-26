import { describe, expect, it } from "vitest";
import { buildCarePlanContext, describeAge, formatCarePlan, loadApprovedInstructions, loadLastCall } from "../../lib/agent/care-plan";
import { buildLLMContext } from "../../lib/agent/context";
import { createFakeDb } from "../helpers/fake-supabase";

const NOW = Date.UTC(2026, 10, 26, 10, 0, 0);
const DAY = 86_400_000;
const med = (over: Record<string, unknown> = {}) =>
  ({ id: "med1", clientId: "c", patientId: "pt1", providerId: null, name: "Metformin", dosage: "500 mg", frequency: "twice a day after food", timesPerDay: 2, instructions: null, startDate: 0, endDate: null, status: "active", createdAt: 0, updatedAt: 0, ...over }) as never;

describe("describeAge", () => {
  it("speaks like a person", () => {
    expect(describeAge(NOW - 3 * 3_600_000, NOW)).toBe("earlier today");
    expect(describeAge(NOW - DAY, NOW)).toBe("yesterday");
    expect(describeAge(NOW - 4 * DAY, NOW)).toBe("4 days ago");
    expect(describeAge(NOW - 21 * DAY, NOW)).toBe("3 weeks ago");
    expect(describeAge(null, NOW)).toBe("earlier");
  });
});

describe("formatCarePlan — pain from the last call", () => {
  const lastCall = { startedAt: NOW - 3 * DAY, endedAt: NOW - 3 * DAY, pain: { present: true, location: "lower back", score: 6, description: "worse at night" }, concerns: [] };

  it("tells the agent to open by asking about the pain, once", () => {
    const text = formatCarePlan({ lastCall, medications: [], adherence: [], instructions: [] }, NOW);
    expect(text).toContain("=== CARE PLAN ===");
    expect(text).toContain("LAST CALL (3 days ago)");
    expect(text).toContain("pain in the lower back, about 6/10");
    expect(text).toContain("worse at night");
    expect(text).toMatch(/START this call by asking/);
    expect(text).toMatch(/only once per call/);
  });

  it("links a worsening answer to the severity-checked booking tool", () => {
    const text = formatCarePlan({ lastCall, medications: [], adherence: [], instructions: [] }, NOW);
    expect(text).toMatch(/book_appointment/);
    expect(text).toMatch(/genuinely serious/);
  });

  it("doesn't invent pain when the last call had none", () => {
    const text = formatCarePlan({ lastCall: { ...lastCall, pain: null }, medications: [], adherence: [], instructions: [] }, NOW);
    expect(text).toMatch(/no pain or concern was reported/);
    expect(text).not.toMatch(/START this call by asking/);
  });

  it("carries earlier concerns even without pain", () => {
    const text = formatCarePlan({ lastCall: { ...lastCall, pain: null, concerns: ["stitches looked red"] }, medications: [], adherence: [], instructions: [] }, NOW);
    expect(text).toContain("Concern flagged then: stitches looked red");
  });

  it("is empty when there is nothing to carry over", () => {
    expect(formatCarePlan({ lastCall: null, medications: [], adherence: [], instructions: [] }, NOW)).toBe("");
  });
});

describe("formatCarePlan — medicines and doctor instructions", () => {
  it("lists active medicines with their ids and the last answer, one question at a time", () => {
    const text = formatCarePlan(
      {
        lastCall: null,
        medications: [med(), med({ id: "med2", name: "Old", status: "stopped" })],
        adherence: [{ medicationId: "med1", name: "Metformin", dosage: null, frequency: "", adherencePct: 40, reports: 3, taken: 1, partial: 0, missed: 2, missedStreak: 2, lastStatus: "missed", lastReportedAt: NOW - DAY, atRisk: true }],
        instructions: [],
      },
      NOW,
    );
    expect(text).toContain("Metformin 500 mg, twice a day after food — last reported: missed (yesterday) ⚠ often missed [id=med1]");
    expect(text).not.toContain("Old");
    expect(text).toContain("record_medication_adherence");
    expect(text).toMatch(/ONE per turn/);
    expect(text).toMatch(/Never advise changing a dose/);
  });

  it("marks a medicine nobody asked about yet", () => {
    const text = formatCarePlan({ lastCall: null, medications: [med()], adherence: [], instructions: [] }, NOW);
    expect(text).toContain("not asked yet");
  });

  it("includes only the doctor instructions it is given, labelled by scope", () => {
    const text = formatCarePlan(
      { lastCall: null, medications: [], adherence: [], instructions: [{ id: "i1", title: "t", instruction: "Ask about swelling near the stitches.", patientSpecific: true, doctorName: "Dr. Rao" }, { id: "i2", title: "t", instruction: "Remind about fluids.", patientSpecific: false, doctorName: "Dr. Rao" }] },
      NOW,
    );
    expect(text).toContain("Dr. Rao: Ask about swelling near the stitches.");
    expect(text).toContain("Remind about fluids. (all this doctor's patients)");
  });
});

describe("loading the care plan", () => {
  const seed = () =>
    createFakeDb({
      patients: [{ id: "pt1", clientId: "c", primaryProviderId: "doc1" }, { id: "pt2", clientId: "c", primaryProviderId: "doc2" }],
      providers: [{ id: "doc1", name: "Dr. Rao" }, { id: "doc2", name: "Dr. Shah" }],
      call_logs: [
        { id: "c2", clientId: "c", patientId: "pt1", startedAt: NOW - 2 * DAY, endedAt: NOW - 2 * DAY, summary: { flaggedConcerns: ["knee swelling"], painReported: { present: true, location: "knee", score: 5, description: null } } },
        { id: "c1", clientId: "c", patientId: "pt1", startedAt: NOW - 9 * DAY, endedAt: NOW - 9 * DAY, summary: { flaggedConcerns: [], painReported: { present: false } } },
        { id: "cx", clientId: "c", patientId: "pt1", startedAt: NOW, endedAt: null, summary: null },
        { id: "ot", clientId: "other", patientId: "pt1", startedAt: NOW - DAY, summary: { painReported: { present: true, location: "head", score: 9 } } },
      ],
      medications: [{ id: "med1", clientId: "c", patientId: "pt1", name: "Metformin", dosage: "500 mg", frequency: "daily", timesPerDay: 1, status: "active", instructions: null, startDate: 0, endDate: null, createdAt: 1, updatedAt: 1, providerId: null }],
      medication_adherence: [{ id: "a1", clientId: "c", patientId: "pt1", medicationId: "med1", status: "missed", reportedAt: NOW - DAY, sessionId: "s0", source: "call", note: null }],
      agent_instruction_requests: [
        { id: "r1", clientId: "c", provider_id: "doc1", patientId: "pt1", title: "Swelling", proposed_instruction: "Ask about swelling.", status: "approved" },
        { id: "r2", clientId: "c", provider_id: "doc1", patientId: null, title: "All", proposed_instruction: "Ask about hydration.", status: "approved" },
        { id: "r3", clientId: "c", provider_id: "doc1", patientId: "pt1", title: "Pending", proposed_instruction: "PENDING SECRET", status: "pending" },
        { id: "r4", clientId: "c", provider_id: "doc1", patientId: "pt1", title: "Rejected", proposed_instruction: "REJECTED SECRET", status: "rejected" },
        { id: "r5", clientId: "c", provider_id: "doc2", patientId: null, title: "Other doctor", proposed_instruction: "OTHER DOCTOR", status: "approved" },
        { id: "r6", clientId: "c", provider_id: "doc1", patientId: "pt2", title: "Other patient", proposed_instruction: "OTHER PATIENT", status: "approved" },
      ],
    });

  it("uses the most recent call that has a summary, scoped to the hospital", async () => {
    const last = await loadLastCall(seed() as never, "c", "pt1");
    expect(last?.pain).toMatchObject({ location: "knee", score: 5 });
    expect(last?.concerns).toEqual(["knee swelling"]);
  });

  it("returns only APPROVED instructions for this patient or this patient's own doctor", async () => {
    const got = await loadApprovedInstructions(seed() as never, "c", "pt1", "doc1");
    expect(got.map((i) => i.id).sort()).toEqual(["r1", "r2"]);
    expect(got.find((i) => i.id === "r1")).toMatchObject({ patientSpecific: true, doctorName: "Dr. Rao" });
    expect(got.find((i) => i.id === "r2")!.patientSpecific).toBe(false);
  });

  it("builds the whole block end to end — and never leaks unapproved text", async () => {
    const text = await buildCarePlanContext(seed() as never, { clientId: "c", patientId: "pt1" });
    expect(text).toContain("pain in the knee, about 5/10");
    expect(text).toContain("Metformin 500 mg");
    expect(text).toContain("last reported: missed");
    expect(text).toContain("Ask about swelling.");
    expect(text).toContain("Ask about hydration.");
    for (const secret of ["PENDING SECRET", "REJECTED SECRET", "OTHER DOCTOR", "OTHER PATIENT"]) expect(text).not.toContain(secret);
  });

  it("is empty for a patient with nothing on file", async () => {
    expect(await buildCarePlanContext(createFakeDb({ patients: [{ id: "z" }] }) as never, { clientId: "c", patientId: "z" })).toBe("");
  });
});

describe("the care plan reaches the prompt", () => {
  const base = {
    userId: "u", clientId: "c", userTurn: { id: "t1", role: "user" as const, text: "Hello", ts: 1 },
    retrieved: { mtm: [], ltmUser: [], ltmClient: [], stm: [] } as never,
    emotion: { current: { label: "neutral", intensity: 0, confidence: 0.5, vad: { v: 0, a: 0, d: 0 }, source: "text", at: 1 }, trajectory: { slope_v: 0, slope_a: 0, window: 0 }, zDeviation: 0, flags: { repeated_frustration: false, increasing_distress: false, affect_oscillation: false, chronic_negativity: false }, baseline: { v: 0, a: 0, d: 0, sigma_v: 0.3, sigma_a: 0.3, sigma_d: 0.3 } } as never,
    policy: { acknowledgeFirst: false, pace: "normal", allowUpsell: false, escalate: "none", notes: [] } as never,
  };

  it.each(["en-IN", "hi-IN", "hi-en"])("puts the care plan in the system prompt for %s calls", (language) => {
    const { system } = buildLLMContext({ ...base, language, carePlanContext: "=== CARE PLAN ===\nLAST CALL (3 days ago): pain in the knee" });
    expect(system).toContain("=== CARE PLAN ===");
    expect(system).toContain("pain in the knee");
    expect(system).toMatch(/never overrides the CORE RULES/);
  });

  it("adds nothing when there is no care plan", () => {
    expect(buildLLMContext({ ...base }).system).not.toContain("CARE PLAN");
  });
});
