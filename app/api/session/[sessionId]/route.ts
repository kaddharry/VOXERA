import { getSessionLog } from "@/lib/logging/session-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  if (!sessionId || sessionId.trim().length === 0) {
    return Response.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }

  const events = await getSessionLog(sessionId);
  return Response.json({ sessionId, eventCount: events.length, events });
}
