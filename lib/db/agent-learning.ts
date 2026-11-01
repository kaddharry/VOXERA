import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { generateReply } from "../agent/llm";
import { ingestDocument } from "../knowledge/ingest";
import { invalidateInlineKnowledgeBase } from "../knowledge/inline";
import { getAgentForTenant, listAgentsForTenant, updateAgent } from "./agents";
import {
  GUIDELINE_SYSTEM_PROMPT,
  addGuideline,
  buildKnowledgeSuggestions,
  formatFailuresForReview,
  knowledgeDocument,
  parseGuidelines,
  type InsightRow,
  type SuggestionDraft,
} from "../insights/suggestions";

/**
 * Database side of the self-learning pipeline (step 2): suggestions made
 * from collected call findings, accepting/dismissing them, and agent
 * versions (migration_v26.sql). Reads and writes go through the signed-in
 * user's client, so row-level security keeps every account to its own data.
 */

export interface SuggestionRow extends SuggestionDraft {
  id: string;
  clientId: string;
  status: "open" | "accepted" | "dismissed";
  resultVersion: number | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface AgentVersionRow {
  id: string;
  agentId: string;
  version: number;
  systemPrompt: string | null;
  changeSummary: string;
  suggestionId: string | null;
  createdAt: number;
}

/** Thrown when migration_v25/v26's tables aren't there yet; routes turn it into a clear message. */
export class LearningTablesMissingError extends Error {
  constructor() {
    super("Run sql/migration_v25.sql and sql/migration_v26.sql to turn on agent learning.");
  }
}

export class SuggestionError extends Error {}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(error.message ?? "");
}

function check<T>(result: { data: T; error: { code?: string; message?: string } | null }, what: string): T {
  if (isMissingTable(result.error)) throw new LearningTablesMissingError();
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

export async function loadInsights(db: SupabaseClient, clientId: string): Promise<InsightRow[]> {
  const data = check(
    await db.from("call_insights").select("*").eq("clientId", clientId).order("createdAt", { ascending: false }).limit(500),
    "Reading call findings",
  );
  return (data ?? []) as InsightRow[];
}

export async function listSuggestions(db: SupabaseClient, clientId: string): Promise<SuggestionRow[]> {
  const data = check(
    await db.from("agent_suggestions").select("*").eq("clientId", clientId).order("occurrences", { ascending: false }).order("createdAt", { ascending: false }),
    "Reading suggestions",
  );
  return (data ?? []) as SuggestionRow[];
}

export async function listVersions(db: SupabaseClient, clientId: string, agentId?: string): Promise<AgentVersionRow[]> {
  let query = db.from("agent_versions").select("*").eq("clientId", clientId);
  if (agentId) query = query.eq("agentId", agentId);
  const data = check(await query.order("version", { ascending: false }), "Reading agent versions");
  return (data ?? []) as AgentVersionRow[];
}

/** Guideline drafts for one agent from its open failure points; [] when there are none or the review fails. */
async function draftGuidelines(clientId: string, agentId: string, failures: InsightRow[], known: string[]): Promise<SuggestionDraft[]> {
  if (failures.length === 0) return [];
  const already = known.length ? `\n\nAlready suggested before (don't repeat these):\n${known.map((t) => `- ${t}`).join("\n")}` : "";
  try {
    const reply = await generateReply({
      system: GUIDELINE_SYSTEM_PROMPT,
      user: formatFailuresForReview(failures) + already,
      clientId,
      useTools: false,
      maxOutputTokens: 700,
    });
    return parseGuidelines(reply.text, agentId, failures) ?? [];
  } catch (err) {
    console.warn(`[AgentLearning] Guideline review failed for agent ${agentId}:`, err);
    return [];
  }
}

/**
 * Builds suggestions from the account's open findings and saves them. An
 * existing open suggestion for the same topic/guideline is refreshed (new
 * counts and questions) rather than duplicated; one the owner already
 * accepted or dismissed isn't proposed again.
 */
export async function generateSuggestions(db: SupabaseClient, clientId: string, tenantId: string | null): Promise<SuggestionRow[]> {
  const insights = (await loadInsights(db, clientId)).filter((r) => r.status === "open");
  const existing = await listSuggestions(db, clientId);

  const agentIds = new Set((tenantId ? await listAgentsForTenant(db, tenantId) : []).map((a) => a.id));
  const failuresByAgent = new Map<string, InsightRow[]>();
  for (const r of insights) {
    if (r.kind !== "emotional_failure" || !r.agentId || !agentIds.has(r.agentId)) continue;
    failuresByAgent.set(r.agentId, [...(failuresByAgent.get(r.agentId) ?? []), r]);
  }

  const drafts: SuggestionDraft[] = [...buildKnowledgeSuggestions(insights)];
  for (const [agentId, failures] of failuresByAgent) {
    const known = existing.filter((s) => s.kind === "prompt_change" && s.agentId === agentId).map((s) => s.title);
    drafts.push(...(await draftGuidelines(clientId, agentId, failures, known)));
  }

  const now = Date.now();
  for (const d of drafts) {
    const match = existing.find((s) => s.kind === d.kind && (s.agentId ?? null) === (d.agentId ?? null) && s.groupKey === d.groupKey);
    if (match && match.status !== "open") continue;
    if (match) {
      check(
        await db
          .from("agent_suggestions")
          .update({ title: d.title, explanation: d.explanation, proposal: d.proposal, evidence: d.evidence, occurrences: d.occurrences })
          .eq("id", match.id)
          .eq("status", "open"),
        "Updating a suggestion",
      );
    } else {
      check(
        await db.from("agent_suggestions").insert({ ...d, id: nanoid(12), clientId, status: "open", createdAt: now }),
        "Saving a suggestion",
      );
    }
  }
  return listSuggestions(db, clientId);
}

async function getSuggestion(db: SupabaseClient, clientId: string, id: string): Promise<SuggestionRow> {
  const data = check(await db.from("agent_suggestions").select("*").eq("id", id).eq("clientId", clientId).maybeSingle(), "Reading the suggestion");
  if (!data) throw new SuggestionError("Suggestion not found.");
  const s = data as SuggestionRow;
  if (s.status !== "open") throw new SuggestionError(`This suggestion was already ${s.status}.`);
  return s;
}

async function markFindings(db: SupabaseClient, clientId: string, s: SuggestionRow, status: "addressed" | "dismissed") {
  const ids = s.evidence.map((e) => e.insightId);
  if (ids.length) check(await db.from("call_insights").update({ status }).eq("clientId", clientId).in("id", ids), "Updating findings");
}

/** Records a new version of an agent's instructions; the first learned change also records the original as v1. */
async function recordVersion(
  db: SupabaseClient,
  clientId: string,
  agentId: string,
  previousPrompt: string | null,
  newPrompt: string | null,
  changeSummary: string,
  suggestionId: string | null,
): Promise<number> {
  const versions = await listVersions(db, clientId, agentId);
  const now = Date.now();
  let latest = versions[0]?.version ?? 0;
  if (latest === 0) {
    check(
      await db.from("agent_versions").insert({
        id: `${agentId}:v1`, clientId, agentId, version: 1, systemPrompt: previousPrompt,
        changeSummary: "Original instructions, before any learned change", suggestionId: null, createdAt: now - 1,
      }),
      "Saving the original version",
    );
    latest = 1;
  }
  const version = latest + 1;
  check(
    await db.from("agent_versions").insert({
      id: `${agentId}:v${version}`, clientId, agentId, version, systemPrompt: newPrompt, changeSummary, suggestionId, createdAt: now,
    }),
    "Saving the new version",
  );
  return version;
}

/**
 * Accepts a suggestion. add_knowledge needs the owner's `answer`, which is
 * added to the account's knowledge base. prompt_change adds the guideline
 * (or the owner's edited `guideline`) to the agent's instructions and
 * records a new agent version. The findings behind it are marked addressed.
 */
export async function acceptSuggestion(
  db: SupabaseClient,
  clientId: string,
  tenantId: string | null,
  id: string,
  input: { answer?: string; guideline?: string },
): Promise<{ suggestion: SuggestionRow; version?: number }> {
  const s = await getSuggestion(db, clientId, id);
  let resultVersion: number | null = null;

  if (s.kind === "add_knowledge") {
    const answer = input.answer?.trim();
    if (!answer) throw new SuggestionError("Write the hospital's answer before accepting.");
    const doc = knowledgeDocument(s.groupKey, s.proposal, answer);
    await ingestDocument({ clientId, filename: doc.filename, content: Buffer.from(doc.text, "utf-8"), mimeType: "text/markdown" });
    invalidateInlineKnowledgeBase(clientId);
  } else {
    if (!tenantId || !s.agentId) throw new SuggestionError("This suggestion isn't linked to one of your agents.");
    const agent = await getAgentForTenant(db, s.agentId, tenantId);
    if (!agent) throw new SuggestionError("The agent for this suggestion no longer exists.");
    const guideline = input.guideline?.trim() || s.proposal;
    const newPrompt = addGuideline(agent.system_prompt, guideline);
    if (!newPrompt) throw new SuggestionError("The agent's instructions would be too long. Shorten them in Agent Builder first.");
    const updated = await updateAgent(db, agent.id, tenantId, { system_prompt: newPrompt });
    if (!updated) throw new Error("Updating the agent failed.");
    resultVersion = await recordVersion(db, clientId, agent.id, agent.system_prompt, newPrompt, `Added: ${guideline}`, s.id);
  }

  const resolvedAt = Date.now();
  check(
    await db.from("agent_suggestions").update({ status: "accepted", resolvedAt, resultVersion }).eq("id", s.id).eq("status", "open"),
    "Saving the decision",
  );
  await markFindings(db, clientId, s, "addressed");
  return { suggestion: { ...s, status: "accepted", resolvedAt, resultVersion }, ...(resultVersion ? { version: resultVersion } : {}) };
}

export async function dismissSuggestion(db: SupabaseClient, clientId: string, id: string): Promise<SuggestionRow> {
  const s = await getSuggestion(db, clientId, id);
  const resolvedAt = Date.now();
  check(await db.from("agent_suggestions").update({ status: "dismissed", resolvedAt }).eq("id", s.id).eq("status", "open"), "Saving the decision");
  await markFindings(db, clientId, s, "dismissed");
  return { ...s, status: "dismissed", resolvedAt };
}

/** Puts an earlier version's instructions back, recorded as a new version so nothing is lost. */
export async function restoreVersion(
  db: SupabaseClient,
  clientId: string,
  tenantId: string,
  agentId: string,
  version: number,
): Promise<number> {
  const versions = await listVersions(db, clientId, agentId);
  const target = versions.find((v) => v.version === version);
  if (!target) throw new SuggestionError(`Version ${version} not found.`);
  const agent = await getAgentForTenant(db, agentId, tenantId);
  if (!agent) throw new SuggestionError("Agent not found.");
  const updated = await updateAgent(db, agentId, tenantId, { system_prompt: target.systemPrompt });
  if (!updated) throw new Error("Updating the agent failed.");
  return recordVersion(db, clientId, agentId, agent.system_prompt, target.systemPrompt, `Restored version ${version}`, null);
}
