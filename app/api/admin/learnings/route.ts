import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { createSupabaseLearningStore, LearningTableMissingError } from "../../../../lib/learning/store";
import { invalidateLearningContext } from "../../../../lib/learning";
import { REVIEW_APPROVED, REVIEW_PENDING, REVIEW_REJECTED } from "../../../../lib/learning/clinical";
import { getTenantIdForUser, listAgentsForTenant } from "../../../../lib/db/agents";
import { listPatients } from "../../../../lib/db/patients";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/learnings            — everything learned: facts per patient, lessons per agent, shared lessons.
 * GET /api/admin/learnings?agentId=…  — lessons for one agent plus the shared ones.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const agentId = new URL(req.url).searchParams.get("agentId");
  try {
    const store = createSupabaseLearningStore(supabase);
    if (!agentId) {
      const tenantId = await getTenantIdForUser(supabase, user.id);
      const [facts, lessons, shared, patients, agents] = await Promise.all([
        store.listAllPatient(user.id),
        store.listAllAgentLessons(user.id),
        store.listGlobal(user.id, ["active", "pending"]),
        listPatients(supabase, user.id),
        tenantId ? listAgentsForTenant(supabase, tenantId) : Promise.resolve([]),
      ]);
      const nameOf = new Map(patients.map((p) => [p.id, p.name]));
      const agentName = new Map(agents.map((a) => [a.id, a.name]));
      const byPatient = new Map<string, typeof facts>();
      for (const f of facts) byPatient.set(f.patientId!, [...(byPatient.get(f.patientId!) ?? []), f]);
            // Clinical lessons wait for a person; they are listed separately and are never counted as active.
      const needsReview = [
        ...lessons.filter((l) => l.key === REVIEW_PENDING).map((l) => ({ ...l, agentName: agentName.get(l.agentId!) ?? "Agent" })),
        ...shared.filter((l) => l.key === REVIEW_PENDING).map((l) => ({ ...l, agentName: "All agents" })),
      ];
      const isReview = (l: { key: string | null }) => l.key === REVIEW_PENDING;
      const lessonsNoReview = lessons.filter((l) => !isReview(l));
      const sharedNoReview = shared.filter((l) => !isReview(l));
      const byAgentClean = new Map<string, typeof lessons>();
      for (const l of lessonsNoReview) byAgentClean.set(l.agentId!, [...(byAgentClean.get(l.agentId!) ?? []), l]);
      return NextResponse.json({
        patients: [...byPatient].map(([id, list]) => ({ id, name: nameOf.get(id) ?? "Unknown patient", facts: list })),
        agents: [...byAgentClean].map(([id, list]) => ({ id, name: agentName.get(id) ?? "Agent", lessons: list })),
        shared: sharedNoReview,
        needsReview,
        totals: {
          patientFacts: facts.length,
          agentLessons: lessonsNoReview.filter((l) => l.status === "active").length,
          shared: sharedNoReview.filter((l) => l.status === "active").length,
          pending: lessonsNoReview.filter((l) => l.status === "pending").length,
          review: needsReview.length,
        },
      });
    }
    const [agent, global] = await Promise.all([
      agentId ? store.listAgent(user.id, agentId, ["active", "pending"]) : Promise.resolve([]),
      store.listGlobal(user.id, ["active", "pending"]),
    ]);
    return NextResponse.json({ agent, global });
  } catch (err) {
    if (err instanceof LearningTableMissingError) return NextResponse.json({ agent: [], global: [], patients: [], agents: [], shared: [], needsReview: [], totals: { patientFacts: 0, agentLessons: 0, shared: 0, pending: 0, review: 0 }, setupNeeded: true });
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
    const [global, agentLessons, patientFacts] = await Promise.all([store.listGlobal(user.id, ["active", "pending"]), store.listAllAgentLessons(user.id), store.listAllPatient(user.id)]);
    const target = [...global, ...agentLessons, ...patientFacts].find((l) => l.id === learningId);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await store.remove(target.id);
    invalidateLearningContext(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof LearningTableMissingError) return NextResponse.json({ error: "Call learning isn't set up yet." }, { status: 503 });
    return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/learnings?learningId=…  body { action: "approve" | "reject" }
 * A person decides on a clinical lesson. Approve: it goes live (for its agent, or for all agents if shared).
 * Reject: it is kept out of every call and is not proposed again.
 */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const learningId = new URL(req.url).searchParams.get("learningId");
  const body = await req.json().catch(() => ({}));
  if (!learningId || (body.action !== "approve" && body.action !== "reject")) return NextResponse.json({ error: "learningId and action (approve|reject) required" }, { status: 400 });
  try {
    const store = createSupabaseLearningStore(supabase);
    const all = [...(await store.listGlobal(user.id, ["active", "pending"])), ...(await store.listAllAgentLessons(user.id))];
    const target = all.find((l) => l.id === learningId);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (target.key !== REVIEW_PENDING) return NextResponse.json({ error: "This lesson is not waiting for review." }, { status: 409 });
    const now = Date.now();
    await store.update(
      target.id,
      body.action === "approve" ? { key: REVIEW_APPROVED, status: "active", updatedAt: now } : { key: REVIEW_REJECTED, status: "retired", updatedAt: now },
    );
    invalidateLearningContext(user.id);
    return NextResponse.json({ ok: true, status: body.action === "approve" ? "active" : "rejected" });
  } catch (err) {
    if (err instanceof LearningTableMissingError) return NextResponse.json({ error: "Call learning isn't set up yet." }, { status: 503 });
    return NextResponse.json({ error: "Could not save the decision." }, { status: 500 });
  }
}
