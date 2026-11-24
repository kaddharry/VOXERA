import { describe, it, expect, vi } from "vitest";
vi.mock("../../lib/db/supabase", () => ({ supabase: { from: vi.fn() }, isSupabaseHealthy: () => true, recordSupabaseSuccess: vi.fn(), recordSupabaseFailure: vi.fn() }));
vi.mock("../../lib/agent/llm", () => ({ generateReply: vi.fn() }));

import { isClinicalLesson, REVIEW_APPROVED, REVIEW_PENDING, REVIEW_REJECTED } from "../../lib/learning/clinical";
import { applyExtraction } from "../../lib/learning/merge";
import { buildLearningContext } from "../../lib/learning/context";
import { createMemoryLearningStore } from "../../lib/learning/store";
import { validateExtraction } from "../../lib/learning/extract";
import type { Extraction, Learning } from "../../lib/learning/types";

const CLIENT = "t1";
const ex = (lessons: Extraction["lessons"]): Extraction => ({ patientFacts: [], resolvedKeys: [], lessons });
const les = (text: string, clinical = false) => ({ category: "escalation", text, confidence: 0.8, evidence: "e", general: false, clinical });
const ER = "If a patient reports shortness of breath after a cardiac procedure, immediately advise them to go to the nearest emergency department.";
const OPTIONS = "Limit scheduling options to two so patients are not overwhelmed.";

describe("isClinicalLesson", () => {
  it("flags medical guidance", () => {
    expect(isClinicalLesson(ER)).toBe(true);
    expect(isClinicalLesson("Screen for chest pain or breathing trouble when a patient reports a stroke.")).toBe(true);
    expect(isClinicalLesson("Remind patients to take their medicine with food.")).toBe(true);
    expect(isClinicalLesson("Tell the patient to stop taking the antibiotic if they feel better.")).toBe(true);
  });
  it("leaves scheduling, tone and language lessons alone", () => {
    expect(isClinicalLesson(OPTIONS)).toBe(false);
    expect(isClinicalLesson("Speak slowly when a patient has hearing difficulties.")).toBe(false);
    expect(isClinicalLesson("Confirm preferred call times before proposing slots.")).toBe(false);
    expect(isClinicalLesson("Ask for a pain score and location.")).toBe(false);
    expect(isClinicalLesson("Let the patient finish describing their concerns before asking specific symptom questions.")).toBe(false);
  });
});

describe("clinical lessons need a human", () => {
  it("never go live on their own, however many calls show them; ordinary lessons still do", async () => {
    const store = createMemoryLearningStore();
    for (const c of ["c1", "c2", "c3", "c4", "c5"]) {
      await applyExtraction({ store, clientId: CLIENT, agentId: "a1", callId: c, extraction: ex([les(ER, true), les(OPTIONS)]) });
    }
    const rows = store.rows.filter((r) => r.scope === "agent");
    const er = rows.find((r) => r.text === ER)!;
    expect(er.key).toBe(REVIEW_PENDING);
    expect(er.status).toBe("pending");
    expect(er.supportCount).toBe(5); // the evidence keeps counting, it just cannot go live
    expect(rows.find((r) => r.text === OPTIONS)!.status).toBe("active");
    // and the shared (global) copy of a clinical lesson is also held back
    const globals = store.rows.filter((r) => r.scope === "global");
    expect(globals.find((g) => g.text === ER)?.status).not.toBe("active");
    expect(globals.find((g) => g.text === OPTIONS)?.status).toBe("active");
  });

  it("the model's clinical flag alone is enough, even when the wording looks harmless", async () => {
    const store = createMemoryLearningStore();
    await applyExtraction({ store, clientId: CLIENT, agentId: "a1", callId: "c1", extraction: ex([les("Reassure patients that this is normal.", true)]) });
    expect(store.rows[0].key).toBe(REVIEW_PENDING);
  });

  it("never reaches a prompt while waiting, even if a row were somehow active", () => {
    const row = (o: Partial<Learning>): Learning => ({ id: Math.random().toString(), clientId: CLIENT, scope: "agent", agentId: "a1", patientId: null, category: "escalation", key: null, text: "t", evidence: [], sourceCallIds: ["c"], supportCount: 3, confidence: 0.9, status: "active", createdAt: 1, updatedAt: 1, ...o });
    const text = buildLearningContext({ patient: [], global: [], agent: [row({ text: "WAITING one", key: REVIEW_PENDING }), row({ text: "REJECTED one", key: REVIEW_REJECTED }), row({ text: "APPROVED one", key: REVIEW_APPROVED }), row({ text: "ordinary one" })] })!;
    expect(text).not.toContain("WAITING one");
    expect(text).not.toContain("REJECTED one");
    expect(text).toContain("APPROVED one");
    expect(text).toContain("ordinary one");
  });

  it("an approved lesson goes live and keeps following the normal rules", async () => {
    const store = createMemoryLearningStore();
    await applyExtraction({ store, clientId: CLIENT, agentId: "a1", callId: "c1", extraction: ex([les(ER, true)]) });
    const er = store.rows[0];
    await store.update(er.id, { key: REVIEW_APPROVED, status: "active" }); // what PATCH approve does
    expect((await store.listAgent(CLIENT, "a1")).map((r) => r.text)).toEqual([ER]);
    await applyExtraction({ store, clientId: CLIENT, agentId: "a1", callId: "c2", extraction: ex([les(ER, true)]) });
    expect(store.rows.filter((r) => r.scope === "agent")).toHaveLength(1);
    expect(store.rows[0].supportCount).toBe(2);
    expect(store.rows[0].key).toBe(REVIEW_APPROVED);
  });

  it("a rejected lesson is never proposed again, by any later call", async () => {
    const store = createMemoryLearningStore();
    await applyExtraction({ store, clientId: CLIENT, agentId: "a1", callId: "c1", extraction: ex([les(ER, true)]) });
    await store.update(store.rows[0].id, { key: REVIEW_REJECTED, status: "retired" }); // what PATCH reject does
    for (const c of ["c2", "c3", "c4"]) await applyExtraction({ store, clientId: CLIENT, agentId: "a1", callId: c, extraction: ex([les(ER, true)]) });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].status).toBe("retired");
    expect(await store.listAgent(CLIENT, "a1")).toHaveLength(0);
  });

  it("extraction carries the model's clinical flag through", () => {
    const raw = JSON.stringify({ patientFacts: [], resolvedKeys: [], lessons: [{ category: "escalation", text: "Advise ER visits for chest pain.", confidence: 0.8, evidence: "chest pain", general: false, clinical: true }] });
    const { extraction } = validateExtraction(raw, { patientText: "I have chest pain", fullText: "I have chest pain", identifiers: {} });
    expect(extraction.lessons[0].clinical).toBe(true);
  });
});
