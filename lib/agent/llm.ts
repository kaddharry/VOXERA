// The `openai` package is used only as an OpenAI-COMPATIBLE client: every
// provider in CONFIG.llm.providers (Groq, ZenMux) sets its own baseURL. VOXERA
// makes no direct calls to the OpenAI API and needs no OpenAI key.
import { BOOKING_HINT, isMedicationTurn } from "./booking-intent";
import OpenAI from "openai";
import { CONFIG } from "../config";
import { getKeyRotator } from "../util/keys";
import { TOOLS, CARE_TOOL_NAMES, dispatchToolCall, getToolsForAgentWithMCP } from "./tools";
import { runBackgroundAction, markAnnounced } from "./background-actions";
import { ClauseChunker } from "./clause-chunker";
import { isReasoningClause, isWrongIndicScript, matchSpeakerGender, stripForeignScript, stripReasoningLeak, stripWrappingQuotes } from "./reply-hygiene";

/**
 * One OpenAI-compatible client per (baseURL, key, timeout), reused across
 * turns. A fresh `new OpenAI()` for every turn (the previous behavior) meant
 * a cold connection to the provider — DNS + TCP + TLS, typically 100-300ms —
 * paid on the critical path of every single reply. The SDK sits on Node's
 * pooled fetch, so a long-lived client keeps that connection warm.
 */
const clientCache = new Map<string, OpenAI>();
function getClient(apiKey: string, baseURL: string, timeout: number): OpenAI {
  const key = `${baseURL}|${apiKey}|${timeout}`;
  let client = clientCache.get(key);
  if (!client) {
    client = new OpenAI({ apiKey, baseURL, timeout, maxRetries: 1 });
    clientCache.set(key, client);
  }
  return client;
}

let lastPrewarmAt = 0;
/**
 * Opens (or refreshes) the connection to the primary LLM provider before the
 * reply is needed. Called when a call connects and again the moment the
 * caller starts talking, so by the time their sentence ends the TLS session
 * is already warm. Cheap (a models-list GET), rate-limited, fire-and-forget,
 * and never throws.
 */
export function prewarmLlm(): void {
  const now = Date.now();
  if (now - lastPrewarmAt < 3_000) return;
  lastPrewarmAt = now;
  const provider = CONFIG.llm.providers[0];
  if (!provider) return;
  const apiKey = getKeyRotator(provider.envKey).getKey();
  if (!apiKey) return;
  void fetch(`${provider.baseURL}/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(4_000),
  })
    .then((res) => res.arrayBuffer())
    .catch(() => undefined);
}

export interface LLMReply {
  text: string;
  model: string;
  usedLive: boolean;
  provider?: string;
}

/** Same "English" code set as lib/emotion/detect.ts's ENGLISH_LANGUAGE_CODES
 * (not imported from there to avoid coupling this module to the emotion
 * package for one constant) — undefined/unset is treated as English, same
 * as everywhere else this distinction is made. */
const ENGLISH_LANGUAGE_CODES = new Set(["en", "en-IN", "en-US", "English"]);
function isEnglishLanguage(language: string | undefined): boolean {
  return !language || ENGLISH_LANGUAGE_CODES.has(language);
}

/** Accumulates OpenAI-compatible streamed chunk deltas into the same
 * `message` shape the non-streaming code path already works with (content +
 * tool_calls), so everything downstream of a completion call (the tool-loop
 * branch, sanitizeReply, etc.) stays identical whether or not streaming is
 * in use. `onContentDelta` fires per raw text delta as it arrives — the
 * caller feeds it into a ClauseChunker to get sentence-level chunks instead
 * of raw token deltas. */
const STREAM_IDLE_MS = 6_000;

/** True when a clause ends a sentence (., !, ?, Hindi danda, ellipsis), ignoring closing quotes/space. */
export function endsSentence(text: string): boolean {
  return /[.!?।॥…]["'”’)\]]*\s*$/.test(text);
}

/** A reply that stopped at the token limit, cut back to its last full sentence (unchanged if it has none). */
export function trimToLastSentence(text: string): string {
  if (endsSentence(text)) return text;
  let cut = -1;
  for (const m of text.matchAll(/[.!?।॥…]["'”’)\]]*(?=\s)/g)) cut = (m.index ?? 0) + m[0].length;
  return cut > 0 ? text.slice(0, cut).trim() : text;
}

async function streamChatCompletion(
  openai: OpenAI,
  params: Record<string, unknown>,
  opts: { onContentDelta?: (delta: string) => void; signal?: AbortSignal; idleMs?: number }
): Promise<{ content: string; tool_calls?: any[]; truncated?: boolean }> {
  // Stall watchdog (replaces a whole-turn timeout): abort only when the
  // provider stops sending data for STREAM_IDLE_MS, never because a long but
  // healthy reply is still streaming. The old behaviour raced the ENTIRE
  // operation (full reply included) against 5s — a 4-sentence Hindi answer
  // "timed out" while still streaming, a second completion started on the
  // next key, and both wrote into the same clause chunker: live-observed as
  // 6-8s turns, replies glued from two generations ("किसकौन से डॉक्टर…") and
  // advice spoken twice.
  const ac = new AbortController();
  const onExternalAbort = () => ac.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  let stalled = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stalled = true;
      ac.abort();
    }, opts.idleMs ?? STREAM_IDLE_MS);
  };
  armIdle();

  let content = "";
  // finish_reason "length" = the model hit max_tokens and stopped mid-sentence.
  let truncated = false;
  const toolCallsByIndex: Record<number, { id?: string; type?: string; function: { name?: string; arguments: string } }> = {};

  try {
  const stream = (await openai.chat.completions.create(
    { ...params, stream: true } as any,
    { signal: ac.signal }
  )) as unknown as AsyncIterable<any>;

  for await (const chunk of stream) {
    armIdle();
    if (chunk.choices?.[0]?.finish_reason === "length") truncated = true;
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      content += delta.content;
      opts.onContentDelta?.(delta.content);
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallsByIndex[idx]) {
          toolCallsByIndex[idx] = { id: tc.id, type: tc.type ?? "function", function: { name: tc.function?.name, arguments: "" } };
        }
        if (tc.id) toolCallsByIndex[idx].id = tc.id;
        if (tc.function?.name) toolCallsByIndex[idx].function.name = tc.function.name;
        if (tc.function?.arguments) toolCallsByIndex[idx].function.arguments += tc.function.arguments;
      }
    }
  }

  } catch (err) {
    if (stalled && !opts.signal?.aborted) {
      throw new Error(`Stream stalled — no data for ${opts.idleMs ?? STREAM_IDLE_MS}ms (timeout)`);
    }
    throw err;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }

  const toolCallsArr = Object.values(toolCallsByIndex);
  return {
    content,
    truncated,
    tool_calls: toolCallsArr.length > 0
      ? toolCallsArr.map((tc, i) => ({ id: tc.id ?? `call_${i}`, type: "function", function: { name: tc.function.name ?? "", arguments: tc.function.arguments } }))
      : undefined,
  };
}

/** A tool call the model wrote as TEXT instead of really calling it, in any of the shapes seen live:
 * "</tool_call>", "[Tool call: check_appointment_availability {providerId: ...}]", a bare function name with
 * JSON-ish arguments. Spoken aloud it is nonsense, and nothing actually ran. */
const TOOL_NAME_RE = /\b(check_appointment_availability|book_appointment|reschedule_appointment|cancel_appointment|confirm_appointment|check_availability|create_booking|modify_booking|cancel_booking)\b/i;
export function looksLikeToolMarkup(text: string): boolean {
  return /<\/?tool_call|<function=|\[TOOL_CALLS?\]|\[\s*tool[\s_-]?call\b|\btool[\s_-]?call\s*:/i.test(text) || TOOL_NAME_RE.test(text) || /\b(providerId|startsAt|durationMinutes|appointmentId)\s*:/i.test(text);
}

const MARKUP_START_RE = new RegExp(`\\[\\s*tool[\\s_-]?call\\b|${TOOL_NAME_RE.source}|\\b(?:providerId|startsAt|durationMinutes|appointmentId)\\s*:`, "i");

/** Cuts a text-form tool call ("[Tool call: name {args}]", possibly split over several streamed clauses) out of
 * a clause, keeping the real speech around it. `open` carries "we are inside one" into the next clause. */
export function stripToolMarkup(raw: string, open: boolean): { text: string; open: boolean } {
  let text = raw;
  if (open) {
    const close = /[\]}]+/.exec(text);
    if (!close) return { text: "", open: true };
    text = text.slice(close.index + close[0].length);
  }
  const start = text.search(MARKUP_START_RE);
  if (start < 0) return { text, open: false };
  const prefix = text.slice(0, start);
  const rest = text.slice(start);
  const closers = [...rest.matchAll(/[\]}]+/g)];
  const last = closers[closers.length - 1];
  if (!last) return { text: prefix, open: true };
  const tail = stripToolMarkup(rest.slice(last.index! + last[0].length), false);
  return { text: prefix + tail.text, open: tail.open };
}


const MUTATING_TOOLS = new Set(["book_appointment", "reschedule_appointment", "cancel_appointment", "confirm_appointment", "create_booking", "modify_booking", "cancel_booking"]);

/** A short line spoken while a tool runs, so the caller never sits in silence
 * (a booking takes several seconds: model -> tool -> model). Written in the
 * caller's own script, and in neutral forms (no gendered verbs). */
export function toolFillerPhrase(toolName: string, callerText: string): string {
  const booking = /book|create|reschedule|modify|cancel|confirm/.test(toolName);
  if (/[\u0900-\u097F]/.test(callerText)) return booking ? "ठीक है, एक पल, इसे अभी बुक करते हैं।" : "एक पल, कैलेंडर देखते हैं।";
  if (/[\u0A00-\u0A7F]/.test(callerText)) return booking ? "ਠੀਕ ਹੈ, ਇੱਕ ਪਲ, ਹੁਣੇ ਬੁੱਕ ਕਰਦੇ ਹਾਂ।" : "ਇੱਕ ਪਲ, ਕੈਲੰਡਰ ਵੇਖਦੇ ਹਾਂ।";
  if (/[\u0A80-\u0AFF]/.test(callerText)) return booking ? "ઠીક છે, એક પળ, હમણાં બુક કરીએ છીએ." : "એક પળ, કેલેન્ડર જોઈએ છીએ.";
  return booking ? "Sure, one moment while I book that for you." : "One moment, let me check the calendar.";
}

export async function generateReply(args: {
  system: string;
  user: string;
  clientId: string;
  sessionId?: string;
  userId?: string;
  /** Overrides CONFIG.llm.maxOutputTokens for this call only — the default
   * is deliberately tight for voice-turn latency, but a few callers (e.g.
   * onboarding's prompt generator) need a longer, non-conversational reply. */
  maxOutputTokens?: number;
  /** Set false to skip tool-calling entirely — irrelevant (and just extra
   * latency/tokens) for one-off generation tasks like drafting a prompt,
   * as opposed to an actual live conversational turn. Defaults to true. */
  useTools?: boolean;
  /** For non-spoken generation (JSON drafts, summaries, insights). Skips
   * sanitizeReply, which is built for spoken lines: it drops lines that look
   * like reasoning, strips foreign-script words and rewrites "escalate", and
   * on a JSON reply that left fragments (the agent generator got back only its
   * greeting field and reported "returned something unexpected"). */
  raw?: boolean;
  /** Always use the small, fast model (its own quota, ~0.3 s): for short classification jobs that never need the big
   * reasoning model, whatever script the text is in. */
  fastModel?: boolean;
  /** An Agent Builder agent's tool allowlist (agents."enabledTools",
   * migration_v29.sql). When provided (even as []), the tool set offered to
   * the model is filtered down to exactly these names via getToolsForAgent
   * instead of the legacy demo path's full RESERVATION_TOOLS — see
   * lib/agent/orchestrator.ts's useTools call sites for why this exists. */
  enabledTools?: string[];
  /** Threaded through to dispatchToolCall's ToolCallContext so an
   * appointment tool can verify which patient it's acting on before
   * writing anything — see lib/agent/tools.ts's resolveVerifiedPatient. */
  patientId?: string;
  callerNumber?: string;
  /** Resolved call language (lib/speech/resolve.ts) — e.g. "en-IN", "hi-IN",
   * "hi-en", "auto". When set to anything non-English, the fast/no-reasoning
   * provider config (CONFIG.llm.providers' `reasoningEffort: "none"`,
   * chosen for English voice-turn latency) is bumped up a notch instead —
   * live-reproduced: qwen3.6-27b at reasoning_effort "none" produced
   * genuinely incoherent Hindi ("कसक और लालच भरने की शक्यता का खुलासा किया
   * गया है" — nonsense) replying to a plain symptom report, the kind of
   * word-salad hallucination that effort="none" is documented (see that
   * field's own comment in config.ts) to trade away for speed on the common
   * English case. Non-English generation needs that reasoning headroom back
   * more than it needs the extra latency savings. */
  language?: string;
  /** When provided, the completion is streamed and this fires with each
   * sanitized, sentence-level clause as soon as it's ready — letting a
   * caller start TTS on clause 1 while the LLM is still generating later
   * clauses. Only ever fires for the final, non-tool-call completion (tool
   * calls carry no spoken content). The function's return value is
   * unaffected either way — it still resolves with the full concatenated
   * reply text once everything is done, for logging/trace purposes. */
  onClause?: (clause: string) => void;
  /** Fires with the raw, un-guarded, running accumulated reply text on
   * every content delta the model streams back — genuinely token-by-token,
   * unlike onClause (which only fires once per complete sentence, on
   * roughly a multi-second cadence for a short reply). Purely for live
   * observability (the dashboard's "typing" effect) — TTS still speaks
   * clause-by-clause via onClause, since flushing audio synthesis per raw
   * token would sound choppy, not smoother. Never used for anything
   * safety-relevant: the text here is pre-guard/pre-citation-check, so it
   * must never be spoken or treated as final. */
  onRawDelta?: (textSoFar: string) => void;
  /** Cancels the in-flight completion (used for barge-in). Only meaningful
   * together with onClause — the non-streaming path has no long-running
   * request worth aborting mid-flight. */
  abortSignal?: AbortSignal;
}): Promise<LLMReply> {
  const streaming = !!args.onClause;
  // earlyFirstClause: start speaking at the first natural pause instead of
  // waiting for the whole first sentence — see ClauseChunker.
  let clauseChunker = streaming ? new ClauseChunker({ earlyFirstClause: true }) : null;
  // Accumulated raw text for onRawDelta — safe to keep scoped to the whole
  // call (not per-attempt): once anyClauseEmitted is true, the guard added
  // above prevents this function from ever reaching a second attempt at
  // streamChatCompletion, so this never silently resets mid-reply.
  let rawAccumulated = "";
  // A live caller is on the line waiting — the default retry budget
  // (3 attempts, 15s timeout each, up to 4s backoff between them) can burn
  // ~48 seconds retrying ONE degraded provider before ever falling over to
  // the next, which is exactly the "10-30s to answer, sometimes no answer
  // at all" failure mode reported on real calls. A voice turn's whole
  // round trip should be a couple seconds; a single attempt taking anywhere
  // near 15s already means this provider isn't going to give a usable
  // real-time reply, so fail fast and let the next provider in the list
  // (see CONFIG.llm.providers) take over instead of sitting on a request
  // that's already blown the caller's patience. Non-streaming callers
  // (onboarding's prompt generator, etc.) keep the original generous
  // defaults — they're not gating a live human's turn-taking.
  const retryBudget: [maxRetries: number, timeoutMs: number, backoffBaseMs: number] = streaming
    ? [2, 5_000, 300]
    : [3, 15_000, 1000];
  // If any clause has already been spoken from a provider's partial stream,
  // we can never fall back to a different provider for this turn — doing so
  // would speak two unrelated completions back to back. Tracked across the
  // whole function (not per-attempt) so a failure after streaming started
  // propagates instead of silently trying the next provider.
  let anyClauseEmitted = false;
  // Guards against a live-observed failure mode where a provider (seen on
  // ZenMux) streams its own full reply twice back-to-back in one
  // completion — every clause emitted verbatim a second time right after
  // the first. Scoped to the whole call (not per-provider) since a repeat
  // should never be spoken regardless of which attempt produced it.
  const seenClauses = new Set<string>();
  // Language the context builder pinned for this turn ("CALLER LANGUAGE THIS TURN: Bengali (...)").
  const callerLang = /CALLER LANGUAGE THIS TURN:\s*([A-Za-z]+)/.exec(args.user)?.[1];
  const speakerGender = /YOUR voice is (FEMALE|MALE)/.exec(args.system)?.[1]?.toLowerCase() as "female" | "male" | undefined;
  // While a text-form tool call is being streamed, every fragment of it (the chunker splits at commas)
  // must be swallowed, up to and including its closing bracket. Real speech around it is kept.
  let inToolMarkup = false;
  const emitClauseOnce = (raw: string, isFiller = false) => {
    if (!isFiller) {
      const stripped = stripToolMarkup(raw, inToolMarkup);
      if (stripped.text !== raw) console.warn(`[LLM] Removed tool-call text that was about to be spoken: "${raw.slice(0, 70)}"`);
      inToolMarkup = stripped.open;
      raw = stripped.text;
      if (!raw.trim()) return;
    }
    // A clause in the wrong Indic script (Bengali caller, Hindi reply). Before anything
    // is spoken, throw so the same turn is regenerated; once speech has started it
    // cannot be retried, so just skip the clause.
    if (isWrongIndicScript(raw, callerLang)) {
      console.warn(`[LLM] Wrong-script clause for caller language ${callerLang}: "${raw.slice(0, 60)}"`);
      if (!anyClauseEmitted) throw new Error("Reply script does not match caller language (timeout)");
      return;
    }
    // Planning text the model leaked into its visible output must never be
    // spoken (see reply-hygiene.ts) — dropped BEFORE it counts as "spoken".
    if (isReasoningClause(raw)) {
      console.warn(`[LLM] Dropped leaked reasoning clause: "${raw.slice(0, 80)}"`);
      return;
    }
    const cleaned = matchSpeakerGender(stripWrappingQuotes(sanitizeReply(raw)), speakerGender);
    const key = cleaned.toLowerCase();
    if (!cleaned || seenClauses.has(key)) return;
    seenClauses.add(key);
    // A filler ("one moment…") is not the reply: it must not block a retry of the real reply.
    if (!isFiller) anyClauseEmitted = true;
    args.onClause!(cleaned);
  };

  // ── Which model does THIS turn need? ──────────────────────────────────────────────────────────────
  // Every turn used the big reasoning model for tool agents and for "auto" language. That burns the scarce
  // per-model daily token quota (Groq on-demand: 200k/day) in ~50 turns and costs 1-5s of "thinking" per turn;
  // once exhausted every turn crawled through failing keys for 10-55s. Now the big model is used only when the
  // turn needs it, and the fast model (its own quota, ~0.3s to first word) handles the rest.
  const lastUserLine = [...args.user.matchAll(/^USER:\s*(.*)$/gm)].pop()?.[1] ?? "";
  const turnIsIndic = /[\u0900-\u0DFF]/.test(lastUserLine); // Hindi / Punjabi / Gujarati ... need the multilingual model
  // The call language can be Hindi (Devanagari) even on a turn the caller said in English ("ok, I understand"):
  // the reply is still Hindi, so it still needs the multilingual model.
  const callIsIndic = !!callerLang && callerLang !== "English" && callerLang !== "Hinglish";
  const explicitIndicSetting = !isEnglishLanguage(args.language) && args.language !== "auto";
  const toolAgentCfg = (args.useTools ?? true) && (args.enabledTools?.length ?? 0) > 0;
  // Only the live conversation counts: the recent turns + the caller's latest line. NOT the rest of the prompt —
  // the "TODAY ... tomorrow" line, the booking rules, patient notes and memories all mention appointments and
  // would make every turn look like a booking.
  const stmStart = args.user.indexOf("=== STM");
  const stmEnd = args.user.indexOf("=== CURRENT TURN");
  const recentTurns = stmStart >= 0 ? args.user.slice(stmStart, stmEnd > stmStart ? stmEnd : undefined) : "";
  const conversation = `${recentTurns}\n${lastUserLine}`;
  const bookingTurn = toolAgentCfg && BOOKING_HINT.test(conversation);
  const needStrong = !args.fastModel && (turnIsIndic || callIsIndic || explicitIndicSetting || bookingTurn);
  // Send tools only when the conversation is about booking: fewer tokens, and a chatty reply is never held up by tool rounds.
  const medicationTurn = toolAgentCfg && !bookingTurn && isMedicationTurn(conversation, args.system);
  const toolsAllowed = !toolAgentCfg || bookingTurn || medicationTurn;
  const canFallToFast = args.fastModel || (!turnIsIndic && !callIsIndic && !explicitIndicSetting); // the fast model writes poor Hindi, so never fall back to it for Hindi
  let modelOverride = "";

  for (const provider of CONFIG.llm.providers) {
    const modelOrder = (needStrong
      ? [provider.nonEnglishModel, canFallToFast ? provider.model : undefined]
      : args.fastModel ? [provider.model] : [provider.model, provider.nonEnglishModel]
    ).filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
    // Shared instance, not a fresh one per turn — see getKeyRotator's doc.
    // This is what lets the rotator remember which key already proved
    // exhausted (and for roughly how long) instead of re-probing every key
    // from index 0 again on every single turn.
    if (provider.nonEnglishOnly && isEnglishLanguage(args.language)) continue;
    const rotator = getKeyRotator(provider.envKey);
    if (!rotator.getKey()) continue;

    try {
      const operation = async (apiKey: string) => {
        // A live-observed bug: KeyRotator retries the SAME provider on a
        // transient failure (timeout, empty-stream glitch) by calling this
        // operation again from scratch — but if part of THIS turn's reply
        // was already streamed to the caller's ears via onClause before
        // the failure, a retry starts a brand new completion and speaks a
        // second, unrelated partial reply on top of the first, garbled
        // together. That's the "Your voice was voice was cut off" /
        // overlapping-fragments pattern seen on a real call. Once anything
        // has been spoken this turn, fail fast instead of regenerating —
        // the outer catch below already turns this into a clean spoken
        // recovery line ("could you say that again?") rather than
        // silently talking over what was already said.
        if (anyClauseEmitted) {
          throw new Error(`Provider "${provider.name}" cannot retry mid-turn — part of this reply was already spoken`);
        }
        const openai = getClient(apiKey, provider.baseURL, retryBudget[1]);
        // A fresh attempt must start from a clean slate: a half-filled
        // chunker buffer or raw text from an abandoned attempt would be
        // glued onto this one's output. (Nothing was spoken yet — the
        // anyClauseEmitted guard above already refuses a mid-turn retry.)
        rawAccumulated = "";
        if (streaming) clauseChunker = new ClauseChunker({ earlyFirstClause: true });

        const messages: any[] = [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ];

        let finalResponseText = "";
        const useTools = args.useTools ?? true;
        // Reasoning models (e.g. Groq's gpt-oss family) otherwise spend the
        // output-token budget on a hidden reasoning field before ever
        // writing the actual reply — see CONFIG.llm.providers' groq entry
        // for the live-verified failure mode this fixes. A no-op extra
        // field for providers/models that don't support it.
        //
        // For a non-English call, "none" gets bumped to "low" — see
        // args.language's doc above for the live-reproduced garbled-Hindi
        // failure this avoids. Only ever raises effort, never lowers it
        // (a provider with no reasoningEffort configured at all, or already
        // above "none", is untouched) — this is strictly "give the model a
        // bit more room to get non-English generation right," not a general
        // reasoning-level override.
        const modelForCall = modelOverride || modelOrder[0] || provider.model;
        const strongModel = modelForCall === provider.nonEnglishModel && modelForCall !== provider.model;
        const toolAgent = toolAgentCfg && toolsAllowed;
        console.log(`[LLM] prompt ~${Math.round((args.system.length + args.user.length) / 3.2)} tokens (system ${args.system.length} + user ${args.user.length} chars), model=${modelForCall}${toolAgent ? " (tools)" : ""}${needStrong ? "" : " (fast path)"}`);
        // gpt-oss rejects reasoning "none" (it needs at least "low"); the fast model keeps "none".
        const effectiveReasoningEffort =
          provider.reasoningEffort === "none" && strongModel && provider.name !== "gnani-evon"
            ? "low"
            : provider.reasoningEffort;
        // `reasoning_format: "hidden"` keeps Groq from ever returning the
        // model's reasoning in the visible message (live-reproduced: a Hindi
        // turn SPOKE "The caller is confused ... The policy says ..."). Only
        // sent when the provider opts in and reasoning is actually enabled.
        const reasoningOpt = effectiveReasoningEffort
          ? {
              reasoning_effort: effectiveReasoningEffort,
              ...(provider.hideReasoning && effectiveReasoningEffort !== "none" ? { reasoning_format: "hidden" } : {}),
            }
          : {};

        // After a booking/cancel/reschedule succeeds, no more tools this turn: the model has
        // to tell the patient. Left free, it re-checked the calendar, saw its own booking
        // had taken the slot, and told the patient the slot "isn't available".
        let hitTokenLimit = false;
        let toolsLocked = false;
        let toolNudged = false;
        let confirmedText = "";
        for (let i = 0; i < 3; i++) {
          // args.enabledTools undefined = legacy demo path, full
          // RESERVATION_TOOLS (unchanged behavior); an array (even empty)
          // means a real Agent Builder agent, filtered to its own allowlist.
          const allToolsForAgent = toolsLocked || !toolsAllowed
            ? []
            : args.enabledTools !== undefined ? await getToolsForAgentWithMCP(args.enabledTools, args.clientId) : TOOLS;
          // A medicine-only turn (no booking talk) gets just the care-plan tool, so chat stays fast.
          const toolsForThisCall = medicationTurn ? allToolsForAgent.filter((t) => CARE_TOOL_NAMES.has(t.function.name)) : allToolsForAgent;
          const baseParams = {
            model: modelForCall,
            messages,
            // The multilingual model spends part of max_tokens on hidden reasoning, and Hindi/Indic
            // text costs several tokens per word: 300 was cut off mid-sentence on longer Hindi
            // safety replies ("…आपातकालीन लाइन से संपर्क"). It is a ceiling, not a target length.
            max_tokens: args.maxOutputTokens ?? (strongModel || effectiveReasoningEffort && effectiveReasoningEffort !== "none" ? CONFIG.llm.maxOutputTokensReasoning : CONFIG.llm.maxOutputTokens),
            ...(useTools && toolsForThisCall.length > 0 ? { tools: toolsForThisCall as any, tool_choice: "auto" as const } : {}),
            ...reasoningOpt,
          };

          let message: any;
          if (streaming) {
            const streamed = await streamChatCompletion(openai, baseParams, {
              signal: args.abortSignal,
              // The reasoning model thinks for several seconds after a tool result before its first
              // token; the default 6s watchdog killed those turns (the agent went silent on bookings).
              idleMs: toolAgent ? 20_000 : undefined,
              onContentDelta: (delta) => {
                rawAccumulated += delta;
                args.onRawDelta?.(rawAccumulated);
                const clauses = clauseChunker!.push(delta);
                for (const raw of clauses) emitClauseOnce(raw);
              },
            });
            if (!streamed.content && !streamed.tool_calls) {
              throw new Error(`Provider "${provider.name}" returned no content or tool_calls (streamed)`);
            }
            if (streamed.truncated) hitTokenLimit = true;
            message = { role: "assistant", content: streamed.content || null, tool_calls: streamed.tool_calls };
          } else {
            const resp = await openai.chat.completions.create(baseParams as any);
            const choice = resp.choices?.[0];
            if (!choice?.message) {
              // Content-filter rejections and overload responses can come back with
              // an empty choices array. Throw a named error so the provider loop
              // logs why this provider failed instead of a bare TypeError.
              // NB: the message must not contain "timeout"/"timed out" — KeyRotator
              // string-matches those (lib/util/keys.ts) and would retry 3x with backoff.
              throw new Error(
                `Provider "${provider.name}" returned no message (choices=${resp.choices?.length ?? 0})`
              );
            }
            if (choice.finish_reason === "length") hitTokenLimit = true;
            message = choice.message;
          }
          messages.push(message);

          if (message.tool_calls && message.tool_calls.length > 0) {
            // Speak while the tool runs instead of going silent (live call: the agent sat in
            // "thinking" for several seconds around every booking).
            if (streaming && !anyClauseEmitted) {
              const firstTool = message.tool_calls.find((t: any) => t.type === "function")?.function?.name ?? "";
              const callerText = (args.user.match(/USER:\s*([\s\S]*)$/)?.[1] ?? args.user).slice(-400);
              emitClauseOnce(toolFillerPhrase(firstTool, callerText), true);
            }
            for (const toolCall of message.tool_calls) {
              if (toolCall.type !== "function") continue;

              const name = toolCall.function.name;
              const argsStr = toolCall.function.arguments;
              let parsedArgs = {};
              try {
                parsedArgs = JSON.parse(argsStr);
              } catch {}

              // MCP tool arguments can carry caller data and are third-party-bound: log keys only.
              console.log(name.startsWith("mcp_")
                ? `[LLM] Invoking MCP tool: ${name} (argument keys: ${Object.keys(parsedArgs).join(", ")})`
                : `[LLM] Invoking Tool: ${name} with args`, name.startsWith("mcp_") ? undefined : parsedArgs);
              const toolCtx = {
                clientId: args.clientId,
                sessionId: args.sessionId,
                userId: args.userId,
                patientId: args.patientId,
                callerNumber: args.callerNumber,
              };
              let resultStr: string;
              if (MUTATING_TOOLS.has(name) && args.sessionId) {
                // Hand the work to the background worker: it finishes (and records the outcome) even if the
                // caller talks over this turn and it is cancelled, and an identical repeat request joins the
                // same job instead of booking twice.
                const callerLine = (args.user.match(/USER:\s*([\s\S]*)$/)?.[1] ?? args.user).slice(-400);
                const job = runBackgroundAction(args.sessionId, name, parsedArgs, () => dispatchToolCall(name, parsedArgs, toolCtx), callerLine);
                const abortP = args.abortSignal
                  ? new Promise<never>((_, reject) => {
                      if (args.abortSignal!.aborted) reject(new DOMException("Turn cancelled", "AbortError"));
                      args.abortSignal!.addEventListener("abort", () => reject(new DOMException("Turn cancelled", "AbortError")), { once: true });
                    })
                  : null;
                await (abortP ? Promise.race([job.promise, abortP]) : job.promise);
                resultStr = job.resultStr ?? "";
                // Booked: say so right away from the verified result, instead of another slow model round
                // (10 s "think" on the reasoning model) that may never be heard.
                if (job.success && job.confirmation && !args.abortSignal?.aborted) {
                  emitClauseOnce(job.confirmation);
                  markAnnounced(job);
                  confirmedText = job.confirmation;
                }
              } else {
                resultStr = await dispatchToolCall(name, parsedArgs, toolCtx);
              }

              if (MUTATING_TOOLS.has(name) && /"success"\s*:\s*true/.test(resultStr)) toolsLocked = true;
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: resultStr,
                name: name,
              });
            }
            if (confirmedText) { finalResponseText = confirmedText; break; }
            continue;
          }

          // The model sometimes writes a tool call as plain text ("</tool_call>") instead of really calling
          // it. Nothing runs, and the agent then talks as if it had. Push back once so the action happens.
          if (useTools && toolsForThisCall.length > 0 && !toolNudged && looksLikeToolMarkup(message.content || "")) {
            toolNudged = true;
            console.warn("[LLM] Model wrote a tool call as text — asking it to make a real tool call.");
            messages.push({ role: "user", content: "That was tool-call text, not a real tool call, so nothing ran. Call the tool properly now (function calling), then tell the caller the result." });
            continue;
          }
          finalResponseText = message.content || "";
          break;
        }

        // If every one of the 3 iterations made a tool call, the loop above
        // never reaches the plain-content branch that sets finalResponseText
        // — it exits still empty. This was a real, reproducible bug: a
        // caller asking to book something (check_availability, then
        // create_booking, potentially a third confirmation-shaped call)
        // could exhaust the cap without the model ever having said anything
        // back, so the agent went completely silent on a real phone call —
        // no error anywhere, "[LLM] Success" logged with an empty reply.
        // Force one more call with tools disabled so the model has to
        // summarize what it just did in words instead of calling another tool.
        if (!finalResponseText.trim()) {
          console.warn(`[LLM] Tool-call loop exhausted without a final reply — forcing a text-only follow-up.`);
          const closingResp = await openai.chat.completions.create({
            model: modelForCall,
            messages: [
              ...messages,
              { role: "user", content: "Reply to the caller now in one or two spoken sentences, summarizing what you just did. Do not call any more tools." },
            ],
            // The multilingual model spends part of max_tokens on hidden reasoning, and Hindi/Indic
            // text costs several tokens per word: 300 was cut off mid-sentence on longer Hindi
            // safety replies ("…आपातकालीन लाइन से संपर्क"). It is a ceiling, not a target length.
            max_tokens: args.maxOutputTokens ?? (strongModel || effectiveReasoningEffort && effectiveReasoningEffort !== "none" ? CONFIG.llm.maxOutputTokensReasoning : CONFIG.llm.maxOutputTokens),
            ...reasoningOpt,
          } as any);
          finalResponseText = closingResp.choices[0].message.content || "";

          // Last resort — should be unreachable in practice, but a live
          // phone call going completely silent is bad enough that it's
          // worth a hardcoded floor rather than trusting a second LLM call
          // to definitely produce text.
          if (!finalResponseText.trim()) {
            finalResponseText = "Sorry, I just want to double check that — could you tell me again what you'd like me to do?";
          }

          // This fallback call is deliberately non-streamed (a rare path —
          // the tool-loop exhausted its cap — not worth the extra
          // complexity), so its text never went through the clause chunker
          // above. Push it through now so onClause() still sees it.
          if (streaming) {
            for (const clause of clauseChunker!.push(finalResponseText)) emitClauseOnce(clause);
          }
        }

        if (streaming) {
          // Anything still sitting in the chunker's buffer — a trailing
          // clause that never hit sentence-ending punctuation — needs to
          // reach the caller too, not just get silently dropped.
          const remainder = clauseChunker!.flush();
          // Cut off by the token limit: the leftover is half a sentence. Don't speak it if
          // something complete was already said (the caller hears a clean end instead).
          if (remainder && !(hitTokenLimit && anyClauseEmitted && !endsSentence(remainder))) emitClauseOnce(remainder);
          else if (remainder) console.warn(`[LLM] Reply hit the token limit — dropped the unfinished tail: "${remainder.slice(0, 60)}"`);
        }

        let finalText = args.raw
          ? finalResponseText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
          : sanitizeReply(hitTokenLimit ? trimToLastSentence(finalResponseText) : finalResponseText);
        // Everything the model wrote was planning text -> never go silent.
        if (!finalText && !anyClauseEmitted && !args.raw) {
          finalText = "माफ़ कीजिए, क्या आप एक बार फिर से बोल सकते हैं?";
          if (!isEnglishLanguage(args.language)) {
            if (streaming) emitClauseOnce(finalText);
          } else {
            finalText = "Sorry, could you say that one more time?";
            if (streaming) emitClauseOnce(finalText);
          }
        }
        return { text: finalText, model: modelForCall, usedLive: true, provider: provider.name };
      };

      // Try the model this turn needs; if its daily/minute quota is exhausted (429), try the next one for the
      // same provider right away instead of crawling on to a slower provider. Cooldowns are scoped per model,
      // so a full pool on one model never blocks the other.
      let result: Awaited<ReturnType<typeof operation>> | undefined;
      for (let mi = 0; mi < modelOrder.length; mi++) {
        modelOverride = modelOrder[mi];
        try {
          result = await rotator.executeWithRotation(
            operation,
            retryBudget[0],
            // Whole-operation ceiling. Streaming turns are protected by the stall
            // watchdog + the client's own connect timeout instead of a 5s race.
            streaming ? 30_000 : retryBudget[1],
            retryBudget[2],
            modelOverride,
          );
          break;
        } catch (e: any) {
          const quotaLimited = (e?.status ?? e?.response?.status) === 429;
          if (quotaLimited && mi < modelOrder.length - 1 && !anyClauseEmitted) {
            console.warn(`[LLM] ${modelOverride} is out of quota — switching to ${modelOrder[mi + 1]} for this turn.`);
            continue;
          }
          throw e;
        }
      }
      if (!result) throw new Error(`Provider "${provider.name}" produced no result`);

      console.log(`[LLM] Success via provider: ${provider.name}`);
      rotator.advanceKey(modelOverride);
      return result;
    } catch (err) {
      console.warn(`[LLM] Provider "${provider.name}" failed:`, err instanceof Error ? err.message : err);
      if (streaming && anyClauseEmitted) {
        // Part of this provider's reply has already been spoken via
        // onClause, then it died mid-stream — falling back to a different
        // provider now would speak a second, unrelated completion on top of
        // it, so we can't just retry. But silently propagating this error
        // used to leave the caller in dead air for the rest of the turn
        // (live-observed: "the agent response stopped in between and took
        // over 30 seconds" — that 30s was the caller waiting for a reply
        // that was never coming). Speak a short, honest recovery line so
        // the call keeps moving instead of going silent, then still
        // propagate the error for logging/trace purposes.
        emitClauseOnce("Sorry, I lost my train of thought there — could you say that again?");
        throw err;
      }
      continue;
    }
  }

  console.warn("[LLM] All providers exhausted (quota or outage). Speaking the honest technical-problem line.");
  const fallbackText = offlineFallback(args.user);
  // Every provider failed before speaking a single clause (anyClauseEmitted
  // is false here — if it were true we'd have thrown above instead of
  // reaching this line). On the streaming/telephony path the caller only
  // ever plays audio for text that comes through onClause, so without this
  // the fallback text was silently returned but never actually spoken —
  // live-observed as "the agent went completely silent" while the
  // transcript still showed a reply. Speak it now as a single clause.
  if (streaming) args.onClause!(fallbackText);
  return { text: fallbackText, model: "offline-fallback", usedLive: false, provider: "offline" };
}

/**
 * Some Groq-hosted models occasionally emit tool-call-like syntax directly
 * in the message content instead of populating the structured tool_calls
 * array (an OpenAI-compatible-adapter quirk, not something we asked for) —
 * e.g. a literal `<function=cancel_booking>{"bookingId": "..."}</function>`
 * with a fabricated ID. Strip anything that looks like it before it can
 * ever reach a caller's ears or the transcript.
 */
export function sanitizeReply(text: string): string {
  return humanizeEscalationLanguage(
    stripForeignScript(stripReasoningLeak(text))
      .replace(/<tool_call[^>]*>[\s\S]*?<\/tool_call>/gi, "")
      .replace(/<function[^>]*>[\s\S]*?<\/function>/gi, "")
      .replace(/\[\s*tool[\s_-]?call\b[^\]]*\]/gi, "")
      .replace(/<\/?tool_call[^>]*>|<\/?tool_response[^>]*>|\[TOOL_CALLS?\]/gi, "")
      .replace(/<\/?function[^>]*>/gi, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * The persona/policy prompts explicitly forbid "tier 2", "specialist", and
 * "escalate" — support-ticket words a real person would never say out loud
 * — but LLM instruction-following on forbidden words isn't 100% reliable,
 * especially for a fast/cheap model. This is a deterministic backstop: if
 * one of those words slips through anyway, replace it with how a person
 * would actually phrase handing off to a teammate, rather than let a
 * caller hear "connect you with a senior specialist."
 */
function humanizeEscalationLanguage(text: string): string {
  return text
    .replace(/\b(a|an)\s+(senior\s+)?tier[\s-]?[12]\s+specialist\b/gi, "someone from the team")
    .replace(/\b(a|an)\s+(senior\s+)?specialist\b/gi, "someone from the team")
    .replace(/\btier[\s-]?[12]\b/gi, "the team")
    .replace(/\bescalate(?:d)?\s+(?:your\s+issue\s+)?to\b/gi, "connect you with")
    .replace(/\bescalate(?:d)?\b/gi, "loop in someone from the team");
}

/**
 * The line spoken when EVERY model provider has failed (quota exhausted, outage). It must be honest: say there is
 * a technical problem and ask the caller to try again. It used to be a leftover demo script that said "I've locked
 * that in for you!" to anything mentioning booking (and wrote a fake reservation for a made-up user), invented
 * telecom/billing replies, or pretended to understand with "tell me a little more". It never claims an action and
 * never calls a tool, and it answers in the caller's own script.
 */
export function offlineFallback(userBlock: string): string {
  const lastUser = [...userBlock.matchAll(/^USER:\s*(.*)$/gm)].pop()?.[1] ?? userBlock;
  if (/[\u0900-\u097F]/.test(lastUser)) return "माफ़ कीजिए, मेरी तरफ़ से अभी थोड़ी तकनीकी दिक्कत है। क्या आप थोड़ी देर बाद, एक बार फिर से बोल सकते हैं?";
  if (/[\u0A00-\u0A7F]/.test(lastUser)) return "ਮਾਫ਼ ਕਰਨਾ, ਮੇਰੇ ਪਾਸੇ ਹੁਣੇ ਥੋੜ੍ਹੀ ਤਕਨੀਕੀ ਦਿੱਕਤ ਹੈ। ਕੀ ਤੁਸੀਂ ਥੋੜ੍ਹੀ ਦੇਰ ਬਾਅਦ ਇੱਕ ਵਾਰ ਫਿਰ ਦੱਸ ਸਕਦੇ ਹੋ?";
  if (/[\u0A80-\u0AFF]/.test(lastUser)) return "માફ કરશો, મારી બાજુએ હમણાં થોડી ટેકનિકલ તકલીફ છે. શું તમે થોડી વાર પછી ફરીથી કહી શકશો?";
  return "I'm sorry, I'm having a technical problem on my side right now. Could you please say that again in a moment?";
}
