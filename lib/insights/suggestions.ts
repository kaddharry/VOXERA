/**
 * Self-learning pipeline, step 2: turn findings collected across calls
 * (call_insights, see analyze-call.ts) into suggestions the hospital can
 * accept or dismiss (migration_v26.sql).
 *
 *  - add_knowledge: a knowledge gap (a topic patients asked about that the
 *    agent couldn't answer). The suggestion lists the questions; the owner
 *    writes the answer on accept — the system never drafts medical answers
 *    itself.
 *  - prompt_change: a guideline for the agent's instructions, drawn from
 *    its emotional failure points by an LLM, each tied to the findings
 *    that justify it. Accepting it creates a new agent version.
 *
 * Pure functions here; the database side is lib/db/agent-learning.ts.
 */

export interface InsightRow {
  id: string;
  sessionId: string;
  agentId: string | null;
  kind: "knowledge_gap" | "emotional_failure";
  topic: string | null;
  patientText: string | null;
  agentText: string | null;
  details: Record<string, any>;
  status: "open" | "dismissed" | "addressed";
  createdAt: number;
}

export interface SuggestionDraft {
  kind: "add_knowledge" | "prompt_change";
  agentId: string | null;
  groupKey: string;
  title: string;
  explanation: string;
  proposal: string;
  evidence: Array<{ insightId: string; quote: string }>;
  occurrences: number;
}

export const MAX_PROMPT_LENGTH = 6000;
export const LEARNED_SECTION_HEADER = "## Learned from calls";

function normaliseTopic(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Knowledge gaps grouped by topic (or by the question itself when no topic
 * was given), most-asked first. Counts distinct calls, so one patient
 * asking twice in one call counts once.
 */
export function groupKnowledgeGaps(rows: InsightRow[]): Array<{ key: string; topic: string; calls: number; questions: string[]; insightIds: string[] }> {
  const groups = new Map<string, { key: string; topic: string; sessions: Set<string>; questions: string[]; insightIds: string[] }>();
  for (const r of rows) {
    if (r.kind !== "knowledge_gap" || !r.patientText) continue;
    const label = r.topic?.trim() || r.patientText.trim();
    const key = normaliseTopic(label);
    if (!key) continue;
    const g = groups.get(key) ?? { key, topic: label, sessions: new Set<string>(), questions: [], insightIds: [] };
    g.sessions.add(r.sessionId);
    if (!g.questions.some((q) => normaliseTopic(q) === normaliseTopic(r.patientText!))) g.questions.push(r.patientText.trim());
    g.insightIds.push(r.id);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ sessions, ...g }) => ({ ...g, calls: sessions.size }))
    .sort((a, b) => b.calls - a.calls || a.topic.localeCompare(b.topic));
}

export function buildKnowledgeSuggestions(rows: InsightRow[]): SuggestionDraft[] {
  return groupKnowledgeGaps(rows.filter((r) => r.status === "open")).map((g) => ({
    kind: "add_knowledge",
    agentId: null,
    groupKey: g.key,
    title: `Add an answer about ${g.topic}`,
    explanation: `Patients asked about ${g.topic} in ${plural(g.calls, "call")} and the agent couldn't answer. Write the hospital's answer once and the agent will use it from the next call on.`,
    proposal: g.questions.map((q) => `- ${q}`).join("\n"),
    evidence: g.insightIds.map((id, i) => ({ insightId: id, quote: g.questions[Math.min(i, g.questions.length - 1)] })),
    occurrences: g.calls,
  }));
}

export const GUIDELINE_SYSTEM_PROMPT =
  "You help a hospital improve its AI phone agent. Below are moments from real calls where the patient became more upset " +
  "right after the agent's reply, each with an id and what went wrong. Find the recurring mistakes and write at most 3 " +
  "guidelines that would prevent them. Respond with ONLY a JSON object: " +
  '{"guidelines": [{"title": "<short title>", "guideline": "<one or two plain sentences to add to the agent\'s instructions, ' +
  'telling it what to do instead>", "ids": ["<ids of the moments this guideline addresses>"]}]}. ' +
  "Each guideline must address at least one listed moment and say how the agent should behave, not what medical advice to give. " +
  "Never invent symptoms, policies or facts. Empty array if there is no clear pattern.";

export function formatFailuresForReview(rows: InsightRow[]): string {
  return rows
    .filter((r) => r.kind === "emotional_failure")
    .map((r) =>
      [
        `id: ${r.id}`,
        `Patient: ${r.patientText ?? ""}`,
        `Agent: ${r.agentText ?? ""}`,
        `Patient then (${r.details?.after?.label ?? "?"}): ${r.details?.patientAfter ?? ""}`,
        `What went wrong: ${r.details?.whatWentWrong ?? ""}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function slug(s: string): string {
  return normaliseTopic(s).replace(/\s+/g, "-").slice(0, 60);
}

/** Prompt-change suggestions from the reviewer's JSON; guidelines not tied to a real failure point are dropped. */
export function parseGuidelines(raw: string, agentId: string, failures: InsightRow[]): SuggestionDraft[] | null {
  let parsed: any;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim());
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.guidelines)) return null;
  const byId = new Map(failures.map((f) => [f.id, f]));
  const drafts: SuggestionDraft[] = [];
  for (const g of parsed.guidelines.slice(0, 3)) {
    if (typeof g?.title !== "string" || typeof g.guideline !== "string" || !Array.isArray(g.ids)) continue;
    const backing = (g.ids as unknown[]).map((id) => byId.get(String(id))).filter((f): f is InsightRow => !!f);
    if (backing.length === 0 || !g.guideline.trim() || !g.title.trim()) continue;
    const calls = new Set(backing.map((f) => f.sessionId)).size;
    drafts.push({
      kind: "prompt_change",
      agentId,
      groupKey: slug(g.title),
      title: g.title.trim(),
      explanation: `Seen in ${plural(backing.length, "moment")} across ${plural(calls, "call")} where the patient got more upset right after the agent's reply.`,
      proposal: g.guideline.trim(),
      evidence: backing.map((f) => ({ insightId: f.id, quote: String(f.details?.whatWentWrong ?? f.agentText ?? "") })),
      occurrences: backing.length,
    });
  }
  return drafts;
}

/**
 * The agent's instructions with a learned guideline added, under one
 * "Learned from calls" section at the end so the owner's own text stays
 * untouched and all learned rules sit together. Null when it would make
 * the instructions longer than the agent editor allows.
 */
export function addGuideline(systemPrompt: string | null, guideline: string): string | null {
  const base = (systemPrompt ?? "").trimEnd();
  const line = `- ${guideline.trim()}`;
  const next = base.includes(LEARNED_SECTION_HEADER) ? `${base}\n${line}` : `${base}${base ? "\n\n" : ""}${LEARNED_SECTION_HEADER}\n${line}`;
  return next.length > MAX_PROMPT_LENGTH ? null : next;
}

/** The knowledge-base document an accepted add_knowledge suggestion becomes. */
export function knowledgeDocument(topic: string, questions: string, answer: string): { filename: string; text: string } {
  return {
    filename: `learned-${slug(topic) || "answer"}.md`,
    text: `# ${topic}\n\nPatients have asked:\n${questions}\n\nAnswer from the hospital:\n${answer.trim()}\n`,
  };
}
