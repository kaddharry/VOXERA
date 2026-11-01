import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { getTenantIdForUser, listAgentsForTenant } from "../../../../lib/db/agents";
import { LearningTablesMissingError, listSuggestions, listVersions, loadInsights } from "../../../../lib/db/agent-learning";
import { groupKnowledgeGaps } from "../../../../lib/insights/suggestions";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/insights — everything the Agent Learning page shows:
 * suggestions, open knowledge gaps grouped by topic, recent open emotional
 * failure points, and each agent's version history.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const tenantId = await getTenantIdForUser(supabase, user.id);
    const [insights, suggestions, versions, agents] = await Promise.all([
      loadInsights(supabase, user.id),
      listSuggestions(supabase, user.id),
      listVersions(supabase, user.id),
      tenantId ? listAgentsForTenant(supabase, tenantId) : Promise.resolve([]),
    ]);
    const open = insights.filter((r) => r.status === "open");
    return NextResponse.json({
      suggestions,
      knowledgeGaps: groupKnowledgeGaps(open),
      failurePoints: open.filter((r) => r.kind === "emotional_failure").slice(0, 30),
      agents: agents.map((a) => ({ id: a.id, name: a.name, versions: versions.filter((v) => v.agentId === a.id) })),
      totals: {
        calls: new Set(insights.map((r) => r.sessionId)).size,
        knowledgeGaps: insights.filter((r) => r.kind === "knowledge_gap").length,
        failurePoints: insights.filter((r) => r.kind === "emotional_failure").length,
      },
    });
  } catch (err) {
    if (err instanceof LearningTablesMissingError) return NextResponse.json({ migrationRequired: true, error: err.message }, { status: 409 });
    console.error("[Insights API]", err);
    return NextResponse.json({ error: "Failed to load insights" }, { status: 500 });
  }
}
