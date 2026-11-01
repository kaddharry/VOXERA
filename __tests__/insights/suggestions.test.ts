import { describe, expect, it } from "vitest";
import {
  LEARNED_SECTION_HEADER,
  addGuideline,
  buildKnowledgeSuggestions,
  groupKnowledgeGaps,
  knowledgeDocument,
  parseGuidelines,
  type InsightRow,
} from "../../lib/insights/suggestions";

const gap = (id: string, session: string, question: string, topic: string | null, status: InsightRow["status"] = "open"): InsightRow => ({
  id, sessionId: session, agentId: "a1", kind: "knowledge_gap", topic, patientText: question, agentText: "I don't have that information.", details: {}, status, createdAt: 1,
});
const failure = (id: string, session: string, wrong: string): InsightRow => ({
  id, sessionId: session, agentId: "a1", kind: "emotional_failure", topic: null, patientText: "I'm worried about the surgery",
  agentText: "Anything else?", details: { patientAfter: "You're not listening!", after: { label: "frustration" }, whatWentWrong: wrong }, status: "open", createdAt: 1,
});

describe("groupKnowledgeGaps", () => {
  it("groups by topic, counts distinct calls and keeps each distinct question once", () => {
    const groups = groupKnowledgeGaps([
      gap("1", "s1", "When can I take a bath?", "Bathing after surgery"),
      gap("2", "s2", "Can I shower yet?", "bathing after surgery"),
      gap("3", "s2", "When can I take a bath?", "bathing after surgery"),
      gap("4", "s3", "Can I drive next week?", "driving"),
      gap("5", "s4", "What are visiting hours?", null),
    ]);
    expect(groups.map((g) => [g.topic, g.calls, g.questions.length])).toEqual([
      ["Bathing after surgery", 2, 2],
      ["driving", 1, 1],
      ["What are visiting hours?", 1, 1],
    ]);
    expect(groups[0].insightIds).toEqual(["1", "2", "3"]);
  });
});

describe("buildKnowledgeSuggestions", () => {
  it("makes one suggestion per open topic, listing the questions and never drafting an answer", () => {
    const [s, ...rest] = buildKnowledgeSuggestions([
      gap("1", "s1", "When can I take a bath?", "bathing after surgery"),
      gap("2", "s2", "Can I shower yet?", "bathing after surgery"),
      gap("3", "s3", "Old question", "old topic", "addressed"),
    ]);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ kind: "add_knowledge", agentId: null, groupKey: "bathing after surgery", occurrences: 2 });
    expect(s.title).toBe("Add an answer about bathing after surgery");
    expect(s.explanation).toContain("in 2 calls");
    expect(s.proposal).toBe("- When can I take a bath?\n- Can I shower yet?");
  });
});

describe("parseGuidelines", () => {
  const failures = [failure("f1", "s1", "Ignored the worry"), failure("f2", "s2", "Moved on without acknowledging")];

  it("keeps guidelines tied to real failure points, with their evidence", () => {
    const drafts = parseGuidelines(
      JSON.stringify({
        guidelines: [
          { title: "Acknowledge worries first", guideline: "When a patient says they're worried, acknowledge it before asking anything else.", ids: ["f1", "f2"] },
          { title: "Made up", guideline: "Something", ids: ["nope"] },
        ],
      }),
      "a1",
      failures,
    )!;
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: "prompt_change", agentId: "a1", groupKey: "acknowledge-worries-first", occurrences: 2 });
    expect(drafts[0].explanation).toBe("Seen in 2 moments across 2 calls where the patient got more upset right after the agent's reply.");
    expect(drafts[0].evidence.map((e) => e.insightId)).toEqual(["f1", "f2"]);
  });

  it("returns null for an unusable reply", () => {
    expect(parseGuidelines("Thanks for letting me know.", "a1", failures)).toBeNull();
  });
});

describe("addGuideline", () => {
  it("adds learned guidelines under one section at the end, leaving the owner's text alone", () => {
    const once = addGuideline("You are Maria, a hospital assistant.", "Acknowledge worries first.")!;
    expect(once).toBe(`You are Maria, a hospital assistant.\n\n${LEARNED_SECTION_HEADER}\n- Acknowledge worries first.`);
    const twice = addGuideline(once, "Don't repeat a question the patient already answered.")!;
    expect(twice.split(LEARNED_SECTION_HEADER)).toHaveLength(2);
    expect(twice.endsWith("- Acknowledge worries first.\n- Don't repeat a question the patient already answered.")).toBe(true);
    expect(addGuideline(null, "Be kind.")).toBe(`${LEARNED_SECTION_HEADER}\n- Be kind.`);
  });

  it("refuses to make the instructions longer than the agent editor allows", () => {
    expect(addGuideline("x".repeat(5990), "A guideline that pushes it over the limit.")).toBeNull();
  });
});

describe("knowledgeDocument", () => {
  it("files the owner's answer with the questions it answers", () => {
    const doc = knowledgeDocument("bathing after surgery", "- When can I take a bath?", "  Showers are fine after 48 hours; no baths for 2 weeks. ");
    expect(doc.filename).toBe("learned-bathing-after-surgery.md");
    expect(doc.text).toBe("# bathing after surgery\n\nPatients have asked:\n- When can I take a bath?\n\nAnswer from the hospital:\nShowers are fine after 48 hours; no baths for 2 weeks.\n");
  });
});
