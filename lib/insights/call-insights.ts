/**
 * Post-call mining for the self-learning pipeline (objective 3, step 1).
 *
 * After each call, finds:
 *  - Knowledge gaps: things the patient asked that the agent couldn't
 *    answer (said it didn't know, deflected, or promised a call-back).
 *  - Emotional failure points: moments where the patient's measured emotion
 *    got worse right after an agent reply that missed, ignored or
 *    mishandled what they said.
 *
 * Both are grounded in the call itself: the per-turn emotion readings the
 * orchestrator logs (session_logs "emotion" events), and the transcript.
 * Emotional failure points start from measured drops in the patient's mood
 * (findEmotionDrops) — an LLM only judges whether the agent's reply was the
 * cause, it never invents a moment. Every knowledge-gap question must be
 * found word-for-word in what the patient said, or it's discarded. Without
 * an LLM (offline, failed, unparseable reply) simple rules still find
 * both, marked as not reviewed.
 */
import type { EmotionLabel, VAD } from "../types";

export interface InsightTurn {
  /** 1-based position among the call's patient turns. */
  turn: number;
  patient: string;
  emotion?: { label: EmotionLabel; intensity: number; vad?: VAD };
  /** What the agent said in reply (joined if logged in parts). */
  agent?: string;
}

export interface KnowledgeGap {
  turn: number;
  /** The patient's words, verbatim. */
  question: string;
  /** Short topic used to group the same gap across calls, e.g. "bathing after surgery". */
  topic: string | null;
  agentReply: string;
  reviewed: boolean;
}

export interface EmotionSnapshot {
  label: EmotionLabel;
  valence: number;
}

export interface EmotionalFailurePoint {
  /** The patient turn the agent was replying to. */
  turn: number;
  patientBefore: string;
  agentReply: string;
  patientAfter: string;
  before: EmotionSnapshot;
  after: EmotionSnapshot;
  /** One sentence on what went wrong (LLM-reviewed), or a plain description of the drop. */
  whatWentWrong: string;
  reviewed: boolean;
}

export interface CallInsights {
  knowledgeGaps: KnowledgeGap[];
  emotionalFailurePoints: EmotionalFailurePoint[];
}

type Row = { type: string; payload: Record<string, any> };

const NEGATIVE: ReadonlySet<EmotionLabel> = new Set(["anger", "frustration", "sadness", "distress", "fear", "disappointment", "confusion"]);
/** Valence fall between consecutive patient turns that counts as "got worse". */
export const VALENCE_DROP_THRESHOLD = 0.25;

/**
 * Patient turns in order, each with its emotion and the agent's reply.
 * Emotion events are matched by utterance id; a half-sentence the patient
 * then finished (the next turn starts with it — see
 * lib/telephony/stream-handler.ts) is folded away so it isn't counted twice.
 */
export function buildTurns(rows: Row[]): InsightTurn[] {
  const emotionById = new Map<string, InsightTurn["emotion"]>();
  for (const { type, payload } of rows) {
    if (type === "emotion" && payload.utteranceId && typeof payload.label === "string") {
      emotionById.set(payload.utteranceId, { label: payload.label as EmotionLabel, intensity: Number(payload.intensity ?? 0), vad: payload.vad });
    }
  }

  const raw: Array<Omit<InsightTurn, "turn">> = [];
  for (const { type, payload } of rows) {
    if (type !== "utterance" || typeof payload.text !== "string") continue;
    if (payload.role === "user") {
      raw.push({ patient: payload.text.trim(), emotion: payload.utteranceId ? emotionById.get(payload.utteranceId) : undefined });
    } else if (raw.length > 0) {
      const last = raw[raw.length - 1];
      last.agent = last.agent ? `${last.agent} ${payload.text.trim()}` : payload.text.trim();
    }
  }

  const kept = raw.filter((t, i) => {
    const next = raw[i + 1];
    return !(next && next.patient.length > t.patient.length && next.patient.startsWith(t.patient));
  });
  return kept.map((t, i) => ({ ...t, turn: i + 1 }));
}

function valenceOf(e: NonNullable<InsightTurn["emotion"]>): number {
  if (e.vad && typeof e.vad.v === "number") return e.vad.v;
  return NEGATIVE.has(e.label) ? -e.intensity : 0;
}

const snapshot = (e: NonNullable<InsightTurn["emotion"]>): EmotionSnapshot => ({ label: e.label, valence: Math.round(valenceOf(e) * 100) / 100 });

/**
 * Where the patient's mood got worse right after an agent reply: the next
 * turn is negative and either the previous one wasn't, or valence fell by
 * at least VALENCE_DROP_THRESHOLD.
 */
export function findEmotionDrops(turns: InsightTurn[]): EmotionalFailurePoint[] {
  const drops: EmotionalFailurePoint[] = [];
  for (let i = 0; i < turns.length - 1; i++) {
    const before = turns[i];
    const after = turns[i + 1];
    if (!before.emotion || !after.emotion || !before.agent) continue;
    if (!NEGATIVE.has(after.emotion.label)) continue;
    const fall = valenceOf(before.emotion) - valenceOf(after.emotion);
    const turnedNegative = !NEGATIVE.has(before.emotion.label);
    if (!turnedNegative && fall < VALENCE_DROP_THRESHOLD) continue;
    drops.push({
      turn: before.turn,
      patientBefore: before.patient,
      agentReply: before.agent,
      patientAfter: after.patient,
      before: snapshot(before.emotion),
      after: snapshot(after.emotion),
      whatWentWrong: `The patient went from ${before.emotion.label} to ${after.emotion.label} after this reply.`,
      reviewed: false,
    });
  }
  return drops;
}

/** Agent phrasings that mean "I can't answer that". Used when no LLM review is available. */
const DEFLECTION =
  /\b(?:i (?:do not|don'?t) (?:have|know)|i(?:'m| am) not (?:able|sure)|i can(?:not|'?t) (?:give|provide|tell|answer|share|confirm)|unable to (?:give|provide|tell|answer)|(?:have|get|ask) (?:someone|one of our|a member|the (?:team|doctor|clinic))[^.?!]*(?:call|contact|reach|get back to) you)/i;

export function findDeflections(turns: InsightTurn[]): KnowledgeGap[] {
  return turns
    .filter((t) => t.agent && DEFLECTION.test(t.agent))
    .map((t) => ({ turn: t.turn, question: t.patient, topic: null, agentReply: t.agent!, reviewed: false }));
}

/** The transcript as the reviewer sees it: numbered patient turns with their measured emotion. */
export function formatTranscript(turns: InsightTurn[]): string {
  return turns
    .map((t) => {
      const feel = t.emotion ? ` [measured emotion: ${t.emotion.label}]` : "";
      return `Turn ${t.turn}\nPATIENT${feel}: ${t.patient}${t.agent ? `\nAGENT: ${t.agent}` : ""}`;
    })
    .join("\n\n");
}

export const INSIGHTS_SYSTEM_PROMPT =
  "You review a finished phone call between a hospital's AI agent and a patient, to help the hospital improve the agent. " +
  "Use ONLY what is in the transcript. Respond with ONLY a JSON object in exactly this shape: " +
  '{"knowledgeGaps": [{"turn": <turn number>, "question": "<the patient\'s question or request, copied word for word from that turn>", ' +
  '"topic": "<2-5 word topic, e.g. \'bathing after surgery\'>"}], ' +
  '"failurePoints": [{"turn": <one of the candidate turn numbers given>, "agentCaused": <true|false>, "whatWentWrong": "<one plain sentence>"}]}. ' +
  "knowledgeGaps: only questions or requests the agent did NOT actually answer — it said it didn't know or couldn't help, " +
  "changed the subject, or only promised that someone would call back. Not things it answered. Empty array if none. " +
  "failurePoints: for EACH candidate turn listed (the patient's mood measurably got worse right after the agent's reply in that turn), " +
  "decide whether the agent's reply contributed — it missed, ignored, misunderstood or mishandled what the patient said, repeated itself, " +
  "or was cold or off-topic — (agentCaused true), or the patient simply raised something upsetting that the agent handled well (agentCaused false). " +
  "whatWentWrong says specifically what the reply did wrong, or why it wasn't the agent's fault.";

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Applies the reviewer's JSON to the measured drops and the transcript; anything not grounded in them is dropped. */
export function applyReview(raw: string, turns: InsightTurn[], drops: EmotionalFailurePoint[]): CallInsights | null {
  let parsed: any;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim());
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.knowledgeGaps) || !Array.isArray(parsed.failurePoints)) return null;

  const byTurn = new Map(turns.map((t) => [t.turn, t]));
  const knowledgeGaps: KnowledgeGap[] = [];
  for (const g of parsed.knowledgeGaps) {
    const t = byTurn.get(Number(g?.turn));
    if (!t || typeof g.question !== "string" || !g.question.trim()) continue;
    if (!normalise(t.patient).includes(normalise(g.question))) continue; // not the patient's own words
    if (knowledgeGaps.some((k) => k.turn === t.turn)) continue;
    knowledgeGaps.push({
      turn: t.turn,
      question: g.question.trim(),
      topic: typeof g.topic === "string" && g.topic.trim() ? g.topic.trim().toLowerCase() : null,
      agentReply: t.agent ?? "",
      reviewed: true,
    });
  }

  const verdicts = new Map<number, { agentCaused: boolean; whatWentWrong: string }>();
  for (const f of parsed.failurePoints) {
    if (typeof f?.agentCaused === "boolean" && typeof f.whatWentWrong === "string") {
      verdicts.set(Number(f.turn), { agentCaused: f.agentCaused, whatWentWrong: f.whatWentWrong.trim() });
    }
  }
  const emotionalFailurePoints = drops.flatMap((d) => {
    const v = verdicts.get(d.turn);
    if (!v) return [{ ...d }]; // not reviewed: keep the measured drop as-is
    return v.agentCaused ? [{ ...d, whatWentWrong: v.whatWentWrong || d.whatWentWrong, reviewed: true }] : [];
  });

  return { knowledgeGaps, emotionalFailurePoints };
}
