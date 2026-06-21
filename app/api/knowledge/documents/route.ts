import { NextRequest } from "next/server";
import { createClient } from "@/lib/db/server";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — Retrieve a list of documents for this client with search and pagination.
 */
export async function GET(request: NextRequest) {
  const supabaseServer = await createClient();
  const { data: { user } } = await supabaseServer.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = user.id;

  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? "";
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);

  const start = (page - 1) * limit;
  const end = start + limit - 1;

  try {
    // 1. Build counts query
    let countQuery = supabase
      .from("knowledge_documents")
      .select("*", { count: "exact", head: true })
      .eq("clientId", clientId);

    if (search.trim()) {
      countQuery = countQuery.ilike("filename", `%${search}%`);
    }

    const { count, error: countError } = await countQuery;
    if (countError) throw countError;

    // 2. Build list query
    let query = supabase
      .from("knowledge_documents")
      .select("*")
      .eq("clientId", clientId)
      .order("createdAt", { ascending: false })
      .range(start, end);

    if (search.trim()) {
      query = query.ilike("filename", `%${search}%`);
    }

    const { data: documents, error: dataError } = await query;
    if (dataError) throw dataError;

    return Response.json({
      documents: documents ?? [],
      totalCount: count ?? 0,
      page,
      limit,
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE — Deletes a document by ID and removes all its vector chunks.
 */
export async function DELETE(request: NextRequest) {
  const supabaseServer = await createClient();
  const { data: { user } } = await supabaseServer.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = user.id;

  const url = new URL(request.url);
  const docId = url.searchParams.get("id");

  if (!docId) {
    return Response.json({ error: "Missing document id" }, { status: 400 });
  }

  try {
    // Verify document belongs to this client
    const { data: doc, error: getError } = await supabase
      .from("knowledge_documents")
      .select("id, clientId")
      .eq("id", docId)
      .single();

    if (getError || !doc) {
      return Response.json({ error: "Document not found" }, { status: 404 });
    }

    if (doc.clientId !== clientId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    // Delete chunks (ON DELETE CASCADE should cover it, but we double-verify here)
    await supabase
      .from("memories")
      .delete()
      .eq("documentId", docId);

    // Delete document row
    const { error: deleteError } = await supabase
      .from("knowledge_documents")
      .delete()
      .eq("id", docId);

    if (deleteError) throw deleteError;

    return Response.json({ success: true, message: "Document deleted successfully" });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
