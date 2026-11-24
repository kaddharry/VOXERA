/**
 * Guards between the model's proposals and what gets stored. The model can
 * hallucinate or leak, so nothing is saved unless it is traceable to what the
 * PATIENT actually said and (for shared lessons) contains no personal details.
 */

export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

/** True when `evidence` really appears in `source`: exact (normalized) substring,
 * or at least 80% of its words present in order-insensitive fashion for >=4 words
 * (STT punctuation/spelling noise). Short quotes must match exactly. */
export function isGrounded(evidence: string, source: string): boolean {
  const ev = normalize(evidence);
  if (ev.length < 3) return false;
  const src = normalize(source);
  if (src.includes(ev)) return true;
  const evTokens = tokens(evidence);
  if (evTokens.length < 4) return false;
  const srcSet = new Set(tokens(source));
  const hit = evTokens.filter((t) => srcSet.has(t)).length;
  return hit / evTokens.length >= 0.8;
}

/** Lessons shared across agents must not carry the patient's identity. */
export function containsIdentifiers(text: string, identifiers: { names?: string[]; phones?: string[] }): boolean {
  const norm = normalize(text);
  for (const name of identifiers.names ?? []) {
    for (const part of normalize(name).split(" ")) {
      if (part.length >= 3 && new RegExp(`(^| )${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(norm)) return true;
    }
  }
  const digits = text.replace(/\D/g, "");
  for (const phone of identifiers.phones ?? []) {
    const p = phone.replace(/\D/g, "");
    if (p.length >= 6 && digits.includes(p.slice(-6))) return true;
  }
  // Any long digit run (phone numbers, ids) or an email never belongs in a shared lesson.
  if (/\d{6,}/.test(digits) && /\d[\d\s-]{6,}\d/.test(text)) return true;
  if (/\S+@\S+\.\S+/.test(text)) return true;
  return false;
}

/** Token-overlap similarity (0..1): deterministic, no model needed, works for any script. */
export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
