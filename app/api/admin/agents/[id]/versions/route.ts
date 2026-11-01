import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../../../lib/db/server";
import { getTenantIdForUser } from "../../../../../../lib/db/agents";
import { LearningTablesMissingError, SuggestionError, listVersions, restoreVersion } from "../../../../../../lib/db/agent-learning";

export const dynamic = "force-dynamic";

async function auth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

/** GET /api/admin/agents/[id]/versions — the agent's instruction versions, newest first. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await auth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json({ versions: await listVersions(supabase, user.id, id) });
  } catch (err) {
    if (err instanceof LearningTablesMissingError) return NextResponse.json({ migrationRequired: true, error: err.message }, { status: 409 });
    return NextResponse.json({ error: "Failed to load versions" }, { status: 500 });
  }
}

const Body = z.object({ restore: z.number().int().positive() });

/** POST /api/admin/agents/[id]/versions {restore: n} — puts version n's instructions back (as a new version). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await auth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const { id } = await params;
  try {
    const tenantId = await getTenantIdForUser(supabase, user.id);
    if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    const version = await restoreVersion(supabase, user.id, tenantId, id, parsed.data.restore);
    return NextResponse.json({ version });
  } catch (err) {
    if (err instanceof SuggestionError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof LearningTablesMissingError) return NextResponse.json({ migrationRequired: true, error: err.message }, { status: 409 });
    console.error("[Agent Versions API]", err);
    return NextResponse.json({ error: "Failed to restore the version" }, { status: 500 });
  }
}
