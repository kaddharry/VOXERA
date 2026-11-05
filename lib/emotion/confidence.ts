import type { ConfidenceCategory } from "../types";

/**
 * Classifies a 0–1 confidence score into the SRD-specified categories (FR-7).
 *
 * Ranges:
 *  - High:   >= 0.80
 *  - Medium: >= 0.50 and < 0.80
 *  - Low:    < 0.50
 *
 * Used to take an optional `{ lexiconMatch, acousticEnergy }` param to
 * compute a more specific `explanation` string, but no caller anywhere in
 * the codebase ever passed it — the branch was permanently dead, and the
 * computed `explanation` isn't surfaced in any UI either. Removed rather
 * than left as code that looks load-bearing but never runs.
 */
export function classifyConfidence(confidence: number): ConfidenceCategory {
  const explanation = "Standard confidence threshold calculation.";
  if (confidence >= 0.8) return { level: "high", explanation };
  if (confidence >= 0.5) return { level: "medium", explanation };
  return { level: "low", explanation };
}
