import { nanoid } from "nanoid";
import { CONFIG } from "../config";
import { seedClientMemory } from "../memory/writer";
import { embed } from "../util/embed";
import { vectorStore } from "../memory/store";
import { chunkText } from "./chunk";
import { supabase } from "../db/supabase";
import { extractPdfText } from "./pdf";
import { generateReply } from "../agent/llm";

export interface IngestResult {
  documentId: string;
  clientId: string;
  chunkCount: number;
  chunkIds: string[];
  /** First ~4000 chars of the extracted text — lets a caller (e.g. Agent
   * Builder's AI-generate flow) ground an LLM prompt in the document's real
   * content without a second read/extraction pass. Not chunk-boundary-aware,
   * just a raw prefix — fine for "give the model some real context," not
   * meant as a faithful excerpt. */
  extractedTextPreview: string;
}

/**
 * Ingests a document into the LTM_client knowledge base.
 *
 * Workflow:
 *  1. Determines the version number for the document.
 *  2. Creates a record in knowledge_documents table as 'processing'.
 *  3. Extracts raw text from the buffer (plain text or PDF).
 *  4. Splits the text into overlapping chunks.
 *  5. Embeds each chunk and stores it in memories table referencing the documentId.
 *  6. Marks prior versions as 'superseded' and deletes their chunks.
 *  7. Sets document status to 'ready' and saves chunk count.
 *  8. On failure, sets status to 'failed' and saves the error message.
 */
export async function ingestDocument(args: {
  clientId: string;
  filename: string;
  content: Buffer | Uint8Array;
  mimeType: string;
}): Promise<IngestResult> {
  const { clientId, filename, mimeType } = args;
  const documentId = nanoid(12);

  // Check for prior versions of this document
  const { data: existingDocs } = await supabase
    .from("knowledge_documents")
    .select("version")
    .eq("clientId", clientId)
    .eq("filename", filename);

  let version = 1;
  if (existingDocs && existingDocs.length > 0) {
    const maxVersion = Math.max(...existingDocs.map((d) => d.version));
    version = maxVersion + 1;
  }

  // Create initial document record
  const { error: insertError } = await supabase
    .from("knowledge_documents")
    .insert({
      id: documentId,
      clientId,
      filename,
      mimeType,
      status: "processing",
      chunkCount: 0,
      version,
      createdAt: Date.now(),
    });

  if (insertError) {
    throw new Error(`Failed to create document record: ${insertError.message}`);
  }

  try {
    // Validate file size.
    if (args.content.byteLength > CONFIG.knowledge.maxFileSizeBytes) {
      throw new Error(
        `File too large: ${args.content.byteLength} bytes (max ${CONFIG.knowledge.maxFileSizeBytes})`,
      );
    }

    // Extract raw text based on mime type. text/markdown, text/csv, and
    // application/json are all readable as plain UTF-8 — the chunker
    // doesn't need structured parsing, just the raw content.
    let rawText: string;
    if (mimeType === "text/plain" || mimeType === "text/markdown" || mimeType === "text/csv" || mimeType === "application/json") {
      rawText = Buffer.from(args.content).toString("utf-8");
    } else if (mimeType === "application/pdf") {
      rawText = await extractPdfText(args.content);
    } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      rawText = await extractDocxText(args.content);
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    if (rawText.trim().length === 0) {
      throw new Error("Document contains no extractable text");
    }

    // Derive a topic from filename (strip extension, normalize).
    const topic = filename
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .toLowerCase()
      .trim() || "knowledge";

    // Chunk the text. A small document (the common case — a 1-page menu,
    // a short FAQ) stays a single chunk here already: chunkText() only
    // splits when the text exceeds CONFIG.knowledge.chunkSize, so nothing
    // extra is needed to keep small files as one block.
    const chunks = chunkText(rawText);
    const chunkIds: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = await seedClientMemory({
        clientId,
        topic: `kb:${topic}`,
        text: chunks[i],
        importance: 0.85,
        documentId,
      });
      chunkIds.push(chunkId);
    }

    // Large documents get grouped into "stacks" of consecutive chunks, each
    // with its own short LLM-written summary stored as an additional,
    // independently-retrievable record with a boosted importance so it
    // tends to rank above any single detail chunk when it's a genuine match
    // for the query. This gives retrieval a natural "check the overview
    // first" signal without a separate multi-step drill-down round trip —
    // a live call can't afford a second query-then-query-again latency hit,
    // so both the summary AND the individual detail chunks are ordinary,
    // simultaneously-retrievable top-K candidates; a summary alone usually
    // already answers a broad question, while a specific detail question
    // naturally ranks its own matching chunk higher regardless of the
    // summary's presence. Below CONFIG.knowledge.stackThresholdChunks
    // (default 20), this is skipped entirely — a small file like a 1-page
    // menu never touches it.
    if (chunks.length > CONFIG.knowledge.stackThresholdChunks) {
      await writeStackSummaries({ clientId, documentId, topic, chunks });
    }

    // Deactivate/supersede old versions
    const { data: oldDocs } = await supabase
      .from("knowledge_documents")
      .select("id")
      .eq("clientId", clientId)
      .eq("filename", filename)
      .neq("id", documentId);

    if (oldDocs && oldDocs.length > 0) {
      const oldDocIds = oldDocs.map((d) => d.id);
      
      await supabase
        .from("knowledge_documents")
        .update({ status: "superseded" })
        .in("id", oldDocIds);

      // Clean up superseded chunks
      await supabase
        .from("memories")
        .delete()
        .in("documentId", oldDocIds);
    }

    // Set new doc status to ready
    const { error: readyError } = await supabase
      .from("knowledge_documents")
      .update({
        status: "ready",
        chunkCount: chunks.length,
      })
      .eq("id", documentId);

    if (readyError) {
      throw readyError;
    }

    return { documentId, clientId, chunkCount: chunks.length, chunkIds, extractedTextPreview: rawText.slice(0, 4000) };
  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : String(err);
    
    await supabase
      .from("knowledge_documents")
      .update({
        status: "failed",
        errorMessage: errMsg,
      })
      .eq("id", documentId);

    throw err;
  }
}

/**
 * Queries the LTM_client knowledge base directly.
 * Returns top-K chunks ranked by semantic similarity.
 */
export async function queryKnowledgeBase(args: {
  clientId: string;
  query: string;
  topK?: number;
}): Promise<Array<{ text: string; topic: string; similarity: number; id: string }>> {
  const queryEmbedding = await embed(args.query, { isQuery: true });
  const topK = args.topK ?? 5;
  const results = await vectorStore.search({
    tier: "LTM_client",
    userId: null,
    clientId: args.clientId,
    query: queryEmbedding,
    topK,
  });

  return results.map((r) => ({
    id: r.rec.id,
    text: r.rec.text,
    topic: r.rec.topic,
    similarity: Number(r.sim.toFixed(4)),
  }));
}

/**
 * Groups `chunks` into consecutive groups of ~CONFIG.knowledge.stackGroupSize,
 * writes one short LLM-generated summary per group as its own memory record
 * (topic suffixed `:overview` so it's identifiable, boosted importance so it
 * tends to outrank a single detail chunk when it's genuinely the better
 * match). Best-effort — a summary that fails to generate is skipped rather
 * than failing the whole ingest, since the underlying detail chunks are
 * already written and independently useful either way.
 */
async function writeStackSummaries(args: {
  clientId: string;
  documentId: string;
  topic: string;
  chunks: string[];
}): Promise<void> {
  const { clientId, documentId, topic, chunks } = args;
  const groupSize = CONFIG.knowledge.stackGroupSize;

  for (let i = 0; i < chunks.length; i += groupSize) {
    const group = chunks.slice(i, i + groupSize);
    const groupText = group.join("\n\n");
    try {
      const summaryReply = await generateReply({
        system:
          "You summarize a section of a business knowledge-base document in ONE short sentence " +
          "(under 30 words) that would help someone decide whether the full detail is worth reading. " +
          "Be concrete — name the actual items/topics covered, don't say generic things like " +
          "\"this section covers various topics\". Output ONLY the summary sentence, nothing else.",
        user: groupText.slice(0, CONFIG.llm.maxInputTokens * 3),
        clientId,
        useTools: false,
        maxOutputTokens: 80,
      });
      const summaryText = summaryReply.text.trim();
      if (!summaryText) continue;

      await seedClientMemory({
        clientId,
        topic: `kb:${topic}:overview`,
        text: `Overview of ${topic} (part ${Math.floor(i / groupSize) + 1}): ${summaryText}`,
        importance: 0.95,
        documentId,
      });
    } catch (err) {
      console.warn(`[Ingest] Stack summary generation failed for group starting at chunk ${i}:`, err);
    }
  }
}

/** DOCX text extraction via mammoth — reads the document.xml body text, dropping styling. */
async function extractDocxText(content: Buffer | Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
