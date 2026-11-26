import { generateReply } from "./llm";

/**
 * The doctor's chatbot. A doctor describes in plain words what they want the phone agent to do on calls with
 * their patients ("ask Mr. Rao about swelling around the stitches every call"). The assistant asks a clarifying
 * question when it's vague, otherwise turns it into a short, safe instruction — a PROPOSAL. Nothing reaches a live
 * call until a hospital admin approves it (lib/db/instruction-requests.ts), and even then it sits under the
 * agent's core rules and safety behaviour.
 */

export interface AssistantTurn {
  role: "doctor" | "assistant";
  content: string;
}

export interface InstructionProposal {
  title: string;
  instruction: string;
}

export interface AssistantResult {
  reply: string;
  proposal: InstructionProposal | null;
  /** true when the model was unreachable and the doctor's own words were used. */
  fallback?: boolean;
}

export const MIN_INSTRUCTION_CHARS = 12;
export const MAX_INSTRUCTION_CHARS = 700;

const INJECTION_RE =
  /(ignore (all |any |the )?(previous|prior|above|earlier|safety|core)|disregard|forget (all |the |your )?(rules|instructions|previous)|system prompt|you are now|act as (a |an )?(?!nurse|friendly)|jailbreak|override (the )?(rules|safety|guard)|reveal (the |your )?(prompt|instructions|rules)|pretend (to be|you))/i;
const OVERREACH_RE =
  /((increase|decrease|double|halve|change|skip|stop|reduce|adjust)\s+(the\s+|his\s+|her\s+|their\s+|your\s+)?(dose|dosage|medication|medicine|tablets?|pills?)|\bprescribe\b|\bdiagnos(e|is|ing)\b|tell (him|her|them|the patient) (to )?(stop|skip|double|take (more|extra))|(cancel|ignore) (the )?(emergency|escalation|safety))/i;

export type SanitizeResult = { ok: true; text: string } | { ok: false; reason: string };

/** Last line of defence before an instruction is stored: it must be short, plain, and not try to rewrite the agent's
 * rules or clinical boundaries. (An admin still reviews it.) */
export function sanitizeInstruction(raw: string): SanitizeResult {
  const text = raw.replace(/\s+/g, " ").replace(/[<>`]/g, "").trim();
  if (text.length < MIN_INSTRUCTION_CHARS) return { ok: false, reason: "That is too short to be a useful instruction. Say what the agent should ask or do." };
  if (text.length > MAX_INSTRUCTION_CHARS) return { ok: false, reason: `Keep it under ${MAX_INSTRUCTION_CHARS} characters — one clear request at a time.` };
  if (INJECTION_RE.test(text)) return { ok: false, reason: "Instructions can't change the agent's rules or ask it to reveal them." };
  if (OVERREACH_RE.test(text)) {
    return {
      ok: false,
      reason: "The agent can't diagnose, prescribe, or change medicines. Ask it to ask about symptoms or doses taken, or to have the patient contact you.",
    };
  }
  return { ok: true, text };
}

const SYSTEM_PROMPT = `You help a doctor write instructions for a hospital's AI phone agent that calls their patients.
The doctor writes in plain words. Reply with ONLY a JSON object, no other text:
{"reply": "<one or two short sentences to the doctor>", "proposal": null | {"title": "<3-8 words>", "instruction": "<the instruction, 1-3 sentences, addressed to the phone agent>"}}

Rules:
- If the request is vague or missing something essential (which symptom? how often? which patient?), set "proposal" to null and ask ONE clarifying question in "reply".
- Otherwise write the instruction in plain, imperative language ("Ask whether the swelling around the stitches has gone down, once per call.").
- The agent may ask questions, remind, record answers, and escalate to the care team. It must NEVER diagnose, prescribe, change doses, promise outcomes, or give emergency advice beyond "contact the care team / emergency services".
- If the doctor asks for any of those, keep the safe part (e.g. "ask how many tablets they took") and say in "reply" what you left out.
- Never include patient identifiers other than what the doctor wrote. Match the doctor's language in "reply"; write the instruction in English.`;

function parseModelJson(text: string): { reply?: unknown; proposal?: unknown } | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function interpretAssistantReply(text: string): AssistantResult | null {
  const parsed = parseModelJson(text);
  if (!parsed || typeof parsed.reply !== "string") return null;
  let proposal: InstructionProposal | null = null;
  const p = parsed.proposal as { title?: unknown; instruction?: unknown } | null | undefined;
  if (p && typeof p.instruction === "string") {
    const clean = sanitizeInstruction(p.instruction);
    if (clean.ok) {
      proposal = { title: (typeof p.title === "string" && p.title.trim() ? p.title.trim() : "Doctor instruction").slice(0, 120), instruction: clean.text };
    } else {
      return { reply: clean.reason, proposal: null };
    }
  }
  return { reply: parsed.reply.trim().slice(0, 600), proposal };
}

export async function runDoctorAssistant(input: {
  clientId: string;
  messages: AssistantTurn[];
  patientName?: string | null;
}): Promise<AssistantResult> {
  const recent = input.messages.slice(-10);
  const lastDoctor = [...recent].reverse().find((m) => m.role === "doctor")?.content ?? "";
  const user =
    (input.patientName ? `The instruction is for one patient: ${input.patientName}.\n` : "The instruction applies to all of this doctor's patients.\n") +
    "Conversation so far:\n" +
    recent.map((m) => `${m.role === "doctor" ? "DOCTOR" : "ASSISTANT"}: ${m.content}`).join("\n");

  try {
    const out = await generateReply({
      system: SYSTEM_PROMPT,
      user,
      clientId: input.clientId,
      useTools: false,
      raw: true,
      fastModel: true,
      maxOutputTokens: 400,
    });
    const interpreted = interpretAssistantReply(out.text);
    if (interpreted) return interpreted;
  } catch (err) {
    console.warn("[doctor-assistant] model unavailable, using the doctor's own wording:", err instanceof Error ? err.message : err);
  }

  // Model unreachable or unparsable: let the doctor's own words through the same safety check, so work isn't lost.
  const clean = sanitizeInstruction(lastDoctor);
  if (!clean.ok) return { reply: clean.reason, proposal: null, fallback: true };
  return {
    reply: "The assistant is unavailable, so I've used your wording as written. Check it, then submit it for admin approval.",
    proposal: { title: "Doctor instruction", instruction: clean.text },
    fallback: true,
  };
}
