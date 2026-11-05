import type { EmotionLabel } from "../types";

/**
 * MilaNLProc/xlm-emo-t (Bianchi/Nozza/Hovy, WASSA 2022) → VOXERA's 12-label
 * taxonomy. XLM-EMO is trained across 19 languages (including Hindi, Tamil,
 * Bengali, and most of the Gnani-supported set — see
 * /Users/vikasverma/.claude/plans/deep-beaming-hennessy.md) but only
 * outputs 4 classes: joy, anger, fear, sadness.
 *
 * This is a NARROWER map than HF_LABEL_MAP (emotion-label-map.ts, 7→7 of 12
 * labels) — there is no XLM-EMO class for distress, frustration, confusion,
 * gratitude, excitement, disappointment, or calm. Most importantly:
 * `distress` (safety/escalation-critical, see detect.ts's HF_LABEL_MAP
 * comment) has NO equivalent here. A non-English caller in genuine distress
 * will surface as `fear` or `sadness` instead. Accepted as a known v1 gap
 * per the plan above, not a bug — do not "fix" this by guessing a mapping
 * that isn't actually there.
 */
export const XLM_EMO_LABEL_MAP: Record<string, EmotionLabel> = {
  joy: "joy",
  anger: "anger",
  fear: "fear",
  sadness: "sadness",
};
