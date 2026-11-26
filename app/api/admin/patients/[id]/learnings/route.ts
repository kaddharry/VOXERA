import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "../../../../../../lib/auth/access";
import type { Permission } from "../../../../../../lib/auth/permissions";
import { getPatient } from "../../../../../../lib/db/patients";
import { createSupabaseLearningStore, LearningTableMissingError } from "../../../../../../lib/learning/store";
import { invalidateLearningContext } from "../../../../../../lib/learning";

export const dynamic = "force-dynamic";

async function authorize(params: Promise<{ id: string }>, permission: Permission = "patients.read") {
  const guard = await requireAccess(permission);
  if (!guard.ok) return { error: guard.response } as const;
  const supabase = guard.access.db;
  const user = { id: guard.access.clientId };
  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
  return { supabase, user, id } as const;
}

/** GET /api/admin/patients/[id]/learnings — what the agents have learned about this patient. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params);
  if ("error" in auth) return auth.error;
  try {
    const learnings = await createSupabaseLearningStore(auth.supabase).listPatient(auth.user.id, auth.id, ["active"]);
    return NextResponse.json({ learnings: learnings.sort((a, b) => b.updatedAt - a.updatedAt) });
  } catch (err) {
    if (err instanceof LearningTableMissingError) return NextResponse.json({ learnings: [], setupNeeded: true });
    return NextResponse.json({ error: "Could not load learnings." }, { status: 500 });
  }
}

/** DELETE /api/admin/patients/[id]/learnings?learningId=… — forget one learned fact (or all with ?all=1). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params, "patients.write");
  if ("error" in auth) return auth.error;
  const store = createSupabaseLearningStore(auth.supabase);
  try {
    const mine = await store.listPatient(auth.user.id, auth.id, ["active", "pending", "retired"]);
    const url = new URL(req.url);
    const targets = url.searchParams.get("all") === "1" ? mine : mine.filter((l) => l.id === url.searchParams.get("learningId"));
    if (targets.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    for (const t of targets) await store.remove(t.id);
    invalidateLearningContext(auth.user.id);
    return NextResponse.json({ ok: true, removed: targets.length });
  } catch (err) {
    if (err instanceof LearningTableMissingError) return NextResponse.json({ error: "Call learning isn't set up yet." }, { status: 503 });
    return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  }
}
