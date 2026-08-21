import type { PolicyDirectives } from "../types";

// Lightweight anti-hallucination checks. Run on the LLM output before TTS.
export interface GuardResult {
  ok: boolean;
  reasons: string[];
  cleaned: string;
}

// Hoisted so the whole-text guardOutput() below and the clause-safe
// streaming variants further down (guardBeforeLLM/guardOpeningClause/
// cleanClause/guardTrailingClause) can never drift apart on what counts as
// an acknowledgement, a handoff mention, a citation fence, or a fabricated
// ticket pattern.
const ACK_PHRASES = [
  "i understand",
  "i hear",
  "i'm sorry",
  "i am sorry",
  "that sounds",
  "i can see",
  "apologize",
  "completely understand",
  "i get that",
];

const HANDOFF_RE =
  /(connect|transfer|supervisor|human|someone from the team|teammate|grab someone|loop (?:in|you in)|bring (?:in|someone))/i;

const CITATION_FENCE_RE = /\[MEM_ID=([a-zA-Z0-9_-]+)\]/g;
const FABRICATED_TICKET_RE = /\b[A-Z]{2,}-\d{3,}\b/g;

const INJECTED_ACK_SENTENCE = "I'm really sorry this is happening.";
const RETRIEVAL_HEDGE_SENTENCE = "I don't have reliable information on that yet, so I want to avoid guessing.";
const ESCALATION_SENTENCE = "Let me grab someone from the team to help with this.";
const STT_CLARIFICATION = "I want to make sure I got that right — could you say that once more for me?";

export function guardOutput(args: {
  reply: string;
  allowedCitations: string[];
  policy: PolicyDirectives;
  sttConfidence: number;
  topRetrievalScore: number;
  minStt: number;
  minRetrieval: number;
}): GuardResult {
  const reasons: string[] = [];
  let reply = args.reply.trim();

  // 1) Citation fence: strip citations not in the allowed list.
  reply = reply.replace(CITATION_FENCE_RE, (full, id) => {
    return args.allowedCitations.includes(id) ? full : "";
  });

  // 2) Detect obvious hallucinated tokens (fake ticket patterns the LLM might fabricate).
  const fabricatedTickets = [...reply.matchAll(FABRICATED_TICKET_RE)].map((m) => m[0]);
  const groundedText = args.allowedCitations.join(" ");
  for (const t of fabricatedTickets) {
    // Only OK if present in citations' IDs OR replied-with a citation nearby.
    if (!groundedText.includes(t)) {
      const idx = reply.indexOf(t);
      const window = reply.slice(Math.max(0, idx - 40), idx + t.length + 40);
      if (!/\[MEM_ID=/.test(window)) {
        reply = reply.replace(t, "[unverified reference removed]");
        reasons.push(`stripped unverifiable identifier: ${t}`);
      }
    }
  }

  // 3) Policy compliance: acknowledgement-first.
  if (args.policy.acknowledgeFirst) {
    const first120 = reply.slice(0, 120).toLowerCase();
    const hasAck = ACK_PHRASES.some((p) => first120.includes(p));
    if (!hasAck) {
      reply = `${INJECTED_ACK_SENTENCE} ${reply}`;
      reasons.push("injected acknowledgement (policy)");
    }
  }

  // 4) Confidence gating → convert to clarification if below thresholds.
  if (args.sttConfidence < args.minStt) {
    return {
      ok: false,
      reasons: [`STT confidence ${args.sttConfidence.toFixed(2)} below ${args.minStt}`],
      cleaned: STT_CLARIFICATION,
    };
  }

  if (args.topRetrievalScore < args.minRetrieval && args.allowedCitations.length > 0 && /\b(ticket|account|order|charge|refund)\b/i.test(reply)) {
    reasons.push("retrieval below threshold — hedging factual claim");
    reply = `${RETRIEVAL_HEDGE_SENTENCE} ${reply}`;
  }

  // 5) Escalation mention required. Recognizes natural hand-off phrasing
  // ("grab someone from the team", "loop in a teammate") in addition to the
  // literal words, so a reply that already offered a hand-off naturally
  // doesn't get a second, robotic sentence bolted on top of it. The
  // fallback sentence itself is phrased the way a person would say it out
  // loud, matching the persona/policy prompts — never "specialist".
  if (args.policy.escalate !== "none") {
    const alreadyMentionsHandoff = HANDOFF_RE.test(reply);
    if (!alreadyMentionsHandoff) {
      reply += ` ${ESCALATION_SENTENCE}`;
      reasons.push("appended escalation sentence (policy)");
    }
  }

  return { ok: true, reasons, cleaned: reply.trim() };
}

// ─── Clause-safe streaming variants ────────────────────────────────────────
//
// guardOutput() above does whole-text operations that can't naively run on
// each clause as it streams in (some prepend at the start, some append at
// the end). These split it into four pieces that DO compose correctly with
// streaming, so a reply can start being spoken clause-by-clause without
// losing any of the same safety behavior:
//
//   guardBeforeLLM     — knowable before the LLM is even called (STT gate)
//   guardOpeningClause — checked once, against only the first clause
//   cleanClause        — naturally clause-safe already (static allowlist)
//   guardTrailingClause— checked once, after all clauses are done

/** STT-confidence gate — identical to guardOutput's gate #4, but checked
 * BEFORE calling the LLM at all, since sttConfidence is known upfront and
 * doesn't depend on anything the LLM produces. Skips the LLM entirely when
 * it fires — pure latency win, identical caller-facing behavior to today. */
export function guardBeforeLLM(args: {
  sttConfidence: number;
  minStt: number;
}): { blocked: true; deflection: string; reasons: string[] } | null {
  if (args.sttConfidence < args.minStt) {
    return {
      blocked: true,
      deflection: STT_CLARIFICATION,
      reasons: [`STT confidence ${args.sttConfidence.toFixed(2)} below ${args.minStt}`],
    };
  }
  return null;
}

/** Checked once, against only the first clause, before it's spoken. Returns
 * zero or more extra clauses to speak BEFORE the real first clause. The
 * retrieval-score hedge fires whenever the score gate fails and citations
 * exist, regardless of the eventual reply's wording — guardOutput's full-text
 * version only hedges if the reply happens to mention ticket/account/order/
 * charge/refund, which requires seeing the whole reply first; this is a
 * deliberately slightly more conservative tradeoff to avoid needing that
 * full-text lookahead before speaking can start. */
export function guardOpeningClause(args: {
  firstClause: string;
  policy: PolicyDirectives;
  topRetrievalScore: number;
  minRetrieval: number;
  allowedCitations: string[];
}): { leadingClauses: string[]; reasons: string[] } {
  const reasons: string[] = [];
  const leadingClauses: string[] = [];

  if (args.policy.acknowledgeFirst) {
    const first120 = args.firstClause.slice(0, 120).toLowerCase();
    const hasAck = ACK_PHRASES.some((p) => first120.includes(p));
    if (!hasAck) {
      leadingClauses.push(INJECTED_ACK_SENTENCE);
      reasons.push("injected acknowledgement (policy)");
    }
  }

  if (args.topRetrievalScore < args.minRetrieval && args.allowedCitations.length > 0) {
    leadingClauses.push(RETRIEVAL_HEDGE_SENTENCE);
    reasons.push("retrieval below threshold — hedging factual claim");
  }

  return { leadingClauses, reasons };
}

/** Naturally clause-safe already — the citation allowlist is static and
 * known upfront, so the exact same regexes from guardOutput() apply cleanly
 * to one clause at a time with no cross-clause state needed. */
export function cleanClause(clause: string, allowedCitations: string[]): { cleaned: string; reasons: string[] } {
  const reasons: string[] = [];
  let text = clause;

  text = text.replace(CITATION_FENCE_RE, (full, id) => {
    return allowedCitations.includes(id) ? full : "";
  });

  const groundedText = allowedCitations.join(" ");
  const fabricatedTickets = [...text.matchAll(FABRICATED_TICKET_RE)].map((m) => m[0]);
  for (const t of fabricatedTickets) {
    if (!groundedText.includes(t)) {
      const idx = text.indexOf(t);
      const window = text.slice(Math.max(0, idx - 40), idx + t.length + 40);
      if (!/\[MEM_ID=/.test(window)) {
        text = text.replace(t, "[unverified reference removed]");
        reasons.push(`stripped unverifiable identifier: ${t}`);
      }
    }
  }

  return { cleaned: text.trim(), reasons };
}

/** Checked once, after every clause has been spoken. Returns one more
 * clause to speak if the accumulated reply never mentioned a handoff. */
export function guardTrailingClause(args: {
  fullSpokenText: string;
  policy: PolicyDirectives;
}): { trailingClause: string | null; reasons: string[] } {
  if (args.policy.escalate === "none") return { trailingClause: null, reasons: [] };
  if (HANDOFF_RE.test(args.fullSpokenText)) return { trailingClause: null, reasons: [] };
  return {
    trailingClause: ESCALATION_SENTENCE,
    reasons: ["appended escalation sentence (policy)"],
  };
}
