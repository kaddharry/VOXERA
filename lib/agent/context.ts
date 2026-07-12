import type { EmotionContext, MemoryRecord, PolicyDirectives, RetrievedContext, Utterance } from "../types";
import { policyToPrompt } from "./policy";
import { getEmotionPersona, formatPersonaBlock } from "../emotion/persona";

// Character-based budget approximation. Assumes ~4 chars/token.
const BUDGET_CHARS = 24000;

export interface LLMContext {
  system: string;
  user: string;
  citations: string[];
}

export function buildLLMContext(args: {
  userId: string;
  clientId: string;
  userTurn: Utterance;
  retrieved: RetrievedContext;
  emotion: EmotionContext;
  policy: PolicyDirectives;
}): LLMContext {
  const { retrieved, emotion, policy, userTurn } = args;

  const clientBlock = truncate(
    formatRecords("CLIENT", retrieved.ltmClient, ["brand_voice", "compliance", "escalation"]),
    1600,
  );
  const timelineBlock = retrieved.timeline && retrieved.timeline.length > 0
    ? truncate(formatTimeline(retrieved.timeline), 7200)
    : "";

  const userLtmBlock = timelineBlock
    ? "" // Grouped in timeline instead of isolated records
    : truncate(formatRecords("USER_PROFILE", retrieved.ltmUser), 1200);

  const evidenceBlock = timelineBlock
    ? timelineBlock
    : truncate(formatEvidence(retrieved.mtm), 6000);

  const emotionBlock = formatEmotion(emotion);
  const policyBlock = policyToPrompt(policy);
  const stmBlock = truncate(formatStm(retrieved.stm, userTurn.id), 8000);

  // FR-11: Build dynamic emotion persona for this turn
  const persona = getEmotionPersona(emotion);
  const personaBlock = formatPersonaBlock(persona, emotion);

  const system = [
    "You are VOXERA, an AI voice receptionist. You MUST follow ALL of the rules below:",
    "",
    "=== EMOTIONAL PERSONA (HIGHEST PRIORITY) ===",
    personaBlock,
    "",
    "=== CORE RULES ===",
    "1. Answer ONLY using the EVIDENCE block + STM. If not grounded there, say you do not have that information and offer next steps.",
    "2. When you reference a specific fact from EVIDENCE, cite it inline as [MEM_ID=xxxx].",
    "3. Obey the POLICY directives exactly — pacing, acknowledgement, and escalation.",
    "4. Voice-style: short sentences, natural prosody, ≤ 3 sentences unless detail was requested.",
    "5. Never invent ticket numbers, dates, account details, or policy facts.",
    "",
    clientBlock,
    "",
    userLtmBlock,
  ]
    .filter(Boolean)
    .join("\n");

  const citations = retrieved.mtm.map((m) => m.id);

  const user = [
    timelineBlock ? "=== CHRONOLOGICAL EVENT TIMELINE ===" : "=== EVIDENCE ===",
    evidenceBlock || (timelineBlock ? "(no timeline events)" : "(no user-specific evidence)"),
    "",
    "=== EMOTION ===",
    emotionBlock,
    "",
    "=== POLICY ===",
    policyBlock,
    "",
    "=== STM (recent turns) ===",
    stmBlock,
    "",
    "=== CURRENT TURN ===",
    `USER: ${userTurn.text}${userTurn.sttConfidence != null ? ` [stt_conf=${userTurn.sttConfidence.toFixed(2)}]` : ""}`,
  ].join("\n");

  // Hard cap on total chars.
  const totalChars = system.length + user.length;
  if (totalChars > BUDGET_CHARS) {
    const over = totalChars - BUDGET_CHARS;
    return { system, user: truncate(user, user.length - over), citations };
  }
  return { system, user, citations };
}

function formatRecords(kind: string, recs: MemoryRecord[], preferredTopics?: string[]): string {
  if (recs.length === 0) return "";
  const sorted = preferredTopics
    ? [...recs].sort((a, b) => Number(preferredTopics.includes(b.topic)) - Number(preferredTopics.includes(a.topic)))
    : recs;
  const lines = sorted.map((r) => `- [${r.topic}] ${r.summary}`);
  return `=== ${kind} ===\n${lines.join("\n")}`;
}

function formatTimeline(events: any[]): string {
  if (events.length === 0) return "";
  return events
    .map((evt) => {
      const startStr = new Date(evt.startDate).toLocaleDateString();
      const endStr = new Date(evt.endDate).toLocaleDateString();
      const dateRange = startStr === endStr ? startStr : `${startStr} to ${endStr}`;
      const memLines = evt.memories
        .map((m: any) => {
          const ageDays = Math.round((Date.now() - m.ts) / (1000 * 60 * 60 * 24));
          const scoreStr = (m.importance_score ?? m.importance).toFixed(2);
          return `  - [MEM_ID=${m.id}] (${ageDays}d ago, topic=${m.topic}, emotion=${m.emotion}, importance_score=${scoreStr}) ${m.summary}`;
        })
        .join("\n");
      return `=== Event: ${evt.topic.toUpperCase()} (${dateRange}) ===\n${memLines}`;
    })
    .join("\n\n");
}

function formatEvidence(recs: MemoryRecord[]): string {
  if (recs.length === 0) return "";
  return recs
    .map((r) => {
      const ageDays = Math.round((Date.now() - r.ts) / (1000 * 60 * 60 * 24));
      const scoreStr = (r.importance_score ?? r.importance).toFixed(2);
      return `[MEM_ID=${r.id}] (${ageDays}d ago, topic=${r.topic}, emotion=${r.emotion}, I=${scoreStr}, recurrence=${r.recurrence})\n  ${r.summary}`;
    })
    .join("\n");
}

function formatEmotion(ec: EmotionContext): string {
  const f = ec.flags;
  const flags = Object.entries(f)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ") || "none";
  return [
    `label=${ec.current.label} intensity=${ec.current.intensity.toFixed(2)} conf=${ec.current.confidence.toFixed(2)}`,
    `VAD=(${ec.current.vad.v.toFixed(2)}, ${ec.current.vad.a.toFixed(2)}, ${ec.current.vad.d.toFixed(2)})`,
    `slope_v=${ec.trajectory.slope_v.toFixed(3)} slope_a=${ec.trajectory.slope_a.toFixed(3)}`,
    `zDev=${ec.zDeviation.toFixed(2)} flags: ${flags}`,
  ].join(" | ");
}

function formatStm(turns: Utterance[], currentTurnId: string): string {
  const prior = turns.filter((t) => t.id !== currentTurnId);
  if (prior.length === 0) return "(no prior turns)";
  return prior
    .map((t) => {
      const emo = t.emotion ? ` <${t.emotion.label}:${t.emotion.intensity.toFixed(2)}>` : "";
      return `${t.role.toUpperCase()}${emo}: ${t.text}`;
    })
    .join("\n");
}

function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 3) + "...";
}
