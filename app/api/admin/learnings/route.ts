import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { createSupabaseLearningStore, LearningTableMissingError } from "../../../../lib/learning/store";
import { invalidateLearningContext } from "../../../../lib/learning";

export const dynamic = "force-dynamic";

/** GET /api/admin/learnings?agentId=… — lessons for one agent plus the global lessons shared by all agents. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const agentId = new URL(req.url).searchParams.get("agentId");
  try {
    const store = createSupabaseLearningStore(supabase);
    const [agent, global] = await Promise.all([
      agentId ? store.listAgent(user.id, agentId, ["active", "pending"]) : Promise.resolve([]),
      store.listGlobal(user.id, ["active", "pending"]),
    ]);
    return NextResponse.json({ agent, global });
  } catch (err) {
    if (err instanceof LearningTableMissingError) return NextResponse.json({ agent: [], global: [], setupNeeded: true });
    return NextResponse.json({ error: "Could not load learnings." }, { status: 500 });
  }
}

/** DELETE /api/admin/learnings?learningId=… — drop one agent or global lesson. */
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const learningId = new URL(req.url).searchParams.get("learningId");
  if (!learningId) return NextResponse.json({ error: "learningId required" }, { status: 400 });
  try {
    const store = createSupabaseLearningStore(supabase);
    const [global, ...perAgent] = await Promise.all([store.listGlobal(user.id, ["active", "pending"]), store.listAllAgentLessons(user.id)]);
    const target = [...global, ...perAgent.flat()].find((l) => l.id === learningId);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await store.remove(target.id);
    invalidateLearningContext(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof LearningTableMissingError) return NextResponse.json({ error: "Call learning isn't set up yet." }, { status: 503 });
    return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  }
}
