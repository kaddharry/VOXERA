import { supabase } from "../db/supabase";
import { generateReply } from "../agent/llm";
import { isMissingColumnError } from "../db/follow-up-tasks";
import {
  INSIGHTS_SYSTEM_PROMPT,
  applyReview,
  buildTurns,
  findDeflections,
  findEmotionDrops,
  formatTranscript,
  type CallInsights,
} from "./call-insights";

/**
 * Finds a finished call's knowledge gaps and emotional failure points (see
 * call-insights.ts). Null when the call has no patient turns. A failed or
 * unusable review falls back to the rule-based findings, marked as not
 * reviewed — never throws for an LLM problem.
 */
export async function analyzeCall(sessionId: string, clientId: string): Promise<CallInsights | null> {
  const { data, error } = await supabase
    .from("session_logs")
    .select("type, payload")
    .eq("sessionId", sessionId)
    .in("type", ["utterance", "emotion"])
    .order("ts", { ascending: true })
    .order("id", { ascending: true });
  if (error || !data) {
    console.warn(`[CallInsights] Could not read session ${sessionId}:`, error?.message);
    return null;
  }

  const turns = buildTurns(data as Array<{ type: string; payload: Record<string, any> }>);
  if (turns.length === 0) return null;
  const drops = findEmotionDrops(turns);
  const fallback: CallInsights = { knowledgeGaps: findDeflections(turns), emotionalFailurePoints: drops };

  const candidates = drops.length
    ? drops.map((d) => `Turn ${d.turn}: patient went from ${d.before.label} to ${d.after.label} after the agent's reply`).join("\n")
    : "none";
  try {
    const reply = await generateReply({
      system: INSIGHTS_SYSTEM_PROMPT,
      user: `${formatTranscript(turns)}\n\nCandidate turns for failurePoints:\n${candidates}`,
      clientId,
      useTools: false,
      maxOutputTokens: 700,
    });
    return applyReview(reply.text, turns, drops) ?? fallback;
  } catch (err) {
    console.warn(`[CallInsights] Review failed for session ${sessionId}, using rule-based findings:`, err);
    return fallback;
  }
}

/**
 * Stores a call's findings: on the call itself (call_logs.summary.insights,
 * shown on Calls & Insights) and one row per finding in call_insights
 * (migration_v25.sql), where they're collected across calls. Re-running for
 * the same call replaces its rows. A missing call_insights table only skips
 * that second part.
 */
export async function saveCallInsights(opts: {
  callSid: string;
  sessionId: string;
  clientId: string;
  patientId?: string | null;
  agentId?: string | null;
  summary: Record<string, unknown>;
  insights: CallInsights;
}): Promise<void> {
  const { error: summaryError } = await supabase
    .from("call_logs")
    .update({ summary: { ...opts.summary, insights: opts.insights } })
    .eq("id", opts.callSid);
  if (summaryError) console.error(`[CallInsights] Failed to save insights on call ${opts.callSid}:`, summaryError.message);

  // Which agent handled the call (migration_v25's call_logs."agentId"),
  // read with select("*") so a database without that column still works.
  let agentId = opts.agentId ?? null;
  if (!agentId) {
    const { data } = await supabase.from("call_logs").select("*").eq("id", opts.callSid).maybeSingle();
    agentId = (data as { agentId?: string | null } | null)?.agentId ?? null;
  }

  const now = Date.now();
  const base = {
    clientId: opts.clientId,
    callSid: opts.callSid,
    sessionId: opts.sessionId,
    patientId: opts.patientId ?? null,
    agentId,
    status: "open",
    createdAt: now,
  };
  const rows = [
    ...opts.insights.knowledgeGaps.map((g) => ({
      ...base,
      id: `${opts.sessionId}:gap:${g.turn}`,
      kind: "knowledge_gap",
      turn: g.turn,
      topic: g.topic,
      patientText: g.question,
      agentText: g.agentReply,
      details: { reviewed: g.reviewed },
    })),
    ...opts.insights.emotionalFailurePoints.map((f) => ({
      ...base,
      id: `${opts.sessionId}:failure:${f.turn}`,
      kind: "emotional_failure",
      turn: f.turn,
      topic: null,
      patientText: f.patientBefore,
      agentText: f.agentReply,
      details: { patientAfter: f.patientAfter, before: f.before, after: f.after, whatWentWrong: f.whatWentWrong, reviewed: f.reviewed },
    })),
  ];

  const { error: clearError } = await supabase.from("call_insights").delete().eq("sessionId", opts.sessionId);
  if (clearError) {
    if (isMissingTable(clearError)) {
      console.warn("[CallInsights] call_insights table missing — run sql/migration_v25.sql to collect findings across calls.");
    } else {
      console.error("[CallInsights] Failed to clear previous findings:", clearError.message);
    }
    return;
  }
  if (rows.length === 0) return;
  const { error } = await supabase.from("call_insights").insert(rows);
  if (error) console.error(`[CallInsights] Failed to store findings for call ${opts.callSid}:`, error.message);
}

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(error.message ?? "") || isMissingColumnError(error);
}
