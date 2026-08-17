import { nanoid } from "nanoid";
import { CONFIG } from "../config";
import { seedClientMemory } from "../memory/writer";
import { embed } from "../util/embed";
import { vectorStore } from "../memory/store";
import { chunkText } from "./chunk";
import { supabase } from "../db/supabase";

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

    // Chunk the text.
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
 * PDF text extraction via pdf-parse v2, which rewrote the package's whole
 * API — v1 exported a single callable function (`pdfParse(buffer)`); v2
 * has no default export at all and instead exposes a `PDFParse` class
 * (`new PDFParse({ data }).getText()`). Calling the old function-style API
 * against v2 doesn't throw MODULE_NOT_FOUND, it throws "is not a
 * function", which was surfacing as an opaque 500 on every PDF upload.
 */
async function extractPdfText(content: Buffer | Uint8Array): Promise<string> {
  let parser: InstanceType<typeof import("pdf-parse").PDFParse> | undefined;
  try {
    // Dynamic import so the module is optional — the rest of the
    // knowledge base still works with plain text files if pdf-parse
    // is not installed.
    const { PDFParse } = await import("pdf-parse");
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    parser = new PDFParse({ data });
    const result = await parser.getText();
    return result.text;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
      throw new Error(
        "pdf-parse is not installed. Run: npm install pdf-parse",
      );
    }
    throw err;
  } finally {
    await parser?.destroy();
  }
}

/** DOCX text extraction via mammoth — reads the document.xml body text, dropping styling. */
async function extractDocxText(content: Buffer | Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
