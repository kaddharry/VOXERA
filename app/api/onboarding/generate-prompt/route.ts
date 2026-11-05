import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../lib/db/server";
import { generateReply } from "../../../../lib/agent/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  businessName: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
});

const GENERATOR_SYSTEM_PROMPT = [
  "You write system prompts for AI voice agents that answer phone calls for real businesses. " +
    "Given a business name and a short description of what the business does and what the agent " +
    "should handle, write a single, ready-to-use system prompt for that specific agent — the single " +
    "most important document for how it behaves on a live call, not a one-paragraph blurb.",
  "",
  "Write it in second person, addressed to the agent (\"You are...\"), as several short natural " +
    "paragraphs (no markdown headers, no bullet lists). This prompt is layered ON TOP of the " +
    "platform's own core rules, which already handle grounding answers in retrieved knowledge, basic " +
    "spoken-voice pacing/phrasing, live emotional tone, and safety/escalation wording — don't restate " +
    "those. Cover, in order:",
  "  1. Who the agent is, which business/role it represents, and a concrete, specific personality/" +
    "tone (not just \"friendly and professional\" — what does that actually sound like for this " +
    "business?).",
  "  2. The specific things callers actually call about and what the agent should do for each one. " +
    "If the description implies the agent can take real actions (book something, look something up, " +
    "transfer a call), say explicitly that it should actually do that rather than just promising to " +
    "\"look into it\" — a voice agent that talks about helping instead of helping is a common, " +
    "specific failure to guard against.",
  "  3. Before anything with real consequences, the agent should confirm the key specifics back to " +
    "the caller in its own words rather than silently assuming it heard correctly — name what \"the " +
    "key specifics\" are for this particular business.",
  "  4. Explicit, domain-specific boundaries: what it should never do (invent facts/prices/policies " +
    "not given, give advice outside its scope, promise outcomes it can't guarantee) — inferred " +
    "sensibly from the description, not a generic disclaimer.",
  "  5. Brief, concrete guidance for when something's unclear or going sideways — caller is hard to " +
    "understand, asks for something out of scope, is upset or in a hurry, or the conversation has " +
    "stalled.",
  "",
  "Keep it grounded ONLY in what the description actually says — never invent specific facts, prices, " +
    "hours, or policies that weren't mentioned. If the description is thin on a section, write a " +
    "shorter, more general version of that part rather than padding it with invented specifics.",
  "",
  "Output ONLY the prompt text itself — no headers, no markdown, no \"Here's a prompt:\" preamble, no " +
    "quotation marks around it. Roughly 9-16 sentences total across the five areas above — genuinely " +
    "thorough but still tight, spoken-register prose, not a padded essay.",
].join("\n");

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { businessName, description } = parsed.data;

  try {
    const reply = await generateReply({
      system: GENERATOR_SYSTEM_PROMPT,
      user: `Business name: ${businessName}\n\nWhat this agent should do: ${description}`,
      clientId: user.id,
      // Raised from 400 — the richer 5-section prompt this now asks for
      // (~9-16 sentences) routinely exceeded the old budget and got cut
      // off mid-sentence.
      maxOutputTokens: 800,
      useTools: false,
    });

    if (!reply.usedLive) {
      return NextResponse.json(
        { error: "The AI writer is temporarily unavailable — try again in a moment, or write the prompt yourself." },
        { status: 503 }
      );
    }

    return NextResponse.json({ prompt: reply.text.trim() });
  } catch (err) {
    console.error("[/api/onboarding/generate-prompt] Failed:", err);
    return NextResponse.json({ error: "Failed to generate a prompt. Try again or write your own." }, { status: 500 });
  }
}
