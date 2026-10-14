import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { supabase as supabaseService } from "../../../../lib/db/supabase";
import { getDemoRequest, linkDemoRequestToUser } from "../../../../lib/db/demo-requests";

export const dynamic = "force-dynamic";

/**
 * Reads/writes here use the SERVICE ROLE client, not the per-request cookie
 * client — demo_requests' RLS (migration_v20.sql) only grants anonymous
 * INSERT and owner SELECT; there is deliberately no authenticated-UPDATE
 * policy, since status transitions are meant to be server-controlled, not
 * directly writable by the client. The cookie-bound client is still used
 * to establish WHO the caller is (auth.getUser()); ownership is then
 * checked in application code against that id.
 */

/** GET /api/demo-requests/[id] — authenticated; only returns a request
 * already linked to the caller (the /book-demo/confirm page polls this). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const request = await getDemoRequest(supabaseService, id);
  if (!request || request.linkedUserId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ request });
}

/** POST /api/demo-requests/[id] — links this still-unclaimed request to the
 * now-authenticated caller (spec §5.3 step 4). Safe to call repeatedly;
 * only succeeds once per request (see linkDemoRequestToUser's WHERE guard),
 * and returns the already-linked request on a later call from the same
 * owner rather than erroring. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const linked = await linkDemoRequestToUser(supabaseService, id, user.id);
  if (linked) return NextResponse.json({ request: linked });

  const existing = await getDemoRequest(supabaseService, id);
  if (existing?.linkedUserId === user.id) return NextResponse.json({ request: existing });
  return NextResponse.json({ error: "This demo request is invalid or already claimed." }, { status: 409 });
}
