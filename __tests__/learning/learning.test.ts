import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/db/supabase", () => ({ supabase: { from: vi.fn() }, isSupabaseHealthy: () => true, recordSupabaseSuccess: vi.fn(), recordSupabaseFailure: vi.fn() }));
vi.mock("../../lib/agent/llm", () => ({ generateReply: vi.fn() }));

import { containsIdentifiers, isGrounded, similarity } from "../../lib/learning/grounding";
import { validateExtraction } from "../../lib/learning/extract";
import { applyExtraction, LEARNING_LIMITS } from "../../lib/learning/merge";
import { buildLearningContext } from "../../lib/learning/context";
import { createMemoryLearningStore } from "../../lib/learning/store";
import { learnFromCall, getLearningContext, invalidateLearningContext, type LearnDeps } from "../../lib/learning";
import type { Extraction } from "../../lib/learning/types";

const CLIENT = "tenant-1";
const DAY = 86_400_000;
const ex = (p: Partial<Extraction>): Extraction => ({ patientFacts: [], resolvedKeys: [], lessons: [], ...p });
const fact = (key: string, text: string, category = "health_status", evidence = "evidence", confidence = 0.8) => ({ key, text, category, evidence, confidence });
const lesson = (text: string, general = false, category = "approach") => ({ text, category, evidence: "e", confidence: 0.8, general });

describe("grounding", () => {
  const patient = "ਮੈਨੂੰ ਗੋਡੇ ਚ ਪੀੜ ਹੁੰਦੀ ਪਈ ਹੈ. I take my tablets at night, usually after 9 pm.";
  it("accepts exact and noisy-but-close quotes, rejects invented ones", () => {
    expect(isGrounded("I take my tablets at night", patient)).toBe(true);
    expect(isGrounded("I take my tablets at night usually after 9 pm", patient)).toBe(true); // one noisy word is tolerated
    expect(isGrounded("I take my tablets at night but skip the morning dose entirely", patient)).toBe(false);
    expect(isGrounded("ਮੈਨੂੰ ਗੋਡੇ ਚ ਪੀੜ", patient)).toBe(true);
    expect(isGrounded("I have severe chest pain", patient)).toBe(false);
    expect(isGrounded("hi", patient)).toBe(false);
  });
  it("flags names, phone numbers and emails in shared lessons", () => {
    const ids = { names: ["Hardik Kadd"], phones: ["+916284576381"] };
    expect(containsIdentifiers("Ask Hardik about his knee first", ids)).toBe(true);
    expect(containsIdentifiers("Call 6284576381 back", ids)).toBe(true);
    expect(containsIdentifiers("mail me at a@b.com", ids)).toBe(true);
    expect(containsIdentifiers("Ask for a pain score before offering a visit", ids)).toBe(false);
  });
  it("similarity is script-agnostic and symmetric", () => {
    expect(similarity("Prefers calls after 6 pm", "prefers calls after 6 PM.")).toBe(1);
    expect(similarity("knee pain", "allergic to penicillin")).toBe(0);
  });
});

describe("validateExtraction", () => {
  const ctx = {
    patientText: "I get pain in my knee when I climb stairs. Please call me after six in the evening.",
    fullText: "I get pain in my knee when I climb stairs. Please call me after six in the evening.\nWhat is your pain score from one to ten",
    identifiers: { names: ["Riva Sharma"], phones: ["+918968828606"] },
  };
  const raw = (o: unknown) => "```json\n" + JSON.stringify(o) + "\n```";

  it("keeps grounded facts and lessons, drops ungrounded, low-confidence and identity-leaking ones", () => {
    const { extraction, rejected } = validateExtraction(
      raw({
        patientFacts: [
          { key: "Knee Pain", category: "health_status", text: "Knee pain on stairs", confidence: 0.9, evidence: "pain in my knee when I climb stairs" },
          { key: "invented", category: "medication", text: "Takes insulin", confidence: 0.9, evidence: "I take insulin daily" },
          { key: "vague", category: "concern", text: "Maybe anxious", confidence: 0.2, evidence: "knee when I climb" },
          { key: "agent_said", category: "health_status", text: "Pain score asked", confidence: 0.9, evidence: "What is your pain score from one to ten" }, // AGENT line, not patient
        ],
        lessons: [
          { category: "approach", text: "Ask for a pain score early", confidence: 0.8, evidence: "What is your pain score from one to ten", general: false },
          { category: "approach", text: "Riva prefers evening calls", confidence: 0.8, evidence: "call me after six", general: true },
        ],
        resolvedKeys: ["Old Key"],
      }),
      ctx,
    );
    expect(extraction.patientFacts.map((f) => f.key)).toEqual(["knee_pain"]);
    expect(extraction.lessons.map((l) => l.text)).toEqual(["Ask for a pain score early"]);
    expect(extraction.resolvedKeys).toEqual(["old_key"]);
    expect(rejected.length).toBe(4);
  });
  it("survives junk output", () => {
    expect(validateExtraction("sorry, I cannot", ctx).extraction.patientFacts).toEqual([]);
    expect(validateExtraction("{}", ctx).extraction.lessons).toEqual([]);
  });
});

describe("applyExtraction: patient facts", () => {
  it("adds, reinforces, updates and retires facts; ignores the same call twice", async () => {
    const store = createMemoryLearningStore();
    const base = { store, clientId: CLIENT, patientId: "p1", agentId: "a1" };
    await applyExtraction({ ...base, callId: "c1", extraction: ex({ patientFacts: [fact("call_time", "Prefers calls after 6 pm", "contact_preference"), fact("knee_pain", "Knee pain, 7 out of 10")] }) });
    expect(store.rows).toHaveLength(2);

    // same call replayed → no change
    await applyExtraction({ ...base, callId: "c1", extraction: ex({ patientFacts: [fact("call_time", "Prefers calls after 6 pm", "contact_preference")] }) });
    expect(store.rows.find((r) => r.key === "call_time")!.supportCount).toBe(1);

    // next call: same preference (reinforced), pain changed (updated, newest wins)
    const r = await applyExtraction({ ...base, callId: "c2", extraction: ex({ patientFacts: [fact("call_time", "Prefers calls after 6 pm", "contact_preference"), fact("knee_pain", "Knee pain much better, 2 out of 10")] }) });
    expect(r.patient).toMatchObject({ reinforced: 1, updated: 1, added: 0 });
    expect(store.rows.find((x) => x.key === "call_time")!.supportCount).toBe(2);
    const knee = store.rows.find((x) => x.key === "knee_pain")!;
    expect(knee.text).toContain("much better");
    expect(knee.sourceCallIds).toEqual(["c1", "c2"]);

    // patient says pain is gone → retired
    await applyExtraction({ ...base, callId: "c3", extraction: ex({ resolvedKeys: ["knee_pain"] }) });
    expect((await store.listPatient(CLIENT, "p1")).map((x) => x.key)).toEqual(["call_time"]);
  });

  it("keeps patients separate and caps the number of facts", async () => {
    const store = createMemoryLearningStore();
    await applyExtraction({ store, clientId: CLIENT, patientId: "p1", callId: "c1", extraction: ex({ patientFacts: [fact("x", "fact for p1")] }) });
    await applyExtraction({ store, clientId: CLIENT, patientId: "p2", callId: "c2", extraction: ex({ patientFacts: [fact("x", "fact for p2")] }) });
    expect((await store.listPatient(CLIENT, "p1")).map((r) => r.text)).toEqual(["fact for p1"]);
    expect((await store.listPatient(CLIENT, "p2")).map((r) => r.text)).toEqual(["fact for p2"]);

    const many = Array.from({ length: LEARNING_LIMITS.maxPatientFacts + 5 }, (_, i) => fact(`k${i}`, `unique fact number ${i} alpha${i}`));
    await applyExtraction({ store, clientId: CLIENT, patientId: "p3", callId: "c3", extraction: ex({ patientFacts: many }) });
    expect((await store.listPatient(CLIENT, "p3")).length).toBe(LEARNING_LIMITS.maxPatientFacts);
  });
});

describe("applyExtraction: agent and global lessons", () => {
  it("a lesson is pending until two different calls support it", async () => {
    const store = createMemoryLearningStore();
    const base = { store, clientId: CLIENT, agentId: "a1" };
    await applyExtraction({ ...base, callId: "c1", extraction: ex({ lessons: [lesson("Ask for a pain score before offering a visit")] }) });
    expect(await store.listAgent(CLIENT, "a1")).toHaveLength(0); // pending, not applied
    const r = await applyExtraction({ ...base, callId: "c2", extraction: ex({ lessons: [lesson("ask for a pain score before offering a visit.")] }) });
    expect(r.lessons.promoted).toBe(1);
    expect(await store.listAgent(CLIENT, "a1")).toHaveLength(1);
    // the same call again does not double count
    await applyExtraction({ ...base, callId: "c2", extraction: ex({ lessons: [lesson("ask for a pain score before offering a visit.")] }) });
    expect(store.rows[0].supportCount).toBe(2);
  });

  it("the same lesson from two DIFFERENT agents becomes a global lesson for all agents", async () => {
    const store = createMemoryLearningStore();
    const L = "Confirm the callback number before ending the call";
    await applyExtraction({ store, clientId: CLIENT, agentId: "a1", callId: "c1", extraction: ex({ lessons: [lesson(L, false, "information")] }) });
    expect(await store.listGlobal(CLIENT)).toHaveLength(0);
    const r = await applyExtraction({ store, clientId: CLIENT, agentId: "a2", callId: "c2", extraction: ex({ lessons: [lesson(L, false, "information")] }) });
    expect(r.lessons.globalPromoted).toBe(1);
    const globals = await store.listGlobal(CLIENT);
    expect(globals).toHaveLength(1);
    expect(globals[0]).toMatchObject({ scope: "global", agentId: null, patientId: null, status: "active" });
    expect(globals[0].sourceCallIds.sort()).toEqual(["c1", "c2"]);
    // a third agent keeps reinforcing rather than duplicating
    await applyExtraction({ store, clientId: CLIENT, agentId: "a3", callId: "c3", extraction: ex({ lessons: [lesson(L, false, "information")] }) });
    expect(await store.listGlobal(CLIENT)).toHaveLength(1);
  });

  it("matches differently-worded lessons by meaning when an embedder is provided", async () => {
    const store = createMemoryLearningStore();
    // toy embedder: both phrasings map to nearly the same vector, the unrelated one does not
    const embed = async (t: string) => (/two|few|1 or 2|overwhelm/i.test(t) ? [1, 0.05, 0] : [0, 0, 1]);
    const A = "Limit appointment options to two choices";
    const B = "If the patient is overwhelmed by a long list, offer just a few specific slots";
    await applyExtraction({ store, embed, clientId: CLIENT, agentId: "a1", callId: "c1", extraction: ex({ lessons: [lesson(A, false, "scheduling")] }) });
    await applyExtraction({ store, embed, clientId: CLIENT, agentId: "a2", callId: "c2", extraction: ex({ lessons: [lesson(B, false, "scheduling")] }) });
    expect(await store.listGlobal(CLIENT)).toHaveLength(1);
    await applyExtraction({ store, embed, clientId: CLIENT, agentId: "a1", callId: "c3", extraction: ex({ lessons: [lesson("Confirm the callback number first", false, "information")] }) });
    expect(await store.listGlobal(CLIENT)).toHaveLength(1); // unrelated lesson did not merge
  });

  it("a different tenant never sees these", async () => {
    const store = createMemoryLearningStore();
    await applyExtraction({ store, clientId: CLIENT, agentId: "a1", patientId: "p1", callId: "c1", extraction: ex({ patientFacts: [fact("k", "secret fact")], lessons: [lesson("x lesson one")] }) });
    await applyExtraction({ store, clientId: CLIENT, agentId: "a2", callId: "c2", extraction: ex({ lessons: [lesson("x lesson one")] }) });
    expect(await store.listPatient("other", "p1")).toEqual([]);
    expect(await store.listGlobal("other")).toEqual([]);
    expect(await store.listGlobal(CLIENT)).toHaveLength(1);
  });
});

describe("buildLearningContext", () => {
  const now = 100 * DAY;
  const row = (o: Partial<import("../../lib/learning/types").Learning>) => ({ id: Math.random().toString(), clientId: CLIENT, scope: "patient" as const, agentId: null, patientId: "p1", category: "health_status", key: "k", text: "t", evidence: [], sourceCallIds: ["c"], supportCount: 1, confidence: 0.8, status: "active" as const, createdAt: now, updatedAt: now, ...o });
  it("returns nothing when there is nothing learned", () => {
    expect(buildLearningContext({ patient: [], agent: [], global: [] })).toBeUndefined();
  });
  it("puts open items first, dates facts, excludes pending/retired and dedupes global vs agent", () => {
    const text = buildLearningContext({
      now,
      patient: [row({ text: "Likes brief calls", category: "communication_style" }), row({ text: "Owes us a lab report", category: "open_item", updatedAt: now - 3 * DAY }), row({ text: "retired one", status: "retired" })],
      agent: [row({ scope: "agent", patientId: null, text: "Ask pain score first", supportCount: 3 })],
      global: [row({ scope: "global", patientId: null, text: "Ask pain score first" }), row({ scope: "global", patientId: null, text: "Offer two slots, not five" }), row({ scope: "global", patientId: null, text: "still pending", status: "pending" })],
    })!;
    expect(text.indexOf("Owes us a lab report")).toBeLessThan(text.indexOf("Likes brief calls"));
    expect(text).toContain("3 days ago");
    expect(text).not.toContain("retired one");
    expect(text).not.toContain("still pending");
    expect(text.match(/Ask pain score first/g)).toHaveLength(1);
    expect(text).toContain("Offer two slots, not five");
  });
});

describe("learnFromCall (full flow with fake transcript + model)", () => {
  const store = createMemoryLearningStore();
  const transcripts: Record<string, { role: "user" | "agent"; text: string }[]> = {
    s1: [
      { role: "agent", text: "How has your recovery been?" },
      { role: "user", text: "My knee hurts when I climb stairs. Please call me after six in the evening." },
      { role: "agent", text: "I'm sorry to hear that. What is your pain score?" },
    ],
    s2: [{ role: "agent", text: "Hello again" }, { role: "user", text: "The knee is much better now, thank you." }],
    s3: [{ role: "agent", text: "Hello" }],
  };
  const replies: Record<string, unknown> = {
    s1: {
      patientFacts: [
        { key: "knee_pain", category: "health_status", text: "Knee pain when climbing stairs", confidence: 0.9, evidence: "My knee hurts when I climb stairs" },
        { key: "call_time", category: "contact_preference", text: "Prefers calls after 6 pm", confidence: 0.9, evidence: "call me after six in the evening" },
      ],
      lessons: [{ category: "approach", text: "Ask for a pain score when a patient reports pain", confidence: 0.8, evidence: "What is your pain score", general: false }],
    },
    s2: { patientFacts: [{ key: "knee_pain", category: "health_status", text: "Knee pain much better", confidence: 0.9, evidence: "The knee is much better now" }], lessons: [] },
  };
  const deps: LearnDeps = {
    store,
    loadTranscript: async (id) => transcripts[id] ?? [],
    extract: async ({ turns }) => JSON.stringify(replies[turns[1]?.text.includes("much better") ? "s2" : "s1"]),
    resolveIdentity: async ({ clientId }) => ({ clientId, agentName: "Aarti", names: ["Riva Sharma"], phones: [] }),
  };
  beforeEach(() => invalidateLearningContext());

  it("skips calls where the patient never spoke", async () => {
    const out = await learnFromCall({ sessionId: "s3", clientId: CLIENT, agentId: "a1", patientId: "p1" }, deps);
    expect(out).toMatchObject({ status: "skipped", reason: "patient never spoke" });
    expect(store.rows).toHaveLength(0);
  });

  it("call 1 teaches; the NEXT call's context contains it; call 2 updates it", async () => {
    const out1 = await learnFromCall({ sessionId: "s1", clientId: CLIENT, agentId: "a1", patientId: "p1" }, deps);
    expect(out1.status).toBe("learned");

    // What an agent about to call this patient (even a different agent) would see:
    const ctxOtherAgent = await getLearningContext({ clientId: CLIENT, agentId: "a2", patientId: "p1" }, store);
    expect(ctxOtherAgent).toContain("Knee pain when climbing stairs");
    expect(ctxOtherAgent).toContain("Prefers calls after 6 pm");
    expect(ctxOtherAgent).not.toContain("pain score"); // lesson still pending (1 call)

    // another patient sees none of it
    expect(await getLearningContext({ clientId: CLIENT, agentId: "a2", patientId: "p2" }, store)).toBeUndefined();

    await learnFromCall({ sessionId: "s2", clientId: CLIENT, agentId: "a1", patientId: "p1" }, deps);
    invalidateLearningContext();
    const ctxAfter = await getLearningContext({ clientId: CLIENT, agentId: "a1", patientId: "p1" }, store);
    expect(ctxAfter).toContain("Knee pain much better");
    expect(ctxAfter).not.toContain("when climbing stairs");
  });

  it("survives a model that returns garbage and never throws", async () => {
    const bad: LearnDeps = { ...deps, extract: async () => "I am not JSON" };
    const out = await learnFromCall({ sessionId: "s1", callId: "other-call", clientId: CLIENT, agentId: "a1", patientId: "p9" }, bad);
    expect(out.status).toBe("learned");
    expect(await store.listPatient(CLIENT, "p9")).toEqual([]);
    const boom: LearnDeps = { ...deps, extract: async () => { throw new Error("llm down"); } };
    expect((await learnFromCall({ sessionId: "s1", clientId: CLIENT, patientId: "p9" }, boom)).status).toBe("skipped");
  });
});
