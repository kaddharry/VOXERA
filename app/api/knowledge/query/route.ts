import type { NextRequest } from "next/server";
import { DEMO, ensureSeeded } from "@/lib/bootstrap";
import { queryKnowledgeBase } from "@/lib/knowledge/ingest";
import { vectorStore } from "@/lib/memory/store";
import { createClient } from "@/lib/db/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  await ensureSeeded();

  const body = (await request.json()) as {
    query?: string;
    clientId?: string;
    topK?: number;
    listAll?: boolean;
  };

  // Get authenticated clientId
  const supabaseServer = await createClient();
  const { data: { user } } = await supabaseServer.auth.getUser();
  const clientId = user?.id ?? body.clientId ?? DEMO.clientId;

  // List all LTM_client entries (for knowledge base list view)
  if (body.listAll) {
    const entries = await vectorStore.byTier("LTM_client", null, clientId);
    const results = entries.map((e) => ({
      id: e.id,
      topic: e.topic,
      text: e.text,
      importance: e.importance,
    }));
    return Response.json({ results });
  }

  if (!body.query || body.query.trim().length === 0) {
    return Response.json(
      { error: "query is required" },
      { status: 400 },
    );
  }

  const topK = body.topK ?? 5;
  const results = await queryKnowledgeBase({
    clientId,
    query: body.query,
    topK,
  });

  return Response.json({ query: body.query, clientId, results });
}
