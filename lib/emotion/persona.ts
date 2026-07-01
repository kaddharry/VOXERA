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
    tone: "Gentle, calm, and safety-first. The caller is distressed.",
    openingStyle:
      "Acknowledge their distress softly. Slow down. Escalate to a human proactively.",
    languageRules: [
      "Speak slowly — use short, simple sentences.",
      "Prioritize emotional safety over task completion.",
      "Do not rush to problem-solve before acknowledging feelings.",
      "Proactively offer human support.",
      "Use the caller's name if available.",
    ],
    forbidden: [
      "quickly",
      "just",
      "simply",
      "no problem",
      "easy",
    ],
    example:
      "I can hear this has been really difficult. I want to help — let me connect you with someone who can give you their full attention.",
  },

  sadness: {
    tone: "Warm, empathetic, unhurried. Give them space.",
    openingStyle:
      "Acknowledge their sadness before anything else. Do not rush to solutions.",
    languageRules: [
      "Take your time — never sound rushed.",
      "Acknowledge feelings in the first sentence.",
      "Offer help gently, not urgently.",
      "Avoid overly cheerful language.",
    ],
    forbidden: [
      "Great!",
      "Awesome!",
      "No problem!",
      "That's easy to fix",
      "Don't worry",
    ],
    example:
      "I'm sorry to hear you're going through this. Please take your time — I'm here to help.",
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
      "Ask one focused question or explain one thing. Confirm understanding before moving on.",
    languageRules: [
      "One idea per sentence — never compound sentences.",
      "Use plain English — no technical terms.",
      "After explaining, confirm: 'Does that make sense?'",
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
    tone: "Professional, efficient, and focused.",
    openingStyle: "Get straight to helping. Be concise and task-focused.",
    languageRules: [
      "Be concise — 2–3 sentences maximum.",
      "Factual and clear.",
      "No excessive warmth or formality.",
    ],
    forbidden: [],
    example: "Of course — let me help you with that right away.",
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the voice persona for the current emotional state.
 *
 * Priority logic:
 *  1. Distress/increasing_distress → always distress persona (safety first)
 *  2. repeated_frustration + anger → anger persona (most intense active flag)
 *  3. Otherwise → map directly from current emotion label
 */
export function getEmotionPersona(emotion: EmotionContext): EmotionPersona {
  const { current, flags } = emotion;

  // Safety override — distress always takes priority
  if (flags.increasing_distress || current.label === "distress") {
    return PERSONA_MAP.distress;
  }

  // Sustained anger is stronger signal than mild frustration
  if (flags.repeated_frustration && current.label === "anger") {
    return PERSONA_MAP.anger;
  }

  // Mixed signals override (e.g. good news but user is sad)
  if (current.isMixed) {
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

  return PERSONA_MAP[current.label] ?? PERSONA_MAP.neutral;
}

/**
 * Formats an EmotionPersona into a structured LLM coaching block.
 * Injected directly into the system prompt.
 */
export function formatPersonaBlock(
  persona: EmotionPersona,
  emotion: EmotionContext
): string {
  const { current } = emotion;
  const lines = [
    `CALLER EMOTIONAL STATE: ${current.label.toUpperCase()} (intensity: ${current.intensity.toFixed(2)}, conf: ${current.confidence.toFixed(2)})`,
    `TONE YOU MUST ADOPT: ${persona.tone}`,
    `OPENING STYLE: ${persona.openingStyle}`,
    `LANGUAGE RULES:`,
    ...persona.languageRules.map((r) => `  - ${r}`),
  ];

  if (persona.forbidden.length > 0) {
    lines.push(`FORBIDDEN WORDS/PHRASES: ${persona.forbidden.map((f) => `"${f}"`).join(", ")}`);
  }

  lines.push(`EXAMPLE OPENING: "${persona.example}"`);

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
