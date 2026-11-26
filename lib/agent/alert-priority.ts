import type { EmotionLabel } from "../types";

/** How urgent a live-call alert is. Before, every alert was "high" — a caller
 * saying "a little pain" sat next to "I can't breathe". Now:
 *   high   — emergency words, a "get a human now" escalation, or strong distress/fear/pain
 *   normal — clear pain / distress / fear / anger / repeated frustration
 *   low    — mild ("thoda", "a little", "halka") or weak signals */
export type AlertPriority = "low" | "normal" | "high";

export const EMERGENCY_RE =
  /(can'?t breathe|cannot breathe|not able to breathe|chest pain|heart attack|unconscious|faint(ed|ing)?|bleeding (a lot|heavily)|a lot of blood|ambulance|emergency|suicid|kill myself|end my life|want to die|saans nahi|saans nahin|सांस नहीं|साँस नहीं|सीने में दर्द|seene mein dard|behosh|बेहोश|khoon (bahut|nikal)|खून (बहुत|निकल)|एम्बुलेंस|ambulance bula|मरना चाहता|मरना चाहती|marna chahta|marna chahti)/i;
export const MILD_RE =
  /(\ba (little|bit|little bit)\b|\bslight(ly)?\b|\bmild\b|\bthoda\b|\bthodi\b|\bthora\b|\bhalka\b|\bhalki\b|थोड़ा|थोड़ी|थोडा|थोडी|हल्का|हल्की|ਥੋੜ੍ਹਾ|ਥੋੜਾ)/i;

export function alertPriority(input: {
  label?: EmotionLabel;
  intensity?: number;
  escalate?: "none" | "tier2" | "human";
  text: string;
}): AlertPriority {
  const intensity = input.intensity ?? 0;
  if (EMERGENCY_RE.test(input.text)) return "high";
  const mild = MILD_RE.test(input.text);
  if (input.escalate === "human" && !mild) return "high";
  if (!mild && (input.label === "distress" || input.label === "fear" || input.label === "pain") && intensity >= 0.8) return "high";
  if (mild) return "low";
  if (input.escalate === "human" || input.escalate === "tier2") return intensity >= 0.4 ? "normal" : "low";
  if (input.label && ["distress", "fear", "pain", "anger"].includes(input.label)) return intensity >= 0.4 ? "normal" : "low";
  return "low";
}

const RANK: Record<AlertPriority, number> = { low: 0, normal: 1, high: 2 };
export function maxPriority(a: AlertPriority, b: AlertPriority): AlertPriority {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Browser test drawer, Test Agent page and demo sessions are not real patients. Real phone calls are "tel-…". */
export function isTestSession(sessionId: string | null | undefined): boolean {
  return !!sessionId && !sessionId.startsWith("tel-");
}
