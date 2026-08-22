import OpenAI from "openai";
import { CONFIG } from "../config";
import { getKeyRotator } from "../util/keys";
import { TOOLS, dispatchToolCall } from "./tools";
import { ClauseChunker } from "./clause-chunker";

export interface LLMReply {
  text: string;
  model: string;
  usedLive: boolean;
  provider?: string;
}

/** Accumulates OpenAI-compatible streamed chunk deltas into the same
 * `message` shape the non-streaming code path already works with (content +
 * tool_calls), so everything downstream of a completion call (the tool-loop
 * branch, sanitizeReply, etc.) stays identical whether or not streaming is
 * in use. `onContentDelta` fires per raw text delta as it arrives — the
 * caller feeds it into a ClauseChunker to get sentence-level chunks instead
 * of raw token deltas. */
async function streamChatCompletion(
  openai: OpenAI,
  params: Record<string, unknown>,
  opts: { onContentDelta?: (delta: string) => void; signal?: AbortSignal }
): Promise<{ content: string; tool_calls?: any[] }> {
  const stream = (await openai.chat.completions.create(
    { ...params, stream: true } as any,
    opts.signal ? { signal: opts.signal } : undefined
  )) as unknown as AsyncIterable<any>;

  let content = "";
  const toolCallsByIndex: Record<number, { id?: string; type?: string; function: { name?: string; arguments: string } }> = {};

  for await (const chunk of stream) {
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

  const toolCallsArr = Object.values(toolCallsByIndex);
  return {
    content,
    tool_calls: toolCallsArr.length > 0
      ? toolCallsArr.map((tc, i) => ({ id: tc.id ?? `call_${i}`, type: "function", function: { name: tc.function.name ?? "", arguments: tc.function.arguments } }))
      : undefined,
  };
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
  const clauseChunker = streaming ? new ClauseChunker() : null;
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
  const emitClauseOnce = (raw: string) => {
    const cleaned = sanitizeReply(raw);
    const key = cleaned.toLowerCase();
    if (!cleaned || seenClauses.has(key)) return;
    seenClauses.add(key);
    anyClauseEmitted = true;
    args.onClause!(cleaned);
  };

  for (const provider of CONFIG.llm.providers) {
    // Shared instance, not a fresh one per turn — see getKeyRotator's doc.
    // This is what lets the rotator remember which key already proved
    // exhausted (and for roughly how long) instead of re-probing every key
    // from index 0 again on every single turn.
    const rotator = getKeyRotator(provider.envKey);
    if (!rotator.getKey()) continue;

    try {
      const result = await rotator.executeWithRotation(async (apiKey) => {
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
        const openai = new OpenAI({
          apiKey,
          baseURL: provider.baseURL,
          timeout: retryBudget[1],
          maxRetries: 1,
        });

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
        const reasoningOpt = provider.reasoningEffort ? { reasoning_effort: provider.reasoningEffort } : {};

        for (let i = 0; i < 3; i++) {
          const baseParams = {
            model: provider.model,
            messages,
            max_tokens: args.maxOutputTokens ?? CONFIG.llm.maxOutputTokens,
            ...(useTools ? { tools: TOOLS as any, tool_choice: "auto" as const } : {}),
            ...reasoningOpt,
          };

          let message: any;
          if (streaming) {
            const streamed = await streamChatCompletion(openai, baseParams, {
              signal: args.abortSignal,
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
            message = choice.message;
          }
          messages.push(message);

          if (message.tool_calls && message.tool_calls.length > 0) {
            for (const toolCall of message.tool_calls) {
              if (toolCall.type !== "function") continue;

              const name = toolCall.function.name;
              const argsStr = toolCall.function.arguments;
              let parsedArgs = {};
              try {
                parsedArgs = JSON.parse(argsStr);
              } catch {}

              console.log(`[LLM] Invoking Tool: ${name} with args`, parsedArgs);
              const resultStr = await dispatchToolCall(name, parsedArgs, args.clientId, args.sessionId, args.userId);

              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: resultStr,
                name: name,
              });
            }
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
            model: provider.model,
            messages: [
              ...messages,
              { role: "user", content: "Reply to the caller now in one or two spoken sentences, summarizing what you just did. Do not call any more tools." },
            ],
            max_tokens: args.maxOutputTokens ?? CONFIG.llm.maxOutputTokens,
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
          if (remainder) emitClauseOnce(remainder);
        }

        return { text: sanitizeReply(finalResponseText), model: provider.model, usedLive: true, provider: provider.name };
      }, ...retryBudget);

      console.log(`[LLM] Success via provider: ${provider.name}`);
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

  console.warn("[LLM] All providers exhausted. Using offline fallback.");
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
    text
      .replace(/<function[^>]*>[\s\S]*?<\/function>/gi, "")
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

function offlineFallback(userBlock: string): string {
  const turnMatch = userBlock.match(/USER:\s*(.+)/i);
  const current = turnMatch?.[1] ?? userBlock;
  const lc = current.toLowerCase();

  if (/book|schedule|appointment/.test(lc)) {
    console.log("[LLM] Offline fallback triggered mock tool invocation for check_availability & create_booking");
    dispatchToolCall("check_availability", { date: "2026-10-10", time: "19:00" }, "offline-test").then(() => {
        dispatchToolCall("create_booking", { userId: "U-123", date: "2026-10-10", time: "19:00", partySize: 4 }, "offline-test");
    });
    return "Let me check our calendar for that time. Yes, we have a slot available. I've locked that in for you!";
  }

  if (/signal|dropp|outage|coverage/.test(lc)) {
    return "I completely understand — losing signal when you're trying to work is genuinely frustrating. I can see this isn't the first time you've raised it. Let me connect you to a senior specialist who can look into the pattern on your line.";
  }
  if (/charge|bill|refund/.test(lc)) {
    return "I hear you — an unexpected charge is upsetting. I don't want to guess at the details, so let me pull your most recent billing record and walk you through exactly what it is.";
  }
  if (/thank|great|love/.test(lc)) {
    return "Thank you — I'm really glad that helped. Is there anything else I can take care of for you today?";
  }
  return "Thanks for letting me know. To make sure I help you correctly, could you tell me a little more about what you'd like me to do next?";
}
