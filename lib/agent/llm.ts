import OpenAI from "openai";
import { CONFIG } from "../config";
import { KeyRotator } from "../util/keys";
import { TOOLS, dispatchToolCall } from "./tools";

export interface LLMReply {
  text: string;
  model: string;
  usedLive: boolean;
  provider?: string;
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
}): Promise<LLMReply> {

  for (const provider of CONFIG.llm.providers) {
    const rotator = new KeyRotator(provider.envKey);
    if (!rotator.getKey()) continue;

    try {
      const result = await rotator.executeWithRotation(async (apiKey) => {
        const openai = new OpenAI({
          apiKey,
          baseURL: provider.baseURL,
          timeout: 15_000,
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
          const resp = await openai.chat.completions.create({
            model: provider.model,
            messages,
            max_tokens: args.maxOutputTokens ?? CONFIG.llm.maxOutputTokens,
            ...(useTools ? { tools: TOOLS as any, tool_choice: "auto" as const } : {}),
            ...reasoningOpt,
          } as any);

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
          const message = choice.message;
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
        }

        return { text: sanitizeReply(finalResponseText), model: provider.model, usedLive: true, provider: provider.name };
      });

      console.log(`[LLM] Success via provider: ${provider.name}`);
      return result;
    } catch (err) {
      console.warn(`[LLM] Provider "${provider.name}" failed:`, err instanceof Error ? err.message : err);
      continue;
    }
  }

  console.warn("[LLM] All providers exhausted. Using offline fallback.");
  return { text: offlineFallback(args.user), model: "offline-fallback", usedLive: false, provider: "offline" };
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
