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
}): Promise<LLMReply> {

  // Issue #7: Try each provider in order until one succeeds
  for (const provider of CONFIG.llm.providers) {
    const rotator = new KeyRotator(provider.envKey);
    if (!rotator.getKey()) continue; // skip providers without keys

    try {
      const result = await rotator.executeWithRotation(async (apiKey) => {
        const openai = new OpenAI({
          apiKey,
          baseURL: provider.baseURL,
        });

        const messages: any[] = [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ];

        let finalResponseText = "";

        // We allow a max of 3 tool call iterations to prevent infinite tool loops.
        for (let i = 0; i < 3; i++) {
          const resp = await openai.chat.completions.create({
            model: provider.model,
            messages,
            max_tokens: CONFIG.llm.maxOutputTokens,
            tools: TOOLS as any,
            tool_choice: "auto",
          });

          const message = resp.choices[0].message;
          messages.push(message);

          if (message.tool_calls && message.tool_calls.length > 0) {
            // Handle each tool call requested by the model
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
            // Continue loop so the model can process the tool results
            continue;
          }

          // If no tools were called, the model is done reasoning and returns a text reply
          finalResponseText = message.content || "";
          break;
        }

        return { text: finalResponseText.trim(), model: provider.model, usedLive: true, provider: provider.name };
      });

      console.log(`[LLM] Success via provider: ${provider.name}`);
      return result;
    } catch (err) {
      console.warn(`[LLM] Provider "${provider.name}" failed:`, err instanceof Error ? err.message : err);
      continue; // try next provider
    }
  }

  // All providers failed — use offline fallback
  console.warn("[LLM] All providers exhausted. Using offline fallback.");
  return { text: offlineFallback(args.user), model: "offline-fallback", usedLive: false, provider: "offline" };
}

// Deterministic canned response used when all LLM providers are unavailable.
function offlineFallback(userBlock: string): string {
  const turnMatch = userBlock.match(/USER:\s*(.+)/i);
  const current = turnMatch?.[1] ?? userBlock;
  const lc = current.toLowerCase();

  if (/book|schedule|appointment/.test(lc)) {
    // Offline mock for testing tool invocations
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
