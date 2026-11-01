import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../../../lib/db/server";
import { getTenantIdForUser } from "../../../../../../lib/db/agents";
import { LearningTablesMissingError, SuggestionError, acceptSuggestion, dismissSuggestion } from "../../../../../../lib/db/agent-learning";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), answer: z.string().max(4000).optional(), guideline: z.string().max(600).optional() }),
  z.object({ action: z.literal("dismiss") }),
]);

/**
 * POST /api/admin/insights/suggestions/[id] — accept or dismiss a
 * suggestion. Accepting a knowledge suggestion needs `answer` (the
 * hospital's own answer); a prompt suggestion may carry an edited
 * `guideline`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });

  const { id } = await params;
  try {
    if (parsed.data.action === "dismiss") {
      return NextResponse.json({ suggestion: await dismissSuggestion(supabase, user.id, id) });
    }
    const tenantId = await getTenantIdForUser(supabase, user.id);
    const result = await acceptSuggestion(supabase, user.id, tenantId, id, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SuggestionError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof LearningTablesMissingError) return NextResponse.json({ migrationRequired: true, error: err.message }, { status: 409 });
    console.error("[Suggestion API]", err);
    return NextResponse.json({ error: "Failed to update the suggestion" }, { status: 500 });
  }
}
