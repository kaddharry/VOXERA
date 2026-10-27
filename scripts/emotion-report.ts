/**
 * Emotion report for one call — every patient turn with what the emotion
 * engine decided and why, plus per-turn timing against the 300ms target.
 *
 *   npx tsx --env-file=.env.local scripts/emotion-report.ts            # latest phone call
 *   npx tsx --env-file=.env.local scripts/emotion-report.ts <id>       # a session id (tel-…) or Twilio CallSid (CA…)
 *
 * Writes emotion-report-<session id>.md in the current folder and prints
 * where it went. Reads session_logs (written by lib/agent/orchestrator.ts)
 * and call_logs; it never changes anything.
 *
 * For the per-engine columns (keyword list, local text model, voice
 * heuristic) set EMOTION_DIAGNOSTICS=on in .env.local before the call.
 * Without it the report still shows the text side, the voice side and the
 * fused result for each turn.
 */
import { writeFileSync } from "fs";
import { supabase } from "../lib/db/supabase";
import { describeCallEmotion, summarizeCallEmotion, type TurnEmotion } from "../lib/emotion/call-emotion";

const LATENCY_TARGET_MS = 300;

export type Row = { ts: number; type: string; payload: Record<string, any> };

interface Turn {
  id?: string;
  patient: string;
  agent?: string;
  emotion?: Record<string, any>;
  acoustic?: Record<string, any>;
  cai?: Record<string, any>;
  policy?: Record<string, any>;
  diagnostic?: Record<string, any>;
}

async function findSession(arg?: string): Promise<{ sessionId: string; call?: Record<string, any> }> {
  if (arg && !arg.startsWith("CA")) {
    const { data } = await supabase.from("call_logs").select("*").eq("sessionId", arg).maybeSingle();
    return { sessionId: arg, call: data ?? undefined };
  }
  let query = supabase.from("call_logs").select("*").not("sessionId", "is", null);
  query = arg ? query.eq("id", arg) : query.order("startedAt", { ascending: false }).limit(1);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read call_logs: ${error.message}`);
  const call = data?.[0];
  if (!call) throw new Error(arg ? `No call found for ${arg}.` : "No phone call with a recorded session found.");
  return { sessionId: call.sessionId, call };
}

async function loadEvents(sessionId: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("session_logs")
      .select("ts, type, payload")
      .eq("sessionId", sessionId)
      .order("ts", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`Could not read session_logs: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return rows;
  }
}

export function groupTurns(rows: Row[]): Turn[] {
  const turns: Turn[] = [];
  const diagnostics: Record<string, any>[] = [];
  // Turn ids are collected first: an event can be stored a moment before
  // its own sentence (both are written in the same millisecond, in no
  // guaranteed order), and must still land on that sentence.
  const byId = new Map<string, Turn>();
  for (const { type, payload } of rows) {
    if (type === "utterance" && payload.role === "user" && payload.utteranceId) {
      byId.set(payload.utteranceId, { id: payload.utteranceId, patient: String(payload.text ?? "") });
    }
  }
  let current: Turn | undefined;
  for (const { type, payload } of rows) {
    if (type === "utterance" && payload.role === "user") {
      const turn: Turn = (payload.utteranceId && byId.get(payload.utteranceId)) || { patient: String(payload.text ?? "") };
      current = turn;
      turns.push(turn);
    } else if (type === "emotion_diagnostic") {
      diagnostics.push(payload); // logged when ready, possibly after later events — matched by text below
    } else {
      // Per-turn events carry their utterance's id (calls since it was
      // added); older ones fall back to "the latest patient turn so far".
      const turn = (payload.utteranceId && byId.get(payload.utteranceId)) || current;
      if (!turn) continue;
      if (type === "utterance" && payload.role !== "user") {
        if (current) current.agent = current.agent ? `${current.agent} ${payload.text}` : String(payload.text ?? "");
      } else if (type === "emotion") turn.emotion = payload;
      else if (type === "acoustic") turn.acoustic = payload;
      else if (type === "cai") turn.cai = payload;
      else if (type === "policy") turn.policy = payload;
    }
  }
  for (const diagnostic of diagnostics) {
    const turn = turns.find((t) => !t.diagnostic && t.patient === diagnostic.text);
    if (turn) turn.diagnostic = diagnostic;
  }
  return turns;
}

const cell = (value: unknown) => String(value ?? "—").replace(/\|/g, "/").replace(/\s+/g, " ").trim() || "—";
const pct = (n: number) => (n == null || Number.isNaN(n) ? "—" : `${Math.round(n * 100)}%`);
const num = (n: unknown, digits = 0) => (typeof n === "number" ? n.toFixed(digits) : "—");
const verdict = (s?: { label?: string | null; confidence?: number | null } | null) =>
  s && s.label ? `${s.label} (${pct(s.confidence ?? NaN)})` : "—";
const engine = (d?: Record<string, any> | null) =>
  !d ? "—" : d.available === false ? "off" : `${d.label ?? "—"} (${pct(d.confidence ?? NaN)}, ${num(d.latencyMs)}ms)`;

function followed(e?: Record<string, any>): string {
  if (!e?.label) return "—";
  if (!e.audioSignal) return "words only";
  const byText = e.textSignal?.label === e.label;
  const byVoice = e.audioSignal?.label === e.label;
  return byText && byVoice ? "both agree" : byText ? "words" : byVoice ? "voice" : "neither";
}

export function buildReport(sessionId: string, call: Record<string, any> | undefined, turns: Turn[]): string {
  const out: string[] = [];
  const started = call?.startedAt ? new Date(Number(call.startedAt)).toLocaleString("en-IN") : "—";
  out.push(`# Emotion report — ${sessionId}`, "");
  out.push(`- Call: ${call?.id ?? "—"} · started ${started} · ${call?.durationMs ? `${Math.round(call.durationMs / 1000)}s` : "—"} · status ${call?.status ?? "—"}`);
  out.push(`- Patient turns: ${turns.length}`);
  out.push(`- Per-engine diagnostics: ${turns.some((t) => t.diagnostic) ? "on" : "off (set EMOTION_DIAGNOSTICS=on in .env.local before the call to include them)"}`, "");

  const timed = turns.map((t) => t.emotion?.latencyMs?.total).filter((n): n is number => typeof n === "number");
  const labels = new Map<string, number>();
  for (const t of turns) if (t.emotion?.label) labels.set(t.emotion.label, (labels.get(t.emotion.label) ?? 0) + 1);
  const withVoice = turns.filter((t) => t.emotion?.audioSignal);
  const agree = withVoice.filter((t) => t.emotion?.audioSignal?.label === t.emotion?.textSignal?.label).length;

  out.push("## Summary", "");
  const callEmotion = summarizeCallEmotion(turns.map((t) => t.emotion).filter((e): e is TurnEmotion => !!e?.label));
  out.push(`- Whole call: ${callEmotion ? describeCallEmotion(callEmotion) : "—"}`);
  out.push(`- Final emotions: ${[...labels].map(([l, n]) => `${l} ×${n}`).join(", ") || "—"}`);
  out.push(`- Words vs voice agreed on ${withVoice.length ? `${agree} of ${withVoice.length} turns` : "— (no voice reading recorded)"}`);
  out.push(
    timed.length
      ? `- Emotion time per turn: average ${Math.round(timed.reduce((a, b) => a + b, 0) / timed.length)}ms, slowest ${Math.max(...timed)}ms, ${timed.filter((n) => n < LATENCY_TARGET_MS).length} of ${timed.length} under ${LATENCY_TARGET_MS}ms`
      : "- Emotion time per turn: not recorded (call was made before timing was added)"
  );
  out.push(`- Turns that escalated: ${turns.filter((t) => t.policy?.escalate && t.policy.escalate !== "none").length}`, "");

  out.push("## Turn by turn", "");
  out.push("| # | Patient said | Final emotion | Words → | Voice → | Followed | Time | Agent response style |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  turns.forEach((t, i) => {
    const e = t.emotion;
    const final = e?.label ? `${e.label} (intensity ${num(e.intensity, 2)}, conf ${pct(e.confidence)})` : "—";
    const words = e?.textSignal ? `${verdict(e.textSignal)} via ${e.textSignal.engine}` : "—";
    const style = t.policy
      ? [t.policy.acknowledgeFirst && "acknowledge first", `pace ${t.policy.pace}`, t.policy.escalate !== "none" && `escalate ${t.policy.escalate}`].filter(Boolean).join(", ")
      : "—";
    out.push(`| ${i + 1} | ${cell(t.patient)} | ${cell(final)} | ${cell(words)} | ${cell(verdict(e?.audioSignal))} | ${followed(e)} | ${e?.latencyMs ? `${e.latencyMs.total}ms` : "—"} | ${cell(style)} |`);
  });

  out.push("", "## Voice measurements", "");
  out.push("| # | Pitch (Hz) | Pitch variation | Energy (RMS) | Speaking rate (wpm) | Pauses | Engagement (CAI) |");
  out.push("| --- | --- | --- | --- | --- | --- | --- |");
  turns.forEach((t, i) => {
    const a = t.acoustic ?? {};
    out.push(`| ${i + 1} | ${num(a.pitchHz)} | ${num(a.pitchVariation, 2)} | ${num(a.rmsEnergy)} | ${num(a.speakingRateWPM)} | ${a.pauseCount ?? "—"} (${num(a.pauseDurationMs)}ms) | ${t.cai ? `${num(t.cai.score, 2)} ${t.cai.category ?? ""}` : "—"} |`);
  });

  if (turns.some((t) => t.diagnostic)) {
    out.push("", "## Every engine's verdict", "");
    out.push("| # | Keyword list | Local text model | Voice heuristic | Matched keywords |");
    out.push("| --- | --- | --- | --- | --- |");
    turns.forEach((t, i) => {
      const d = t.diagnostic;
      out.push(`| ${i + 1} | ${engine(d?.lexicon)} | ${engine(d?.localOnnx)} | ${engine(d?.acoustic)} | ${cell(d?.lexicon?.matchedKeywords?.join(", "))} |`);
    });
  }

  out.push("", "## Agent replies", "");
  turns.forEach((t, i) => out.push(`${i + 1}. **Patient:** ${t.patient}  \n   **Agent:** ${t.agent ?? "—"}`));
  return out.join("\n") + "\n";
}

async function main() {
  const { sessionId, call } = await findSession(process.argv[2]);
  const turns = groupTurns(await loadEvents(sessionId));
  if (turns.length === 0) throw new Error(`Session ${sessionId} has no patient turns recorded.`);
  const file = `emotion-report-${sessionId}.md`;
  writeFileSync(file, buildReport(sessionId, call, turns));
  console.log(`Wrote ${file} (${turns.length} patient turns).`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/emotion-report.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
