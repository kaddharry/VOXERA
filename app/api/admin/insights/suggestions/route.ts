import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/db/server";
import { getTenantIdForUser } from "../../../../../lib/db/agents";
import { LearningTablesMissingError, generateSuggestions } from "../../../../../lib/db/agent-learning";

export const dynamic = "force-dynamic";

/** POST /api/admin/insights/suggestions — (re)builds suggestions from the account's open call findings. */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const tenantId = await getTenantIdForUser(supabase, user.id);
    const suggestions = await generateSuggestions(supabase, user.id, tenantId);
    return NextResponse.json({ suggestions });
  } catch (err) {
    if (err instanceof LearningTablesMissingError) return NextResponse.json({ migrationRequired: true, error: err.message }, { status: 409 });
    console.error("[Suggestions API]", err);
    return NextResponse.json({ error: "Failed to build suggestions" }, { status: 500 });
  }
}
