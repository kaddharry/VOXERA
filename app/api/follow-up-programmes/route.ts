import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../lib/db/server";
import { createProgramme, listProgrammes, type ProgrammeStep } from "../../../lib/db/follow-up-programmes";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const programmes = await listProgrammes(supabase, user.id);
  return NextResponse.json({ programmes });
}

/** POST /api/follow-up-programmes — { name, steps: [{dayOffset, label}], ... }. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  const steps: ProgrammeStep[] = Array.isArray(body.steps)
    ? body.steps.filter((s: any) => typeof s?.dayOffset === "number" && typeof s?.label === "string")
    : [];
  if (steps.length === 0) {
    return NextResponse.json({ error: "At least one step ({dayOffset, label}) is required." }, { status: 400 });
  }

  const programme = await createProgramme(supabase, user.id, {
    name: body.name,
    description: typeof body.description === "string" ? body.description : null,
    steps,
    agentId: body.agentId ?? null,
    maxAttempts: Number(body.maxAttempts ?? 3),
    retryDelayMinutes: Number(body.retryDelayMinutes ?? 30),
    windowStartMinute: typeof body.windowStartMinute === "number" ? body.windowStartMinute : null,
    windowEndMinute: typeof body.windowEndMinute === "number" ? body.windowEndMinute : null,
  });
  if (!programme) return NextResponse.json({ error: "Failed to create programme" }, { status: 500 });
  return NextResponse.json({ programme }, { status: 201 });
}
