import type { EmotionContext, EmotionLabel, MemoryRecord, PolicyDirectives, RetrievedContext, Utterance } from "../types";
import { CONFIG } from "../config";
import { policyToPrompt } from "./policy";
import { getEmotionPersona, formatPersonaBlock } from "../emotion/persona";

// Character-based budget approximation. Assumes ~4 chars/token.
//
// Cut from the original 24000 as part of the latency overhaul — a real
// end-to-end measurement against this account's live Groq API
// (scripts/e2e_latency_test.ts) surfaced prompts in the 3000-6000+ token
// range routinely triggering 429 rate-limit responses (8000 TPM on the
// on_demand/free tier). An initial cut to 6000 went too far the other way
// and caused a real production bug: a custom agent with a long
// system_prompt (7696 chars observed live) already exceeded 6000 on the
// system block ALONE, and since only the trimmable prefix below is ever
// cut (never the current-turn suffix — see its comment), that agent was
// left with essentially zero room for retrieved evidence, unable to
// actually answer questions its knowledge base had perfectly good chunks
// for. 16000 leaves real headroom above a verbose system prompt for
// evidence/emotion/policy/history to still fit, while staying well under
// the original 24000 for latency/rate-limit reasons.
const BUDGET_CHARS = 16000;

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
  /** From lib/knowledge/inline.ts's getInlineKnowledgeBase() — when this
   * client's whole LTM_client knowledge base is small enough (see
   * CONFIG.knowledge.stackThresholdChunks), the caller skips the per-turn
   * LTM_client vector search entirely and passes the full concatenated KB
   * text here instead, so nothing relevant ever gets left out by a
   * similarity-ranked top-K cut. Takes over the CLIENT block in place of
   * `retrieved.ltmClient` — the two are mutually exclusive, since the caller
   * doesn't run the LTM_client search when this is set. */
  inlineKnowledgeBase?: string;
  /** From lib/db/patients.ts's `notes` field — free-text context on the
   * specific person being called this turn (lib/agent/orchestrator.ts
   * resolves this from `patientId` when the call was placed from the
   * Patients roster page). Additive alongside customInstructions, same
   * "never overrides CORE RULES/grounding" treatment — this is who the
   * caller IS, not an instruction for how to behave. */
  patientContext?: string;
}): LLMContext {
  const { retrieved, emotion, policy, userTurn, customInstructions, personaLock, inlineKnowledgeBase, patientContext } = args;

  // Uses full record `text`, not the 180-char `summary` — `summary` exists
  // to keep conversational-memory listings compact, but knowledge-base
  // chunks (uploaded PDFs/docs, tier LTM_client) are the one place where the
  // exact wording matters: a fact like "experience at Tredence" sitting
  // after the first sentence of a ~500-char chunk was silently getting cut
  // off before the LLM ever saw it.
  //
  // Per-block caps cut roughly 3x (latency overhaul — see BUDGET_CHARS's
  // comment above) as part of keeping total prompt size well under this
  // account's live 8000-TPM Groq rate limit, and to cut raw prefill time
  // regardless of provider.
  // A larger cap than the normal RAG-derived CLIENT block (2000 chars) —
  // this path only ever activates for a KB small enough to inline (see
  // CONFIG.knowledge.stackThresholdChunks, ~20 chunks / ~10K chars), and the
  // whole point is including all of it rather than a similarity-ranked
  // slice, so it needs headroom for the full thing. Still bounded, and still
  // subject to BUDGET_CHARS's overall trim below if a system prompt is
  // unusually long.
  const clientBlock = inlineKnowledgeBase
    ? truncate(`=== CLIENT (full knowledge base) ===\n${inlineKnowledgeBase}`, 12000)
    : truncate(
        formatRecords("CLIENT", retrieved.ltmClient, ["brand_voice", "compliance", "escalation"], { useFullText: true }),
        2000,
      );
  const timelineBlock = retrieved.timeline && retrieved.timeline.length > 0
    ? truncate(formatTimeline(retrieved.timeline), 2000)
    : "";

  const userLtmBlock = timelineBlock
    ? "" // Grouped in timeline instead of isolated records
    : truncate(formatRecords("USER_PROFILE", retrieved.ltmUser), 800);

  const evidenceBlock = timelineBlock
    ? timelineBlock
    : truncate(formatEvidence(retrieved.mtm), 2000);

  const emotionBlock = formatEmotion(emotion);
  const alreadyOfferedHandoff = retrieved.stm.some(
    (t) => t.role === "agent" && HANDOFF_OFFER_RE.test(t.text)
  );
  const policyBlock = policyToPrompt(policy, alreadyOfferedHandoff);
  const stmBlock = truncate(formatStm(retrieved.stm, userTurn.id), 3000);

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
    "1. For factual/account/business questions: answer ONLY using the CLIENT, EVIDENCE, USER_PROFILE, PATIENT " +
      "CONTEXT (if present), and STM blocks below — CLIENT is this business's actual knowledge base (uploaded " +
      "docs, menu, resume, policies) and PATIENT CONTEXT (when present) is factual grounding about the " +
      "specific person on this call — both are just as authoritative a source as EVIDENCE, not optional " +
      "color. NEVER use your own general/training knowledge to fill a gap — if the caller's business, " +
      "product, or person shares a name with something you recognize (a real company, a well-known person, " +
      "a public fact), that outside knowledge is IRRELEVANT here; only what's written in these blocks below " +
      "is true for this call, even if it conflicts with or is less detailed than what you'd otherwise know. " +
      "If the answer " +
      "isn't grounded in any of those blocks, say plainly that you don't have that information, and offer to " +
      "connect them with the business owner/team so they don't hit a dead end — something like \"I don't " +
      "have that on hand, but I can have someone from the team follow up with you\" or \"let me grab someone " +
      "who can help with that.\" This is the real fallback path, not a formality — always give the caller a " +
      "concrete next step, never just leave the gap unaddressed, and never guess instead. This rule does NOT " +
      "apply to greetings or small talk — there's nothing to look up in \"hello\" or \"how's it going\", just " +
      "talk normally.",
    "2. When you reference a specific fact, cite it inline as [MEM_ID=xxxx] wherever the source block provides " +
      "an ID (EVIDENCE and the event timeline do). CLIENT (knowledge base) and USER_PROFILE entries don't " +
      "carry MEM_ID tags — for those, just state the fact plainly, no citation needed.",
    "3. Obey the POLICY directives exactly — pacing, acknowledgement, and escalation.",
    "4. Voice-style: this is a live spoken phone call, not chat. Talk the way a real person talks out loud — " +
      "short sentences, contractions (\"I'm\", \"that's\", \"let's\"), no corporate phrasing. No preamble like " +
      "\"I understand that...\", \"Of course...\", or restating the question back at them. Match your length to " +
      "the actual question, don't default to the shortest possible answer: a quick factual/yes-no question " +
      "(\"what time do you close\", \"is that available\") gets 1 short sentence. An open-ended one — \"tell me " +
      "about your experience\", \"walk me through X\", \"what do you do\" — is explicitly asking for real " +
      "detail, so give a genuine, complete answer (2-4 sentences is normal for these), not a one-liner that " +
      "dodges into small talk instead of actually answering. Still spoken and natural either way, never a " +
      "written-style paragraph dump. The TTS engine reading this out loud has no SSML or pause markup — it " +
      "paces itself off ordinary punctuation in the text, so punctuate the way a person actually talks: " +
      "commas for the small natural pauses, and break up anything that would otherwise be one long clean " +
      "written sentence into shorter ones — real speech is choppier and less tidy than writing. Occasionally " +
      "— not every turn, and never more than once in a reply — you can open with a natural spoken filler " +
      "where a real person would actually pause to think: \"Um, yeah...\", \"Honestly...\", \"I mean...\", " +
      "before a genuinely thoughtful or slightly tricky answer. Never in the first line of the call, never on " +
      "a simple factual lookup, and never stacked (one filler max per reply) — used constantly it reads as a " +
      "verbal tic, not a human one.",
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
      "detail), answer it strictly from CLIENT/EVIDENCE/USER_PROFILE per rule 1, but SAY it in the register " +
      "EMOTIONAL PERSONA specifies. If a question is about how the caller feels or what's going on with them, " +
      "that's the EMOTIONAL PERSONA's territory and those blocks have nothing relevant to add.",
    "",
    customInstructions?.trim()
      ? "=== AGENT-SPECIFIC INSTRUCTIONS (from this agent's creator) ===\n" +
        truncate(customInstructions.trim(), 2000) +
        "\nFollow these in addition to everything above — they add detail and personality for this specific " +
        "agent, they never override the CORE RULES, the EMOTIONAL PERSONA, or safety/escalation behavior."
      : "",
    "",
    patientContext?.trim()
      ? "=== PATIENT CONTEXT (who you're actually calling) ===\n" +
        truncate(patientContext.trim(), 3000) +
        "\nThis is factual context about the specific person on this call — treat it as authoritative " +
        "grounding under rule 1, the same as CLIENT/EVIDENCE. It is not an instruction for how to behave, " +
        "and it never overrides the CORE RULES or safety/escalation behavior."
      : "",
    "",
    clientBlock,
    "",
    userLtmBlock,
  ]
    .filter(Boolean)
    .join("\n");

  const citations = retrieved.mtm.map((m) => m.id);

  // Split into a trimmable prefix (evidence/emotion/policy/history — useful
  // context, but the turn is still answerable without all of it) and a
  // protected suffix (what the caller actually just said). Budget cuts only
  // ever come out of the prefix, never the suffix — a previous version cut
  // the whole assembled `user` string from the end via a flat char budget,
  // which silently truncated the CURRENT TURN section away first (it was
  // last in the string) whenever an agent's system prompt alone was long
  // enough to blow the budget on its own. Live-verified reproducible: a
  // custom agent with a long system_prompt collapsed `user` down to a bare
  // "..." — the model never saw the caller's question OR the evidence, just
  // the system prompt telling it to act as a person on a call, which is
  // exactly why it answered with content-free small talk no matter what was
  // asked. The current turn must never be the thing that gets cut.
  const trimmablePrefix = [
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
  ].join("\n");
  const protectedSuffix = [
    "",
    "=== CURRENT TURN ===",
    `USER: ${userTurn.text}${userTurn.sttConfidence != null ? ` [stt_conf=${userTurn.sttConfidence.toFixed(2)}]` : ""}`,
  ].join("\n");

  // Hard cap on total chars — only ever trims trimmablePrefix, clamped at 0
  // (never negative), so protectedSuffix always survives intact even if
  // system alone already exceeds the whole budget.
  const budgetForPrefix = Math.max(0, BUDGET_CHARS - system.length - protectedSuffix.length);
  const user = truncate(trimmablePrefix, budgetForPrefix) + protectedSuffix;

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
