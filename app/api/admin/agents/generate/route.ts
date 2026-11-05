import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../../lib/db/server";
import { generateReply } from "../../../../../lib/agent/llm";
import type { GeneratedAgentDraft } from "../../../../admin/agents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  description: z.string().min(1).max(2000),
  /** Extracted text from files attached in the create-agent dialog (pricing
   * sheets, FAQs, policy docs) — lets the drafted prompt reference real
   * specifics instead of only what fit in the short description field.
   * Capped well under the LLM's input budget (CONFIG.llm.maxInputTokens). */
  fileContext: z.string().max(8000).optional(),
});

const GENERATOR_SYSTEM_PROMPT = [
  "You design complete AI voice agents for real businesses from a short description. Given a " +
    "description of a business and what its phone agent should handle, invent a full agent profile. " +
    "You write the single most important document for this agent's behavior on live phone calls — " +
    "treat it that way, not as a one-paragraph blurb.",
  "",
  "Output ONLY a single JSON object, no markdown code fences, no prose before or after it, with " +
    "exactly these four string fields:",
  '{"name": "...", "description": "...", "system_prompt": "...", "greeting": "..."}',
  "",
  "- name: a short, natural agent name (e.g. \"Front Desk Concierge\", \"Bella\") — a name a real " +
    "business would actually use, not a generic label like \"AI Assistant\".",
  "- description: one sentence summarizing what this agent does, shown in a list of agents.",
  "- greeting: a short, natural first line the agent would say when answering a call — one sentence, " +
    "no more than ~15 words, matching the personality of the system_prompt.",
  "",
  "- system_prompt: written in second person (\"You are...\"). This is layered ON TOP of the " +
    "platform's own core rules, which already handle: grounding answers in retrieved knowledge/" +
    "evidence, basic spoken-voice pacing and phrasing, the live emotional-tone persona, and safety/" +
    "escalation wording — do not restate those, focus entirely on what makes THIS agent distinct. " +
    "Write it as several short, natural paragraphs (no markdown headers, no bullet lists — plain " +
    "prose a person would write) covering, in this order:",
  "  1. IDENTITY: who the agent is, which business/role it represents, and its personality/tone in " +
    "concrete, specific terms (not just \"friendly and professional\" — what does that look like " +
    "here? brisk and efficient? warm and unhurried? dryly funny?).",
  "  2. SCOPE: the specific things callers actually call about and what the agent should do for each " +
    "one, grounded only in the description/reference material. If tools like booking/rescheduling/" +
    "canceling are clearly implied by the description, say explicitly that the agent should actually " +
    "use them when appropriate rather than just promising to \"look into it\" — a voice agent that " +
    "talks about doing something instead of doing it is a common, specific failure mode to guard " +
    "against here.",
  "  3. VERIFICATION & CONFIRMATION: before taking any action with real consequences (booking, " +
    "canceling, rescheduling, sharing account/personal details), the agent should confirm the key " +
    "specifics back to the caller in its own words (the date/time, the name, what's being changed) " +
    "rather than silently assuming it heard correctly — and for anything sensitive, make sure it's " +
    "actually talking to the right person first. Be concrete about what \"the key specifics\" are for " +
    "THIS agent's domain, not generic.",
  "  4. BOUNDARIES: what this agent explicitly should NOT do — invent facts/prices/policies not in " +
    "its knowledge, give medical/legal/financial advice beyond what's explicitly in scope, promise " +
    "outcomes it can't guarantee, argue with or talk over a caller. Infer sensible, domain-specific " +
    "boundaries from the description (a clinic agent shouldn't diagnose; a restaurant agent shouldn't " +
    "promise allergen safety it can't verify) rather than a generic disclaimer.",
  "  5. WHEN SOMETHING'S UNCLEAR OR GOES SIDEWAYS: concrete guidance for the moments that actually " +
    "break a scripted-feeling agent — the caller mumbles or the line is unclear (ask them to repeat, " +
    "don't guess and barrel ahead), the caller asks for something out of scope (say plainly you can't " +
    "help with that and redirect, don't deflect vaguely), the caller is clearly upset or in a hurry " +
    "(adjust pacing, don't force the full script), or the conversation has stalled and repeating the " +
    "same offer isn't working (try something different, don't loop).",
  "Grounded ONLY in what the description (and attached reference material, if any) actually says — " +
    "never invent specific prices, hours, policies, or capabilities that weren't mentioned anywhere. " +
    "If reference material is attached, prefer citing its concrete specifics (actual prices, hours, " +
    "service names, policies) over generic language in every section above — that's the whole point " +
    "of attaching it. If the description is thin on a section, write a shorter, more general version " +
    "of that section rather than padding it with invented specifics. Overall length: genuinely " +
    "thorough but still tight, spoken-register prose — roughly 9-16 sentences across the five areas " +
    "above, not a padded essay.",
  "",
  "If a REFERENCE MATERIAL block is provided below the business description, it's real content from " +
    "a document the business uploaded (pricing sheet, FAQ, policy doc, etc.) — treat it as ground " +
    "truth, not a suggestion. Only use what it actually says; don't extrapolate beyond it.",
].join("\n");

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  // Strip a ```json ... ``` or ``` ... ``` fence if the model added one
  // despite being told not to — cheap models don't always comply.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

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

  try {
    const userMessage = parsed.data.fileContext
      ? `${parsed.data.description}\n\n=== REFERENCE MATERIAL (from attached file(s)) ===\n${parsed.data.fileContext}`
      : parsed.data.description;

    const reply = await generateReply({
      system: GENERATOR_SYSTEM_PROMPT,
      user: userMessage,
      clientId: user.id,
      // Raised from 500 — the richer 5-section system_prompt this now asks
      // for (identity/scope/verification/boundaries/edge-cases, ~9-16
      // sentences) plus name/description/greeting in the same JSON object
      // routinely exceeded the old budget, truncating mid-field and
      // breaking JSON.parse() in extractJson() below.
      maxOutputTokens: 1000,
      useTools: false,
    });

    if (!reply.usedLive) {
      return NextResponse.json(
        { error: "The AI builder is temporarily unavailable — try again in a moment, or build it manually." },
        { status: 503 }
      );
    }

    let draft: Partial<GeneratedAgentDraft>;
    try {
      draft = JSON.parse(extractJson(reply.text));
    } catch {
      return NextResponse.json(
        { error: "The AI builder returned something unexpected — try again, or build it manually." },
        { status: 502 }
      );
    }

    if (!draft.name || !draft.system_prompt) {
      return NextResponse.json(
        { error: "The AI builder's draft was incomplete — try again, or build it manually." },
        { status: 502 }
      );
    }

    const result: GeneratedAgentDraft = {
      name: String(draft.name).slice(0, 80),
      description: String(draft.description ?? "").slice(0, 280),
      system_prompt: String(draft.system_prompt).slice(0, 6000),
      greeting: String(draft.greeting ?? "").slice(0, 500),
    };

    return NextResponse.json({ agent: result });
  } catch (err) {
    console.error("[/api/admin/agents/generate] Failed:", err);
    return NextResponse.json({ error: "Failed to generate an agent. Try again or build it manually." }, { status: 500 });
  }
}
