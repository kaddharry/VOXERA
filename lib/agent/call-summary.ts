import { supabase } from "../db/supabase";
import { generateReply } from "./llm";
import { summarizeCallEmotion, type CallEmotion, type TurnEmotion } from "../emotion/call-emotion";

export interface CallSummary {
  sentimentTrajectory: string;
  flaggedConcerns: string[];
  recommendedAction: string;
  /** Only meaningful for a scheduled follow-up call (lib/scheduler
   * /dispatcher.ts's handleFollowUpCallOutcome reads this) — whether THIS
   * call actually accomplished the follow-up, independent of whether it
   * connected/ended cleanly. "resolved" means the patient's status was
   * confirmed and no further attempt is needed; "needs_retry" means the
   * conversation was cut short or inconclusive and should be attempted
   * again; "needs_review" is the conservative default when the transcript
   * doesn't clearly support either — spec §8.2 explicitly warns against
   * treating "the call connected" as equivalent to "follow-up completed". */
  followUpOutcome: "resolved" | "needs_retry" | "needs_review";
  /** spec §17.4 — true only when the PATIENT explicitly asked to stop being
   * called/contacted (e.g. "please don't call me anymore", "take me off
   * your list"), not merely a request to reschedule or call back later.
   * app/api/telephony/status/route.ts sets patients.doNotContact and
   * cancels remaining follow-ups when this is true — grounded strictly in
   * what was actually said, same discipline as flaggedConcerns. */
  requestedDoNotContact: boolean;
  /** How the patient felt over the whole call, computed from the per-turn
   * emotion readings (lib/emotion/call-emotion.ts) — absent when no turn
   * had an emotion reading. */
  callEmotion?: CallEmotion;
  /** BUG-E17: deterministic safety signals from the emotion engine itself
   * (policy escalations, sustained/increasing distress) — built by
   * buildAutomatedSafetySignals(), independent of the LLM's own read of the
   * transcript. Always populated when the underlying data says so, even if
   * the LLM's `flaggedConcerns` missed it. Empty array, never omitted, so a
   * reader can tell "checked, nothing found" from "wasn't checked". */
  automatedSafetySignals: string[];
}

const SUMMARY_SYSTEM_PROMPT =
  "You are reviewing the transcript of a completed check-in phone call for a clinician to read afterward. " +
  "Summarize ONLY what is actually in the transcript below — never infer or invent a symptom, event, or " +
  "detail that wasn't actually said. The transcript may be followed by an AUTOMATED SIGNALS section — " +
  "deterministic output from the call's emotion-detection engine (not written by you), listing things it " +
  "flagged during the live call. Treat it as a hint about where to look in the transcript, not as ground " +
  "truth on its own: if it names a signal you can't actually find grounds for in the transcript text, don't " +
  "invent a quote to match it, but a recommendedAction/followUpOutcome that contradicts a real automated " +
  "escalation without explaining why from the transcript is a mistake. Respond with ONLY a JSON object, no other text, in exactly this shape: " +
  '{"sentimentTrajectory": "<one sentence on how the caller\'s mood moved through the call, e.g. \'started ' +
  "flat, warmed up once reassured about recovery timeline'\", \"flaggedConcerns\": [\"<any red-flag symptom " +
  "or concerning statement actually mentioned, verbatim-grounded — empty array if none>\"], " +
  '"recommendedAction": "<one plain-language recommendation, e.g. \'routine follow-up at next scheduled ' +
  "visit' or 'clinician should call back today — reported symptom matches a documented red flag'\", " +
  '"followUpOutcome": "<one of exactly these three strings: \'resolved\' if the patient\'s status was ' +
  "clearly confirmed and nothing further is needed; 'needs_retry' if the call was cut short, the patient " +
  "asked to be called back, or the conversation was otherwise inconclusive; 'needs_review' if you cannot " +
  'confidently tell which of those two it is from the transcript alone>", ' +
  '"requestedDoNotContact": <true ONLY if the patient explicitly asked to stop being called/contacted ' +
  "altogether (e.g. 'stop calling me', 'take me off your list', 'don't contact me again') — NOT true for an " +
  'ordinary "call me back later" or a single hang-up, false otherwise>}';

type LlmSummary = Omit<CallSummary, "automatedSafetySignals" | "callEmotion">;

function parseSummary(raw: string): LlmSummary | null {
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
      const outcome = parsed.followUpOutcome;
      return {
        sentimentTrajectory: parsed.sentimentTrajectory,
        flaggedConcerns: parsed.flaggedConcerns.filter((c: unknown) => typeof c === "string"),
        recommendedAction: parsed.recommendedAction,
        followUpOutcome: outcome === "resolved" || outcome === "needs_retry" ? outcome : "needs_review",
        requestedDoNotContact: parsed.requestedDoNotContact === true,
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

  // BUG-E17: fetched and merged in unconditionally below, independent of
  // what the LLM does or doesn't mention — see buildAutomatedSafetySignals's
  // own doc comment for why.
  const automatedSafetySignals = await loadAutomatedSafetySignals(sessionId).catch((err) => {
    console.warn(`[CallSummary] Failed to load automated safety signals for ${sessionId}:`, err);
    return [] as string[];
  });
  const userPrompt =
    automatedSafetySignals.length > 0
      ? `${transcript}\n\nAUTOMATED SIGNALS (from the emotion-detection engine, not written by you):\n${automatedSafetySignals.map((s) => `- ${s}`).join("\n")}`
      : transcript;

  try {
    const reply = await generateReply({
      system: SUMMARY_SYSTEM_PROMPT,
      user: userPrompt,
      clientId,
      useTools: false,
      maxOutputTokens: 400,
    });
    const llmSummary = parseSummary(reply.text);
    if (!llmSummary) return null;
    const callEmotion = await loadCallEmotion(sessionId).catch(() => null);
    return {
      ...llmSummary,
      automatedSafetySignals,
      ...(callEmotion ? { callEmotion } : {}),
    };
  } catch (err) {
    console.error(`[CallSummary] generateReply failed for session ${sessionId}:`, err);
    return null;
  }
}

/**
 * BUG-E17: generateCallSummary() previously sent only the raw transcript to
 * the LLM — the clinician-facing "Flagged Concerns" list depended entirely
 * on the LLM re-reading the transcript correctly, with no cross-check
 * against the emotion engine's own (deterministic, now far more reliable
 * post-audit) signals. A real policy escalation or sustained-distress
 * reading could happen during the live call and still never make it into
 * the post-call summary if the LLM's free-text pass missed it. This
 * function is pure and deterministic — independent of the LLM — so its
 * output can be merged into the final summary unconditionally rather than
 * hoping the model mentions it.
 */
export function buildAutomatedSafetySignals(
  escalationRows: Array<{ payload: Record<string, unknown> }>,
  emotionRows: Array<{ payload: Record<string, unknown> }>
): string[] {
  const signals: string[] = [];
  const seenReasons = new Set<string>();

  for (const row of escalationRows) {
    const reason = row.payload.reason;
    if (typeof reason === "string" && reason.trim() && !seenReasons.has(reason)) {
      seenReasons.add(reason);
      signals.push(`Automated policy escalation triggered: ${reason}`);
    }
  }

  const hadIncreasingDistress = emotionRows.some((row) => {
    const flags = row.payload.flags as Record<string, unknown> | undefined;
    return flags?.increasing_distress === true;
  });
  if (hadIncreasingDistress) {
    signals.push(
      "The emotion-detection engine flagged sustained/increasing distress at one or more points during this call."
    );
  }

  return signals;
}

async function loadAutomatedSafetySignals(sessionId: string): Promise<string[]> {
  const [{ data: escalationRows }, { data: emotionRows }] = await Promise.all([
    supabase.from("session_logs").select("payload").eq("sessionId", sessionId).eq("type", "escalation"),
    supabase.from("session_logs").select("payload").eq("sessionId", sessionId).eq("type", "emotion"),
  ]);
  return buildAutomatedSafetySignals(
    (escalationRows as Array<{ payload: Record<string, unknown> }>) ?? [],
    (emotionRows as Array<{ payload: Record<string, unknown> }>) ?? []
  );
}

/** The call-level emotion from the session's per-turn emotion events. A
 * failed read just leaves it out — the summary itself still stands. */
async function loadCallEmotion(sessionId: string): Promise<CallEmotion | null> {
  const { data, error } = await supabase
    .from("session_logs")
    .select("payload")
    .eq("sessionId", sessionId)
    .eq("type", "emotion")
    .order("ts", { ascending: true });
  if (error || !data) return null;
  const turns = data
    .map((r) => r.payload as Partial<TurnEmotion>)
    .filter((p): p is TurnEmotion => typeof p.label === "string" && typeof p.intensity === "number");
  return summarizeCallEmotion(turns);
}
