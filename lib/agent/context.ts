import type { EmotionContext, EmotionLabel, MemoryRecord, PolicyDirectives, RetrievedContext, Utterance } from "../types";
import { CONFIG } from "../config";
import { policyToPrompt } from "./policy";
import { getEmotionPersona, formatPersonaBlock } from "../emotion/persona";

// Character-based budget approximation. Assumes ~4 chars/token.
const BUDGET_CHARS = 24000;

// Matches natural hand-off phrasing so we can tell the model "you already
// offered this" instead of letting it repeat the offer verbatim every turn.
const HANDOFF_OFFER_RE = /\b(someone|somebody)\s+from\s+the\s+team\b|\bgrab\s+someone\b|\bteammate\s+to\s+jump\s+in\b|\bconnect\s+you\s+with\b/i;

export interface LLMContext {
  system: string;
  user: string;
  citations: string[];
}

export function buildLLMContext(args: {
  userId: string;
  clientId: string;
  userTurn: Utterance;
  retrieved: RetrievedContext;
  emotion: EmotionContext;
  policy: PolicyDirectives;
  /** A custom agent's own system prompt (Agent Builder, lib/db/agents.ts's
   * `system_prompt` column) — domain-specific instructions layered on top
   * of the baseline rules, never a replacement for them. Undefined for the
   * hardcoded demo agent. */
  customInstructions?: string;
  /** Persona-lock result from lib/emotion/persona-lock.ts's resolvePersonaLock()
   * — when present, the persona/tone block uses this sticky label instead of
   * `emotion.current.label` directly, so the LLM's tone doesn't flip on a
   * single noisy turn. Omit to fall back to the old unlocked-every-turn
   * behavior (e.g. for callers that haven't adopted session-scoped locking). */
  personaLock?: { label: EmotionLabel; justShifted: boolean; pendingStreak: number };
}): LLMContext {
  const { retrieved, emotion, policy, userTurn, customInstructions, personaLock } = args;

  // Uses full record `text`, not the 180-char `summary` — `summary` exists
  // to keep conversational-memory listings compact, but knowledge-base
  // chunks (uploaded PDFs/docs, tier LTM_client) are the one place where the
  // exact wording matters: a fact like "experience at Tredence" sitting
  // after the first sentence of a ~500-char chunk was silently getting cut
  // off before the LLM ever saw it. Budget raised accordingly (1600 -> 6000)
  // since full chunk text is several times longer than a summary.
  const clientBlock = truncate(
    formatRecords("CLIENT", retrieved.ltmClient, ["brand_voice", "compliance", "escalation"], { useFullText: true }),
    6000,
  );
  const timelineBlock = retrieved.timeline && retrieved.timeline.length > 0
    ? truncate(formatTimeline(retrieved.timeline), 7200)
    : "";

  const userLtmBlock = timelineBlock
    ? "" // Grouped in timeline instead of isolated records
    : truncate(formatRecords("USER_PROFILE", retrieved.ltmUser), 1200);

  const evidenceBlock = timelineBlock
    ? timelineBlock
    : truncate(formatEvidence(retrieved.mtm), 6000);

  const emotionBlock = formatEmotion(emotion);
  const alreadyOfferedHandoff = retrieved.stm.some(
    (t) => t.role === "agent" && HANDOFF_OFFER_RE.test(t.text)
  );
  const policyBlock = policyToPrompt(policy, alreadyOfferedHandoff);
  const stmBlock = truncate(formatStm(retrieved.stm, userTurn.id), 8000);

  // FR-11: Build dynamic emotion persona for this turn — uses the locked
  // label (if a lock was resolved this turn) rather than the raw per-turn
  // read, so tone doesn't flip on single-turn noise. See persona-lock.ts.
  const persona = getEmotionPersona(emotion, personaLock?.label);
  const personaBlock = formatPersonaBlock(persona, emotion, personaLock ? {
    label: personaLock.label,
    isLocked: true,
    pendingStreak: personaLock.pendingStreak,
    streakThreshold: CONFIG.emotion.personaLockStreakThreshold,
  } : undefined);

  const system = [
    "You are VOXERA, talking on a live phone call. You sound like a warm, sharp, likeable person — " +
      "the kind of assistant people actually enjoy talking to, not a corporate script reader. " +
      "You MUST follow ALL of the rules below:",
    "",
    "=== EMOTIONAL PERSONA (HIGHEST PRIORITY) ===",
    personaBlock,
    "",
    "=== CORE RULES ===",
    "1. For factual/account/business questions: answer ONLY using the EVIDENCE block + STM. If not grounded " +
      "there, say you do not have that information and offer next steps. This rule does NOT apply to " +
      "greetings or small talk — there's nothing to look up in \"hello\" or \"how's it going\", just talk normally.",
    "2. When you reference a specific fact from EVIDENCE, cite it inline as [MEM_ID=xxxx].",
    "3. Obey the POLICY directives exactly — pacing, acknowledgement, and escalation.",
    "4. Voice-style: this is a live spoken phone call, not chat. Talk the way a real person talks out loud — " +
      "short sentences, contractions (\"I'm\", \"that's\", \"let's\"), no corporate phrasing. 1-2 short " +
      "sentences (under ~30 words) unless the caller explicitly asks for detail. No preamble like \"I " +
      "understand that...\", \"Of course...\", or restating the question back at them.",
    "5. Never invent ticket numbers, dates, account details, or policy facts.",
    "6. Always respond to what the caller actually said this turn. A greeting gets a greeting back " +
      "(don't launch into \"Of course, how can I help\" when nothing was asked yet). A question directed " +
      "at you gets answered as asked, not deflected into a generic remark about the caller's mood. The " +
      "EMOTIONAL PERSONA above shapes your tone and pacing — it is never a substitute for engaging with " +
      "the actual content of the turn. Escalation and acknowledgement language should read like something " +
      "a person would actually say out loud, not a support-ticket status update.",
    "7. If the caller asks a direct question (\"what should I do\", \"how are you\", \"can you help me with " +
      "X\"), your reply must actually answer that specific question — not repeat your last message, not " +
      "just restate that you're here to help. Look at the STM block below: if your reply would say roughly " +
      "the same thing as something you already said in this session, say something different instead — " +
      "vary your wording and, if the conversation has stalled, ask one specific, genuine question that moves " +
      "it forward instead of repeating a generic offer to help.",
    "8. The EMOTIONAL PERSONA block and the EVIDENCE block answer two different questions — never let one " +
      "substitute for the other. EMOTIONAL PERSONA governs HOW you say something: your tone, pacing, word " +
      "choice, how much you acknowledge feelings before moving on. EVIDENCE/CLIENT/USER_PROFILE below governs " +
      "WHAT you're allowed to say as fact. A caller's emotional state is never itself a source of factual " +
      "information — being de-escalating with an angry caller doesn't mean inventing a price or menu item " +
      "you don't actually have grounded; being warm with a happy caller doesn't mean skipping the lookup for " +
      "something they asked you to check. If a question is purely factual (a price, an order, a policy " +
      "detail), answer it strictly from EVIDENCE per rule 1, but SAY it in the register EMOTIONAL PERSONA " +
      "specifies. If a question is about how the caller feels or what's going on with them, that's the " +
      "EMOTIONAL PERSONA's territory and EVIDENCE has nothing relevant to add.",
    "",
    customInstructions?.trim()
      ? "=== AGENT-SPECIFIC INSTRUCTIONS (from this agent's creator) ===\n" +
        truncate(customInstructions.trim(), 2000) +
        "\nFollow these in addition to everything above — they add detail and personality for this specific " +
        "agent, they never override the CORE RULES, the EMOTIONAL PERSONA, or safety/escalation behavior."
      : "",
    "",
    clientBlock,
    "",
    userLtmBlock,
  ]
    .filter(Boolean)
    .join("\n");

  const citations = retrieved.mtm.map((m) => m.id);

  const user = [
    timelineBlock ? "=== CHRONOLOGICAL EVENT TIMELINE ===" : "=== EVIDENCE ===",
    evidenceBlock || (timelineBlock ? "(no timeline events)" : "(no user-specific evidence)"),
    "",
    "=== EMOTION ===",
    emotionBlock,
    "",
    "=== POLICY ===",
    policyBlock,
    "",
    "=== STM (recent turns) ===",
    stmBlock,
    "",
    "=== CURRENT TURN ===",
    `USER: ${userTurn.text}${userTurn.sttConfidence != null ? ` [stt_conf=${userTurn.sttConfidence.toFixed(2)}]` : ""}`,
  ].join("\n");

  // Hard cap on total chars.
  const totalChars = system.length + user.length;
  if (totalChars > BUDGET_CHARS) {
    const over = totalChars - BUDGET_CHARS;
    return { system, user: truncate(user, user.length - over), citations };
  }
  return { system, user, citations };
}

function formatRecords(kind: string, recs: MemoryRecord[], preferredTopics?: string[], opts?: { useFullText?: boolean }): string {
  if (recs.length === 0) return "";
  const sorted = preferredTopics
    ? [...recs].sort((a, b) => Number(preferredTopics.includes(b.topic)) - Number(preferredTopics.includes(a.topic)))
    : recs;
  const lines = sorted.map((r) => `- [${r.topic}] ${opts?.useFullText ? r.text : r.summary}`);
  return `=== ${kind} ===\n${lines.join("\n")}`;
}

function formatTimeline(events: any[]): string {
  if (events.length === 0) return "";
  return events
    .map((evt) => {
      const startStr = new Date(evt.startDate).toLocaleDateString();
      const endStr = new Date(evt.endDate).toLocaleDateString();
      const dateRange = startStr === endStr ? startStr : `${startStr} to ${endStr}`;
      const memLines = evt.memories
        .map((m: any) => {
          const ageDays = Math.round((Date.now() - m.ts) / (1000 * 60 * 60 * 24));
          const scoreStr = (m.importance_score ?? m.importance).toFixed(2);
          return `  - [MEM_ID=${m.id}] (${ageDays}d ago, topic=${m.topic}, emotion=${m.emotion}, importance_score=${scoreStr}) ${m.summary}`;
        })
        .join("\n");
      return `=== Event: ${evt.topic.toUpperCase()} (${dateRange}) ===\n${memLines}`;
    })
    .join("\n\n");
}

function formatEvidence(recs: MemoryRecord[]): string {
  if (recs.length === 0) return "";
  return recs
    .map((r) => {
      const ageDays = Math.round((Date.now() - r.ts) / (1000 * 60 * 60 * 24));
      const scoreStr = (r.importance_score ?? r.importance).toFixed(2);
      return `[MEM_ID=${r.id}] (${ageDays}d ago, topic=${r.topic}, emotion=${r.emotion}, I=${scoreStr}, recurrence=${r.recurrence})\n  ${r.summary}`;
    })
    .join("\n");
}

function formatEmotion(ec: EmotionContext): string {
  const f = ec.flags;
  const flags = Object.entries(f)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ") || "none";
  return [
    `label=${ec.current.label} intensity=${ec.current.intensity.toFixed(2)} conf=${ec.current.confidence.toFixed(2)}`,
    `VAD=(${ec.current.vad.v.toFixed(2)}, ${ec.current.vad.a.toFixed(2)}, ${ec.current.vad.d.toFixed(2)})`,
    `slope_v=${ec.trajectory.slope_v.toFixed(3)} slope_a=${ec.trajectory.slope_a.toFixed(3)}`,
    `zDev=${ec.zDeviation.toFixed(2)} flags: ${flags}`,
  ].join(" | ");
}

function formatStm(turns: Utterance[], currentTurnId: string): string {
  const prior = turns.filter((t) => t.id !== currentTurnId);
  if (prior.length === 0) return "(no prior turns)";
  return prior
    .map((t) => {
      const emo = t.emotion ? ` <${t.emotion.label}:${t.emotion.intensity.toFixed(2)}>` : "";
      return `${t.role.toUpperCase()}${emo}: ${t.text}`;
    })
    .join("\n");
}

function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 3) + "...";
}
