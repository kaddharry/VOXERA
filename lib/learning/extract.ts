import { generateReply } from "../agent/llm";
import { containsIdentifiers, isGrounded, normalize } from "./grounding";
import { LESSON_CATEGORIES, PATIENT_CATEGORIES, type Extraction, type ExtractedFact, type ExtractedLesson, type Learning } from "./types";

export interface TranscriptTurn {
  role: "user" | "agent";
  text: string;
}

export const EXTRACTION_SYSTEM_PROMPT = [
  "You maintain the memory of a hospital's phone agents. You read ONE finished call transcript and extract what is worth remembering for FUTURE calls.",
  "Output ONLY a JSON object, no prose, no code fence, exactly: " +
    '{"patientFacts":[{"key":"","category":"","text":"","confidence":0.0,"evidence":""}],"resolvedKeys":[""],"lessons":[{"category":"","text":"","confidence":0.0,"evidence":"","general":false,"clinical":false}]}',
  "",
  "patientFacts — durable things the PATIENT said about themselves or their situation that a future caller should know:",
  `- category is one of: ${PATIENT_CATEGORIES.join(", ")}.`,
  "- key is a short stable snake_case slug for the topic (e.g. preferred_call_time, knee_pain, medicine_adherence, caregiver). Use only words the patient said — never put a drug name, diagnosis or detail in a key that was not in the call. If KNOWN PATIENT FACTS already has that topic, REUSE its key so it is updated, not duplicated.",
  "- If a KNOWN fact has changed (e.g. the pain is now gone, they now take the tablets), output the SAME key with the new situation (\"Knee pain has resolved\") instead of using resolvedKeys, so the history stays useful.",
  "- text is one plain English sentence in third person (\"Prefers calls after 6 pm\"), written in English even if the call was in another language.",
  "- evidence is a SHORT EXACT quote copied from a PATIENT line (original language, max 20 words). No exact quote from the patient = do not include the fact.",
  "- confidence 0-1: how clearly the patient stated it. Never infer a symptom, diagnosis, medicine or preference that was not said.",
  "- Skip small talk, greetings and anything only the AGENT said.",
  "",
  "resolvedKeys — ONLY keys of KNOWN PATIENT FACTS that were wrong or should be forgotten entirely (e.g. the patient corrected a mistake, or a wrong number/person). Otherwise [].",
  "",
  "lessons — at most 3 reusable lessons about how an AGENT should handle calls like this, drawn from what happened (what worked, what confused or upset the patient, what was missed):",
  `- category is one of: ${LESSON_CATEGORIES.join(", ")}.`,
  "- Phrase as an instruction to the agent (\"Ask for a pain score before offering a visit\").",
  "- MUST NOT contain the patient's name, phone number, or any personal detail; it must make sense for a different patient.",
  "- evidence is a short exact quote from the transcript (either side) that shows it.",
  "- general=true only if the lesson would help every agent of the hospital, not just this one (informational only).",
  "- clinical=true if the lesson gives MEDICAL guidance: advising a patient what to do about symptoms, medicines or emergencies, or handling a medical red flag. Lessons about scheduling, tone, language or information are clinical=false.",
  "- If nothing useful happened, return an empty list.",
  "",
  "If the call has nothing worth keeping, return {\"patientFacts\":[],\"resolvedKeys\":[],\"lessons\":[]}.",
].join("\n");

export function formatTranscript(turns: TranscriptTurn[]): string {
  return turns.map((t) => `${t.role === "user" ? "PATIENT" : "AGENT"}: ${t.text}`).join("\n");
}

export function buildExtractionUserPrompt(turns: TranscriptTurn[], known: Pick<Learning, "key" | "text">[], agentName?: string): string {
  const knownBlock = known.length
    ? known.filter((k) => k.key).map((k) => `- ${k.key}: ${k.text}`).join("\n")
    : "(none yet)";
  return [`AGENT NAME: ${agentName ?? "unknown"}`, `KNOWN PATIENT FACTS:\n${knownBlock}`, `TRANSCRIPT:\n${formatTranscript(turns)}`].join("\n\n");
}

function strip(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function clamp01(n: unknown, fallback = 0.6): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function slug(s: string): string {
  return normalize(s).replace(/ /g, "_").slice(0, 60);
}

export interface ValidationContext {
  patientText: string;
  fullText: string;
  identifiers: { names?: string[]; phones?: string[] };
  minConfidence?: number;
}

/** Parses the model's JSON and drops everything that is not grounded or that leaks identity. */
export function validateExtraction(raw: string, ctx: ValidationContext): { extraction: Extraction; rejected: string[] } {
  const rejected: string[] = [];
  const empty: Extraction = { patientFacts: [], resolvedKeys: [], lessons: [] };
  let parsed: any;
  try {
    const text = strip(raw);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    parsed = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    return { extraction: empty, rejected: ["unparseable"] };
  }
  const min = ctx.minConfidence ?? 0.5;

  const patientFacts: ExtractedFact[] = [];
  for (const f of Array.isArray(parsed.patientFacts) ? parsed.patientFacts : []) {
    if (!f || typeof f.text !== "string" || typeof f.evidence !== "string") continue;
    const category = (PATIENT_CATEGORIES as readonly string[]).includes(f.category) ? f.category : "personal_context";
    const confidence = clamp01(f.confidence);
    const key = slug(typeof f.key === "string" && f.key ? f.key : f.text.split(" ").slice(0, 4).join(" "));
    if (!f.text.trim() || !key) continue;
    if (confidence < min) { rejected.push(`low-confidence: ${f.text}`); continue; }
    if (!isGrounded(f.evidence, ctx.patientText)) { rejected.push(`ungrounded fact: ${f.text}`); continue; }
    patientFacts.push({ key, category, text: f.text.trim().slice(0, 300), confidence, evidence: f.evidence.trim().slice(0, 300) });
  }

  const lessons: ExtractedLesson[] = [];
  for (const l of Array.isArray(parsed.lessons) ? parsed.lessons.slice(0, 3) : []) {
    if (!l || typeof l.text !== "string" || typeof l.evidence !== "string") continue;
    const category = (LESSON_CATEGORIES as readonly string[]).includes(l.category) ? l.category : "approach";
    const confidence = clamp01(l.confidence);
    if (confidence < min) { rejected.push(`low-confidence lesson: ${l.text}`); continue; }
    if (!isGrounded(l.evidence, ctx.fullText)) { rejected.push(`ungrounded lesson: ${l.text}`); continue; }
    if (containsIdentifiers(l.text, ctx.identifiers)) { rejected.push(`lesson leaks identity: ${l.text}`); continue; }
    lessons.push({ category, text: l.text.trim().slice(0, 300), confidence, evidence: l.evidence.trim().slice(0, 300), general: l.general === true, clinical: l.clinical === true });
  }

  const resolvedKeys = (Array.isArray(parsed.resolvedKeys) ? parsed.resolvedKeys : []).filter((k: unknown) => typeof k === "string" && k).map((k: string) => slug(k));
  return { extraction: { patientFacts, resolvedKeys, lessons }, rejected };
}

/** Real extractor: one LLM call (raw JSON) over the transcript. */
export async function extractWithLlm(args: {
  clientId: string;
  turns: TranscriptTurn[];
  known: Pick<Learning, "key" | "text">[];
  agentName?: string;
}): Promise<string> {
  const reply = await generateReply({
    system: EXTRACTION_SYSTEM_PROMPT,
    user: buildExtractionUserPrompt(args.turns, args.known, args.agentName),
    clientId: args.clientId,
    useTools: false,
    raw: true,
    maxOutputTokens: 1200,
  });
  return reply.text;
}
