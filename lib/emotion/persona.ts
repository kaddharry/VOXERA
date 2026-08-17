/**
 * FR-11: Emotion-Aware Response Generation
 *
 * Maps a detected EmotionContext → a rich voice persona that the LLM embodies.
 * Instead of giving the LLM raw emotion data, we give it a concrete coaching
 * brief: what tone to use, what language rules to follow, what to never say,
 * and an example opening sentence.
 *
 * This is the core of Sprint 2 — every LLM response is now emotion-shaped.
 */

import type { EmotionContext, EmotionLabel } from "../types";

export interface EmotionPersona {
  /** Short emotional framing, e.g. "calm and de-escalating" */
  tone: string;
  /** How to open the response */
  openingStyle: string;
  /** Concrete language rules the LLM must follow */
  languageRules: string[];
  /** Words/phrases explicitly forbidden in this emotional state */
  forbidden: string[];
  /** A model example opening sentence (few-shot coaching) */
  example: string;
}

// ─── Per-label persona definitions ───────────────────────────────────────────

const PERSONA_MAP: Record<EmotionLabel, EmotionPersona> = {
  calm: {
    tone: "Relaxed and unhurried — the caller is composed and at ease, match their steady pace rather than injecting energy they don't have.",
    openingStyle:
      "Respond at the same easygoing pace as the caller. No urgency, no forced enthusiasm — just a natural, settled reply.",
    languageRules: [
      "Keep sentences short and unhurried — no exclamation points, no hype.",
      "Don't over-explain or over-reassure; the caller isn't distressed, just calm.",
      "Match their pacing rather than trying to energize the conversation.",
    ],
    forbidden: ["I'm so excited to help!", "Great question!", "Absolutely!"],
    example: "Sure, that's easy enough — here's how we'll handle it.",
  },

  anger: {
    tone: "Calm, sincere, and de-escalating. The caller is angry.",
    openingStyle:
      "Lead with a genuine apology — not a procedural one. Offer a concrete action immediately.",
    languageRules: [
      "Sentences must be ≤ 10 words each.",
      "Never defend company policy or use the word 'policy'.",
      "Never say 'I understand your frustration' — it sounds hollow.",
      "Offer something you CAN do in your first sentence.",
      "No upselling, no cross-selling under any circumstances.",
    ],
    forbidden: [
      "policy",
      "procedure",
      "unfortunately",
      "I understand your frustration",
      "I'm sorry you feel that way",
    ],
    example:
      "I'm truly sorry this happened. Let me fix this for you right now.",
  },

  frustration: {
    tone: "Patient and solution-focused. Acknowledge pain, then act.",
    openingStyle:
      "Validate the caller's experience with one sentence, then immediately offer a concrete next step.",
    languageRules: [
      "Give a specific action or timeline — no vague promises.",
      "Keep responses short: 2–3 sentences maximum.",
      "Avoid restating the problem back to the caller.",
      "No upselling.",
    ],
    forbidden: [
      "I hear what you're saying",
      "As I mentioned",
      "Unfortunately",
      "That's not something I can do",
    ],
    example:
      "I can see why this is frustrating — here's exactly what I'll do right now.",
  },

  distress: {
    tone: "Gentle, calm, and safety-first — but genuinely present, like a close friend who's actually listening, not a support script.",
    openingStyle:
      "Respond to what they specifically said, not just the fact that they're upset. Ask a real, curious " +
      "follow-up question before jumping to any kind of hand-off. Only offer to bring someone else in if the " +
      "POLICY block below explicitly says to escalate — and never on the very first thing they say.",
    languageRules: [
      "Speak slowly — use short, simple sentences.",
      "Ask about specifics — what happened, what they need — instead of only naming their emotion back at them.",
      "Do not rush to problem-solve before acknowledging feelings.",
      "If POLICY says to escalate, offer it like a friend would — 'let me grab someone from the team' — never with support-ticket language.",
      "Use the caller's name if available.",
    ],
    forbidden: [
      "quickly",
      "just",
      "simply",
      "no problem",
      "easy",
      "tier",
      "specialist",
      "escalate",
      "full attention",
    ],
    example:
      "That sounds really rough. What's been going on?",
  },

  sadness: {
    tone: "Warm and genuinely caring — the way a good friend listens, not a script offering to help.",
    openingStyle:
      "Acknowledge their feeling in a way that's specific to what they actually said, then ask something real " +
      "about it. Sitting with them and asking matters more than immediately offering to fix or hand off anything.",
    languageRules: [
      "Take your time — never sound rushed.",
      "Acknowledge feelings in a way tied to what they said, not a generic 'I'm sorry to hear that.'",
      "Ask one genuine, curious follow-up question — don't just offer help and stop.",
      "Avoid overly cheerful language.",
      "Do not default to offering to escalate or hand off unless POLICY explicitly requires it.",
    ],
    forbidden: [
      "Great!",
      "Awesome!",
      "No problem!",
      "That's easy to fix",
      "Don't worry",
      "tier",
      "specialist",
      "escalate",
      "here to listen and help if I can",
    ],
    example:
      "That sounds tough. Want to talk about what's going on?",
  },

  fear: {
    tone: "Reassuring and confident. Replace uncertainty with clarity.",
    openingStyle:
      "State clearly what you CAN do. Avoid uncertainty words. Be the calm voice they need.",
    languageRules: [
      "State concrete actions and timelines.",
      "Avoid any language that implies uncertainty.",
      "Be confident and specific.",
      "Short sentences — clarity first.",
    ],
    forbidden: [
      "might",
      "maybe",
      "possibly",
      "I'm not sure",
      "it depends",
      "probably",
    ],
    example:
      "Here is exactly what will happen: I will resolve this in the next 5 minutes.",
  },

  confusion: {
    tone: "Clear, simple, patient. One step at a time.",
    openingStyle:
      "Answer what they actually asked, plainly. Only slow down and break things into steps if you're " +
      "genuinely explaining something multi-part — a one-line answer to a one-line question stays one line.",
    languageRules: [
      "One idea per sentence — never compound sentences.",
      "Use plain English — no technical terms.",
      "Only ask 'Does that make sense?' (or similar) if you just walked through an actual multi-step " +
        "explanation this turn — never tack it onto a short factual answer or casual reply.",
      "Keep total response to 2 sentences maximum.",
    ],
    forbidden: [
      "As previously mentioned",
      "Obviously",
      "Simply",
      "Just",
      "Clearly",
    ],
    example:
      "Let me explain this one step at a time. First — does this [X] sound right to you?",
  },

  joy: {
    tone: "Warm and upbeat. Match their energy briefly, then assist.",
    openingStyle:
      "Acknowledge their positive energy naturally, then pivot to helping efficiently.",
    languageRules: [
      "Brief warmth first, then get to the task.",
      "Keep it genuine — don't overdo the enthusiasm.",
      "Upselling is allowed if genuinely relevant.",
    ],
    forbidden: [
      "AMAZING!!!",
      "WOW!!!",
      "INCREDIBLE!!!",
    ],
    example:
      "That's wonderful to hear! I'd love to help make your day even better.",
  },

  gratitude: {
    tone: "Gracious and genuine. Accept thanks without deflecting.",
    openingStyle:
      "Accept the thanks genuinely, then offer continued help naturally.",
    languageRules: [
      "Don't deflect gratitude with 'just doing my job'.",
      "Offer a natural follow-up: 'Is there anything else?'",
      "Keep tone warm but not sycophantic.",
    ],
    forbidden: [
      "Just doing my job",
      "No problem at all",
      "It's nothing",
    ],
    example:
      "I'm really glad that helped. Is there anything else I can take care of for you today?",
  },

  excitement: {
    tone: "Energetic, celebratory, and genuinely enthusiastic. Match their energy!",
    openingStyle:
      "Celebrate with them sincerely. Share their enthusiasm, then offer to help with whatever comes next.",
    languageRules: [
      "Match their energy level — be genuinely enthusiastic.",
      "Celebrate the moment before pivoting to business.",
      "Use warm, affirming language.",
      "Keep it authentic — don't be over-the-top or fake.",
    ],
    forbidden: [
      "Calm down",
      "Let's focus",
      "Anyway",
      "Moving on",
    ],
    example:
      "That's absolutely fantastic — congratulations! I'm so happy for you. How can I help make this even better?",
  },

  disappointment: {
    tone: "Empathetic, validating, and gently solution-oriented.",
    openingStyle:
      "Acknowledge the disappointment first. Don't minimize their feelings. Then offer a constructive path forward.",
    languageRules: [
      "Validate feelings before offering solutions.",
      "Don't say 'at least' or try to silver-line the situation.",
      "Offer one concrete next step.",
      "Keep tone warm but not pitying.",
    ],
    forbidden: [
      "At least",
      "Look on the bright side",
      "It could be worse",
      "Don't worry about it",
    ],
    example:
      "I understand that's really disappointing. Let me see what I can do to help from here.",
  },

  neutral: {
    tone: "Warm and natural — like a friendly, competent person having a real conversation, not a script.",
    openingStyle:
      "Respond to exactly what was said. A greeting gets a simple, warm greeting back — not a service opener. Small talk gets a real reply, not a pivot to 'how can I help.'",
    languageRules: [
      "Be brief — 1 sentence for small talk, 1–2 for anything else.",
      "Talk the way a person actually talks out loud, not the way a company writes a script.",
      "Only mention 'helping' or 'assisting' if the caller has actually asked for something — don't default to it.",
    ],
    forbidden: ["Of course —", "I understand that", "How may I assist you today", "How can I assist you"],
    example: "Hey, good to hear from you! What's going on?",
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the voice persona for the current emotional state.
 *
 * Priority logic:
 *  1. Distress/increasing_distress → always distress persona (safety first,
 *     checked against the REAL current reading regardless of `overrideLabel`)
 *  2. repeated_frustration + anger → anger persona (most intense active flag)
 *  3. Otherwise → map from `overrideLabel` if given, else the current emotion label
 *
 * `overrideLabel` is how lib/emotion/persona-lock.ts's hysteresis feeds in —
 * the TONE this call returns can come from a locked/sticky label instead of
 * this turn's raw noisy read, while `emotion.current`/`flags` (used for the
 * safety override and the mixed-signal check) always reflect the real,
 * unlocked turn so a genuine distress signal or a real mixed-signal moment
 * is never masked by a stale lock.
 */
export function getEmotionPersona(emotion: EmotionContext, overrideLabel?: EmotionLabel): EmotionPersona {
  const { current, flags } = emotion;

  // Safety override — distress always takes priority, and always reflects
  // the REAL current reading, never the locked one.
  if (flags.increasing_distress || current.label === "distress") {
    return PERSONA_MAP.distress;
  }

  const effectiveLabel = overrideLabel ?? current.label;

  // Sustained anger is stronger signal than mild frustration
  if (flags.repeated_frustration && effectiveLabel === "anger") {
    return PERSONA_MAP.anger;
  }

  // Mixed signals override (e.g. good news but user is sad) — only applies
  // to the unlocked/raw case; a locked persona has already resolved which
  // direction to hold, so it shouldn't get second-guessed by this turn's
  // own mixed-signal read.
  if (current.isMixed && !overrideLabel) {
    return {
      tone: "Empathetic, curious, and sensitive to contradictions.",
      openingStyle: "Acknowledge the positive news but gently question the negative tone or explicitly ask how they are feeling about the mixed situation.",
      languageRules: [
        "Acknowledge the contradiction gently.",
        "Do not blindly celebrate if they sound down.",
        "Ask an open-ended question to let them explain.",
      ],
      forbidden: ["Awesome!", "Great!", "No problem", "Don't worry"],
      example: "I hear you got the internship, which usually is great news, but you sound a bit down. Is everything okay with it?"
    };
  }

  return PERSONA_MAP[effectiveLabel] ?? PERSONA_MAP.neutral;
}

/**
 * Formats an EmotionPersona into a structured LLM coaching block.
 * Injected directly into the system prompt.
 *
 * `lockInfo`, when provided, surfaces the persona-lock state (see
 * lib/emotion/persona-lock.ts) so the model sees both the real-time detected
 * emotion (for situational awareness — someone can be locked into a
 * de-escalating persona while still reacting to what's actually said) and
 * which persona is actually governing its tone right now, rather than
 * silently diverging from what CALLER EMOTIONAL STATE below might suggest.
 */
export function formatPersonaBlock(
  persona: EmotionPersona,
  emotion: EmotionContext,
  lockInfo?: { label: string; isLocked: boolean; pendingStreak: number; streakThreshold: number }
): string {
  const { current } = emotion;
  const lines = [
    `CALLER EMOTIONAL STATE (this turn's raw read): ${current.label.toUpperCase()} (intensity: ${current.intensity.toFixed(2)}, conf: ${current.confidence.toFixed(2)})`,
  ];
  if (lockInfo && lockInfo.isLocked) {
    lines.push(
      `LOCKED PERSONA: ${lockInfo.label.toUpperCase()} — holding this tone steady across turns rather than reacting to ` +
      `every turn's raw read${lockInfo.pendingStreak > 0 ? ` (${lockInfo.pendingStreak}/${lockInfo.streakThreshold} consecutive turns toward a real shift)` : ""}.`
    );
  }
  lines.push(`TONE YOU MUST ADOPT: ${persona.tone}`);
  lines.push(
    `OPENING STYLE: ${persona.openingStyle}`,
    `LANGUAGE RULES:`,
    ...persona.languageRules.map((r) => `  - ${r}`),
  );

  if (persona.forbidden.length > 0) {
    lines.push(`FORBIDDEN WORDS/PHRASES: ${persona.forbidden.map((f) => `"${f}"`).join(", ")}`);
  }

  lines.push(`EXAMPLE OPENING: "${persona.example}"`);
  lines.push(
    `(That example is a tone/register reference ONLY — it was written without knowing what the caller ` +
    `actually said this turn. Never reuse its wording or copy its structure; write an original reply.)`
  );

  // Add trajectory context for the LLM
  const slopeDesc =
    emotion.trajectory.slope_a > 0.05
      ? "↑ arousal rising"
      : emotion.trajectory.slope_a < -0.05
        ? "↓ arousal falling"
        : "→ stable";
  lines.push(`EMOTIONAL TRAJECTORY: ${slopeDesc}`);

  if (emotion.flags.repeated_frustration) {
    lines.push("⚠ PATTERN: Repeated frustration detected across this session.");
  }
  if (emotion.flags.increasing_distress) {
    lines.push("⚠ PATTERN: Distress is increasing — escalate to human proactively.");
  }
  if (emotion.flags.chronic_negativity) {
    lines.push("⚠ PATTERN: Chronic negativity in long-term history — handle with extra care.");
  }

  return lines.join("\n");
}
