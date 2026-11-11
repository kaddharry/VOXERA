import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../lib/db/server";
import { getTenantIdForUser } from "../../../../lib/db/agents";
import { addToWaitlist, listWaitlistEntries } from "../../../../lib/db/waitlist";

export const dynamic = "force-dynamic";

const CreateWaitlistSchema = z.object({
  patientId: z.string().min(1),
  providerId: z.string().uuid().nullable().optional(),
  desiredVisitType: z.enum(["consultation", "follow_up", "procedure", "telehealth", "other"]).nullable().optional(),
  windowStart: z.string().datetime({ offset: true }).nullable().optional(),
  windowEnd: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const providerId = request.nextUrl.searchParams.get("providerId") ?? undefined;
  const statusParam = request.nextUrl.searchParams.get("status");
  const status = (["open", "offered", "booked", "expired", "cancelled"] as const).includes(statusParam as any)
    ? (statusParam as "open" | "offered" | "booked" | "expired" | "cancelled")
    : undefined;

  const entries = await listWaitlistEntries(supabase, user.id, { providerId, status });
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await getTenantIdForUser(supabase, user.id);
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = CreateWaitlistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const entry = await addToWaitlist(supabase, tenantId, user.id, parsed.data);
  if (!entry) return NextResponse.json({ error: "Failed to add to waitlist" }, { status: 500 });
  return NextResponse.json({ entry }, { status: 201 });
}
