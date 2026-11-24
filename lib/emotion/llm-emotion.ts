/**
 * Small-model text emotion classifier (16 classes, any language).
 *
 * The keyword lexicon and the ONNX/XLM-EMO models are fast but narrow: on our
 * labelled set (__tests__/emotion/fixtures) the lexicon alone was ~41% exact
 * and ~6% on Punjabi. A small instruction model labels the same set at ~99%,
 * but costs ~0.5-0.7s — so it is NEVER on the reply's critical path: the
 * orchestrator starts it alongside reply generation, and awaits it (capped)
 * only afterwards to refine the label shown/logged and to raise alerts.
 */
import type { EmotionLabel } from "../types";
import { generateReply } from "../agent/llm";

export const EMOTION_LABELS: readonly EmotionLabel[] = [
  "neutral", "calm", "joy", "excitement", "gratitude", "relief", "surprise",
  "confusion", "worry", "fear", "sadness", "distress", "pain",
  "disappointment", "frustration", "anger",
];

const VALID = new Set<string>(EMOTION_LABELS);

const SYSTEM = `You label the emotion expressed in ONE utterance from a phone call between a hospital's care agent and a patient or caller. The utterance may be English, Hindi (Devanagari), Hinglish (Hindi in Roman letters) or Punjabi (Gurmukhi). Judge only what the speaker expresses.
Choose exactly one label:
neutral - plain information, no emotion; greetings; routine questions
calm - relaxed, at ease, unhurried
joy - happy, pleased, cheerful
excitement - thrilled, eager, can't wait
gratitude - thanking, appreciating
relief - relief after worry or pain is over ("thank god it's gone", "phew")
surprise - surprised, did not expect it
confusion - does not understand, unsure what to do
worry - anxious, nervous, concerned about something that might happen
fear - scared, afraid, terrified
sadness - sad, lonely, low, grieving, crying
distress - acute crisis: panic, cannot cope, begging for help, wants to give up or end life
pain - physical pain or discomfort being described
disappointment - let down, expected better
frustration - annoyed, fed up, irritated by repeated problems or delays
anger - furious, rude, threatening to complain, blaming
Reply with ONLY the label.`;

/** Parse the model's reply to a valid label, or null. Exported for tests. */
export function parseEmotionLabel(raw: string): EmotionLabel | null {
  const w = raw.toLowerCase().replace(/[^a-z]/g, " ").trim().split(/\s+/)[0];
  return w && VALID.has(w) ? (w as EmotionLabel) : null;
}

const cache = new Map<string, EmotionLabel>();
const CACHE_MAX = 500;

function norm(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Classify one utterance. Resolves to null (never rejects) on timeout, quota
 * errors or an unparseable reply, so callers can simply keep the fast-path label.
 */
export async function classifyEmotionLLM(
  text: string,
  opts: { timeoutMs?: number; clientId?: string } = {},
): Promise<EmotionLabel | null> {
  if (process.env.EMOTION_LLM === "off") return null;
  const key = norm(text);
  if (key.length < 2) return null;
  const hit = cache.get(key);
  if (hit) return hit;

  const timeoutMs = opts.timeoutMs ?? 2500;
  try {
    const run = generateReply({
      system: SYSTEM,
      user: `Utterance: ${text.slice(0, 400)}\nLabel:`,
      clientId: opts.clientId ?? "emotion",
      useTools: false,
      raw: true,
      fastModel: true,
      maxOutputTokens: 12,
    });
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
    const res = await Promise.race([run, timeout]);
    if (!res) return null;
    const label = parseEmotionLabel(res.text);
    if (label) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(key, label);
    }
    return label;
  } catch {
    return null;
  }
}
