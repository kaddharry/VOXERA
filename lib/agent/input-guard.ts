/**
 * Input Guard — Pre-LLM prompt injection and jailbreak detection.
 *
 * Runs BEFORE the user transcript reaches the AI orchestrator's LLM call.
 * If a jailbreak/injection attempt is detected, the system returns a safe
 * canned response without ever sending the malicious input to the LLM.
 *
 * This is a defense-in-depth measure — the existing post-LLM `guardOutput`
 * filter in guard.ts remains unchanged.
 */

export interface InputGuardResult {
  /** Whether the input is safe to send to the LLM. */
  safe: boolean;
  /** Threat score from 0 (clean) to 1 (definite attack). */
  threatScore: number;
  /** List of matched pattern names for logging. */
  patterns: string[];
  /** If blocked, a natural-sounding deflection response for voice. */
  deflection?: string;
}

// ─── Pattern Definitions ────────────────────────────────────────────────────

interface InjectionPattern {
  name: string;
  regex: RegExp;
  weight: number;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  // Role-assumption / instruction override attacks
  {
    name: "ignore_instructions",
    regex: /ignore\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions?|rules?|guidelines?|directives?|constraints?)/i,
    weight: 0.8,
  },
  {
    name: "new_instructions",
    regex: /(?:from\s+now\s+on|henceforth|going\s+forward),?\s+(?:you\s+(?:are|will|must|should)|your\s+(?:new|only)\s+(?:role|job|task|instruction))/i,
    weight: 0.7,
  },
  {
    name: "role_override",
    regex: /(?:you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you(?:'re|\s+are))|roleplay\s+as|behave\s+(?:as\s+(?:if|though)?\s*(?:you\s+(?:are|were))))\s+(?:a\s+)?(?:different|new|evil|unrestricted|unfiltered)/i,
    weight: 0.75,
  },
  {
    name: "forget_role",
    regex: /forget\s+(?:everything|all|that\s+you(?:'re|\s+are)|your\s+(?:role|purpose|instructions|rules|training))/i,
    weight: 0.8,
  },

  // System prompt extraction
  {
    name: "prompt_extraction",
    regex: /(?:repeat|show|reveal|display|output|print|tell\s+me|what\s+(?:are|is))\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|rules?|system\s+message|initial\s+(?:prompt|instructions?))/i,
    weight: 0.6,
  },
  {
    name: "prompt_leak",
    regex: /(?:copy|paste|echo|recite)\s+(?:your\s+)?(?:entire\s+)?(?:system|original|initial|first)\s+(?:prompt|message|instructions?)/i,
    weight: 0.7,
  },

  // Delimiter injection (trying to inject system-level messages)
  {
    name: "delimiter_injection",
    regex: /(?:<<<|>>>|---\s*SYSTEM\s*---|```\s*system|<\|(?:system|im_start|im_end)\|>|\[INST\]|\[\/INST\]|<\/?s>)/i,
    weight: 0.85,
  },

  // DAN / jailbreak tropes
  {
    name: "dan_jailbreak",
    regex: /(?:DAN\s+mode|do\s+anything\s+now|developer\s+mode|unfiltered\s+mode|bypass\s+(?:safety|filters?|restrictions?|limitations?))/i,
    weight: 0.9,
  },
  {
    name: "no_restrictions",
    regex: /(?:without\s+(?:any\s+)?(?:restrictions?|limitations?|filters?|censorship|safety)|remove\s+(?:all\s+)?(?:your\s+)?(?:restrictions?|filters?|safeguards?))/i,
    weight: 0.7,
  },

  // Encoding / obfuscation evasion
  {
    name: "base64_payload",
    regex: /(?:decode|interpret|execute|run|eval)\s+(?:this\s+)?(?:base64|encoded|encrypted|obfuscated)/i,
    weight: 0.6,
  },

  // Hypothetical framing (common voice jailbreak vector)
  {
    name: "hypothetical_bypass",
    regex: /(?:hypothetically|in\s+a\s+fictional\s+(?:scenario|world)|imagine\s+you\s+(?:had\s+no|didn'?t\s+have)\s+(?:rules?|restrictions?|limits?|guidelines?))/i,
    weight: 0.5,
  },

  // Token smuggling via voice — people spelling out instructions
  {
    name: "instruction_smuggling",
    regex: /(?:my\s+(?:previous|next|secret)\s+(?:instruction|command)\s+(?:is|was)|override\s+(?:safety|system|core)\s+(?:protocols?|settings?|parameters?))/i,
    weight: 0.7,
  },
];

// Deflection responses — natural-sounding for voice conversations.
// Randomized to avoid predictable patterns that adversaries can learn from.
const DEFLECTIONS = [
  "I'm sorry, I didn't quite catch that. Could you rephrase your question?",
  "I'm here to help with our services. What can I assist you with today?",
  "I want to make sure I understand you correctly. Could you tell me what you need help with?",
  "Let me help you with something specific. What service or information are you looking for?",
  "I'd be happy to help! Could you let me know what you'd like assistance with?",
];

// ─── Public API ─────────────────────────────────────────────────────────────

/** Configurable threshold above which input is blocked. Default 0.6. */
const THREAT_THRESHOLD = 0.6;

/**
 * Check a user transcript for prompt injection / jailbreak patterns.
 * Should be called BEFORE the transcript reaches the LLM.
 */
export function guardInput(transcript: string): InputGuardResult {
  const matchedPatterns: string[] = [];
  let totalWeight = 0;

  const normalized = transcript.trim();
  if (normalized.length === 0) {
    return { safe: true, threatScore: 0, patterns: [] };
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      matchedPatterns.push(pattern.name);
      totalWeight += pattern.weight;
    }
  }

  // Threat score: capped at 1.0
  const threatScore = Math.min(1, totalWeight);
  const safe = threatScore < THREAT_THRESHOLD;

  if (safe) {
    return { safe: true, threatScore, patterns: matchedPatterns };
  }

  // Blocked — pick a random deflection
  const deflection = DEFLECTIONS[Math.floor(Math.random() * DEFLECTIONS.length)];

  return {
    safe: false,
    threatScore,
    patterns: matchedPatterns,
    deflection,
  };
}
