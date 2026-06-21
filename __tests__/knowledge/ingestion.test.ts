/**
 * Tests: Knowledge Ingestion Engine (lib/knowledge/ingest.ts)
 * Sprint 3 — FR-16 Knowledge Base Management, versioning, status, error logs
 *
 * Run: npm run test:run
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ingestDocument } from "../../lib/knowledge/ingest";
import { supabase } from "../../lib/db/supabase";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock seedClientMemory so we don't call real embeddings or vector store
vi.mock("../../lib/memory/writer", () => ({
  seedClientMemory: vi.fn().mockResolvedValue("chunk-id-123"),
}));

// Mock pdf-parse
vi.mock("pdf-parse", () => {
  return {
    default: vi.fn().mockResolvedValue({ text: "Mocked PDF text content" }),
  };
});

// A single, robust, chainable mock database helper
const mockChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  neq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  then: vi.fn().mockImplementation((onfulfilled) => {
    return Promise.resolve({ data: [], error: null }).then(onfulfilled);
  }),
};

vi.mock("../../lib/db/supabase", () => {
  return {
    supabase: {
      from: vi.fn(() => mockChain),
    },
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ingestDocument — Ingestion & State Machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset the default then mock to return empty list
    mockChain.then.mockImplementation((onfulfilled) => {
      return Promise.resolve({ data: [], error: null }).then(onfulfilled);
    });
  });

  it("handles basic plain text ingestion successfully", async () => {
    // Call under test
    const result = await ingestDocument({
      clientId: "client-abc",
      filename: "test-rules.txt",
      content: Buffer.from("Voxera is an AI voice receptionist. Rules: Be friendly."),
      mimeType: "text/plain",
    });

    expect(result.documentId).toBeDefined();
    expect(result.clientId).toBe("client-abc");
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.chunkIds).toContain("chunk-id-123");
  });

  it("determines next version number if document already exists", async () => {
    // Setup select to return two existing versions (version 1 and 2)
    mockChain.then
      .mockImplementationOnce((onfulfilled) => {
        return Promise.resolve({ data: [{ version: 1 }, { version: 2 }], error: null }).then(onfulfilled);
      })
      .mockImplementationOnce((onfulfilled) => {
        return Promise.resolve({ error: null }).then(onfulfilled);
      });

    // Run ingestion
    await ingestDocument({
      clientId: "client-abc",
      filename: "faq.txt",
      content: Buffer.from("Test question. Test answer."),
      mimeType: "text/plain",
    });

    // Verify insert was called with version 3
    expect(mockChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "faq.txt",
        version: 3,
        status: "processing",
      })
    );
  });

  it("supersedes older versions and deletes their vector chunks", async () => {
    // Mock the sequence of DB calls
    mockChain.then
      .mockImplementationOnce((onfulfilled) => {
        // 1. check version -> none
        return Promise.resolve({ data: [], error: null }).then(onfulfilled);
      })
      .mockImplementationOnce((onfulfilled) => {
        // 2. insert -> success
        return Promise.resolve({ error: null }).then(onfulfilled);
      })
      .mockImplementationOnce((onfulfilled) => {
        // 3. check old documents -> returns one older version id "old-doc-1"
        return Promise.resolve({ data: [{ id: "old-doc-1" }], error: null }).then(onfulfilled);
      })
      .mockImplementationOnce((onfulfilled) => {
        // 4. update old docs status -> success
        return Promise.resolve({ error: null }).then(onfulfilled);
      })
      .mockImplementationOnce((onfulfilled) => {
        // 5. delete old doc chunks -> success
        return Promise.resolve({ error: null }).then(onfulfilled);
      })
      .mockImplementationOnce((onfulfilled) => {
        // 6. update new doc ready -> success
        return Promise.resolve({ error: null }).then(onfulfilled);
      });

    // Run ingestion
    await ingestDocument({
      clientId: "client-abc",
      filename: "policy.txt",
      content: Buffer.from("All bookings require 24 hour cancellation notice."),
      mimeType: "text/plain",
    });

    // Verify it called delete on memories for oldDocIds
    expect(supabase.from).toHaveBeenCalledWith("memories");
    expect(mockChain.delete).toHaveBeenCalled();
    expect(mockChain.in).toHaveBeenCalledWith("documentId", ["old-doc-1"]);
  });

  it("logs errors and sets status to 'failed' if text extraction throws", async () => {
    // Mock sequence of DB calls
    mockChain.then
      .mockImplementationOnce((onfulfilled) => {
        // 1. check version -> none
        return Promise.resolve({ data: [], error: null }).then(onfulfilled);
      })
      .mockImplementationOnce((onfulfilled) => {
        // 2. insert -> success
        return Promise.resolve({ error: null }).then(onfulfilled);
      })
      .mockImplementationOnce((onfulfilled) => {
        // 3. update failed doc status -> success
        return Promise.resolve({ error: null }).then(onfulfilled);
      });

    // Try ingesting empty file which throws an error
    await expect(
      ingestDocument({
        clientId: "client-abc",
        filename: "empty.txt",
        content: Buffer.from(""), // empty content -> triggers throw
        mimeType: "text/plain",
      })
    ).rejects.toThrow("Document contains no extractable text");

    // Verify status was set to failed in metadata
    expect(mockChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorMessage: "Document contains no extractable text",
      })
    );
  });
});
