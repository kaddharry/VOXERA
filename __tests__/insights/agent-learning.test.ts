import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../helpers/fake-supabase";

const agent = { id: "a1", tenant_id: "t1", name: "Maria", system_prompt: "You are Maria." as string | null };
vi.mock("../../lib/db/agents", () => ({
  listAgentsForTenant: vi.fn(async () => [agent]),
  getAgentForTenant: vi.fn(async (_db: unknown, id: string) => (id === agent.id ? { ...agent } : null)),
  updateAgent: vi.fn(async (_db: unknown, _id: string, _t: string, fields: { system_prompt: string | null }) => {
    agent.system_prompt = fields.system_prompt;
    return { ...agent };
  }),
}));
const ingestDocument = vi.fn(async (_args: { clientId: string; filename: string; content: Buffer; mimeType: string }) => ({ documentId: "d1" }));
vi.mock("../../lib/knowledge/ingest", () => ({ ingestDocument: (args: any) => ingestDocument(args) }));
vi.mock("../../lib/knowledge/inline", () => ({ invalidateInlineKnowledgeBase: vi.fn() }));
const generateReply = vi.fn();
vi.mock("../../lib/agent/llm", () => ({ generateReply: (...a: unknown[]) => generateReply(...a) }));

import { acceptSuggestion, dismissSuggestion, generateSuggestions, restoreVersion, SuggestionError } from "../../lib/db/agent-learning";

const insight = (id: string, session: string, kind: "knowledge_gap" | "emotional_failure", extra: Record<string, unknown> = {}) => ({
  id, clientId: "u1", sessionId: session, agentId: "a1", kind, topic: null, patientText: "", agentText: "", details: {}, status: "open", createdAt: 1, ...extra,
});

function seed() {
  return createFakeDb({
    call_insights: [
      insight("g1", "s1", "knowledge_gap", { topic: "bathing after surgery", patientText: "When can I take a bath?" }),
      insight("g2", "s2", "knowledge_gap", { topic: "bathing after surgery", patientText: "Can I shower?" }),
      insight("f1", "s1", "emotional_failure", { patientText: "I'm worried", agentText: "Anything else?", details: { whatWentWrong: "Ignored the worry" } }),
      insight("other", "s9", "knowledge_gap", { clientId: "someone-else", topic: "parking", patientText: "Where do I park?" }),
    ],
    agent_suggestions: [],
    agent_versions: [],
  });
}

const guidelineReply = {
  text: JSON.stringify({ guidelines: [{ title: "Acknowledge worries first", guideline: "Acknowledge a patient's worry before asking anything else.", ids: ["f1"] }] }),
};

describe("agent learning", () => {
  beforeEach(() => {
    agent.system_prompt = "You are Maria.";
    ingestDocument.mockClear();
    generateReply.mockReset().mockResolvedValue(guidelineReply);
  });

  it("builds knowledge and prompt suggestions from this account's open findings only, without duplicating on refresh", async () => {
    const db = seed();
    await generateSuggestions(db as any, "u1", "t1");
    const again = await generateSuggestions(db as any, "u1", "t1");
    expect(again.map((s) => [s.kind, s.groupKey, s.occurrences])).toEqual([
      ["add_knowledge", "bathing after surgery", 2],
      ["prompt_change", "acknowledge-worries-first", 1],
    ]);
    expect(db.tables.agent_suggestions).toHaveLength(2);
    // The second review is told what was already suggested.
    expect(generateReply.mock.calls[1][0].user).toContain("Already suggested before");
  });

  it("accepting a knowledge suggestion adds the owner's answer to the knowledge base and closes its findings", async () => {
    const db = seed();
    const [k] = await generateSuggestions(db as any, "u1", "t1");
    await expect(acceptSuggestion(db as any, "u1", "t1", k.id, {})).rejects.toBeInstanceOf(SuggestionError);

    await acceptSuggestion(db as any, "u1", "t1", k.id, { answer: "Showers after 48 hours, no baths for 2 weeks." });
    const doc = ingestDocument.mock.calls[0][0];
    expect(doc).toMatchObject({ clientId: "u1", filename: "learned-bathing-after-surgery.md", mimeType: "text/markdown" });
    expect(doc.content.toString()).toContain("Showers after 48 hours");
    expect(db.tables.agent_suggestions.find((s) => s.id === k.id)?.status).toBe("accepted");
    expect(db.tables.call_insights.filter((r) => r.id.startsWith("g")).map((r) => r.status)).toEqual(["addressed", "addressed"]);

    // Already decided: not proposed again, can't be accepted twice.
    await expect(acceptSuggestion(db as any, "u1", "t1", k.id, { answer: "x" })).rejects.toThrow("already accepted");
    const next = await generateSuggestions(db as any, "u1", "t1");
    expect(next.filter((s) => s.kind === "add_knowledge")).toHaveLength(1);
  });

  it("accepting a prompt suggestion updates the agent and records v1 (original) and v2, and a version can be restored", async () => {
    const db = seed();
    const suggestions = await generateSuggestions(db as any, "u1", "t1");
    const p = suggestions.find((s) => s.kind === "prompt_change")!;

    const result = await acceptSuggestion(db as any, "u1", "t1", p.id, { guideline: "Acknowledge the worry first, in one sentence." });
    expect(result.version).toBe(2);
    expect(agent.system_prompt).toBe("You are Maria.\n\n## Learned from calls\n- Acknowledge the worry first, in one sentence.");
    expect(db.tables.agent_versions.map((v) => [v.version, v.systemPrompt, v.changeSummary])).toEqual([
      [1, "You are Maria.", "Original instructions, before any learned change"],
      [2, agent.system_prompt, "Added: Acknowledge the worry first, in one sentence."],
    ]);
    expect(db.tables.agent_suggestions.find((s) => s.id === p.id)).toMatchObject({ status: "accepted", resultVersion: 2 });

    const restored = await restoreVersion(db as any, "u1", "t1", "a1", 1);
    expect(restored).toBe(3);
    expect(agent.system_prompt).toBe("You are Maria.");
    expect(db.tables.agent_versions.at(-1)).toMatchObject({ version: 3, changeSummary: "Restored version 1" });
  });

  it("dismissing closes the suggestion and its findings without changing anything else", async () => {
    const db = seed();
    const [k] = await generateSuggestions(db as any, "u1", "t1");
    await dismissSuggestion(db as any, "u1", k.id);
    expect(db.tables.agent_suggestions.find((s) => s.id === k.id)?.status).toBe("dismissed");
    expect(db.tables.call_insights.find((r) => r.id === "g1")?.status).toBe("dismissed");
    expect(ingestDocument).not.toHaveBeenCalled();
    expect(agent.system_prompt).toBe("You are Maria.");
  });

  it("makes knowledge suggestions even when the guideline review fails", async () => {
    generateReply.mockRejectedValue(new Error("providers down"));
    const suggestions = await generateSuggestions(seed() as any, "u1", "t1");
    expect(suggestions.map((s) => s.kind)).toEqual(["add_knowledge"]);
  });
});
