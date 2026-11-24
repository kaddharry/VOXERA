import type { Learning } from "./types";

/**
 * Clinical-advice lessons ("tell a patient with chest pain to go to the ER", "adjust the medication reminder")
 * must never reach live calls on the strength of two calls alone: a person at the hospital has to approve them.
 *
 * The review state lives in the lesson's `key` column, which lessons otherwise leave empty (only patient facts use
 * it), so no schema change is needed:
 *   key = "review:pending"   waiting for a human; never active, never in a prompt
 *   key = "review:approved"  a human approved it; follows the normal rules (and is active at once)
 *   key = "review:rejected"  a human rejected it; kept so the same lesson is not proposed again
 *   key = null               not clinical, normal automatic learning
 */
export const REVIEW_PENDING = "review:pending";
export const REVIEW_APPROVED = "review:approved";
export const REVIEW_REJECTED = "review:rejected";

const CLINICAL_RE = new RegExp(
  [
    "\\badvis(?:e|ing)\\b", "\\badvice\\b", "\\brecommend(?:s|ed|ing)?\\b", "\\binstruct(?:s|ed|ing)?\\b", "\\btell (?:them|the patient|patients) to\\b",
    "\\bemergency\\b", "\\ber\\b", "\\bambulance\\b", "\\bnearest (?:hospital|emergency)\\b", "\\bgo to (?:the )?(?:hospital|er|emergency)\\b",
    "\\bmedicat\\w*", "\\bmedicine\\w*", "\\bdos(?:e|age|ing)\\b", "\\bprescri\\w*", "\\bdrug\\w*", "\\bantibiotic\\w*", "\\binsulin\\b", "\\bstop taking\\b",
    "\\bdiagnos\\w*", "\\btreatment\\b", "\\btriage\\b", "\\bscreen(?:ing)? for\\b",
    "\\bchest pain\\b", "\\bbreath(?:less\\w*| trouble|ing)\\b", "\\bshortness of breath\\b", "\\bbleeding\\b", "\\bfever\\b", "\\bblood pressure\\b",
  ].join("|"),
  "i",
);

/** True when a lesson gives clinical guidance (advice, medication, emergencies, symptom handling). */
export function isClinicalLesson(text: string): boolean {
  return CLINICAL_RE.test(text);
}

export function reviewState(l: Pick<Learning, "key">): "pending" | "approved" | "rejected" | null {
  if (l.key === REVIEW_PENDING) return "pending";
  if (l.key === REVIEW_APPROVED) return "approved";
  if (l.key === REVIEW_REJECTED) return "rejected";
  return null;
}

/** A lesson that may not be used in a live call yet (also a safety net on top of status). */
export function blockedFromPrompts(l: Pick<Learning, "key">): boolean {
  return l.key === REVIEW_PENDING || l.key === REVIEW_REJECTED;
}
