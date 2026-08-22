import { supabase } from "../db/supabase";
import { generateReply } from "./llm";

export interface CallSummary {
  sentimentTrajectory: string;
  flaggedConcerns: string[];
  recommendedAction: string;
}

const SUMMARY_SYSTEM_PROMPT =
  "You are reviewing the transcript of a completed check-in phone call for a clinician to read afterward. " +
  "Summarize ONLY what is actually in the transcript below — never infer or invent a symptom, event, or " +
  "detail that wasn't actually said. Respond with ONLY a JSON object, no other text, in exactly this shape: " +
  '{"sentimentTrajectory": "<one sentence on how the caller\'s mood moved through the call, e.g. \'started ' +
  "flat, warmed up once reassured about recovery timeline'\", \"flaggedConcerns\": [\"<any red-flag symptom " +
  "or concerning statement actually mentioned, verbatim-grounded — empty array if none>\"], " +
  '"recommendedAction": "<one plain-language recommendation, e.g. \'routine follow-up at next scheduled ' +
  "visit' or 'clinician should call back today — reported symptom matches a documented red flag'\"}";

function parseSummary(raw: string): CallSummary | null {
  try {
    // Model output occasionally wraps JSON in a code fence despite the
    // "ONLY a JSON object" instruction — strip that defensively rather than
    // fail the whole summary over a formatting quirk.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (
      typeof parsed.sentimentTrajectory === "string" &&
      Array.isArray(parsed.flaggedConcerns) &&
      typeof parsed.recommendedAction === "string"
    ) {
      return {
        sentimentTrajectory: parsed.sentimentTrajectory,
        flaggedConcerns: parsed.flaggedConcerns.filter((c: unknown) => typeof c === "string"),
        recommendedAction: parsed.recommendedAction,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generates a post-call summary for a doctor/clinician to review — how the
 * caller's mood moved through the call, any red-flag symptoms or concerning
 * statements actually mentioned (grounded in the real transcript, same
 * "never invent" discipline the live agent follows), and a plain-language
 * recommended action. Runs after the call has already ended (see
 * app/api/telephony/status/route.ts's trigger point) — structurally
 * decoupled from any live turn, so it cannot add latency to an in-progress
 * call by construction.
 */
export async function generateCallSummary(sessionId: string, clientId: string): Promise<CallSummary | null> {
  const { data: rows, error } = await supabase
    .from("session_logs")
    .select("payload")
    .eq("sessionId", sessionId)
    .eq("type", "utterance")
    .order("ts", { ascending: true });

  if (error || !rows || rows.length === 0) {
    console.warn(`[CallSummary] No transcript found for session ${sessionId}`);
    return null;
  }

  const transcript = rows
    .map((r) => r.payload as { role?: string; text?: string })
    .filter((p) => p.role && p.text)
    .map((p) => `${p.role === "user" ? "PATIENT" : "AGENT"}: ${p.text}`)
    .join("\n");

  if (!transcript.trim()) return null;

  try {
    const reply = await generateReply({
      system: SUMMARY_SYSTEM_PROMPT,
      user: transcript,
      clientId,
      useTools: false,
      maxOutputTokens: 400,
    });
    return parseSummary(reply.text);
  } catch (err) {
    console.error(`[CallSummary] generateReply failed for session ${sessionId}:`, err);
    return null;
  }
}
