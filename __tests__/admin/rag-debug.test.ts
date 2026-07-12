import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Hoisted mocks for module resolutions
const mockGetUser = vi.hoisted(() => vi.fn());
const mockRetrieve = vi.hoisted(() => vi.fn());

vi.mock("../../lib/db/server", () => ({
  createClient: vi.fn().mockImplementation(() => Promise.resolve({
    auth: {
      getUser: mockGetUser,
    }
  })),
}));

vi.mock("../../lib/memory/retrieval", () => ({
  retrieve: mockRetrieve,
}));

vi.mock("../../lib/bootstrap", () => ({
  ensureSeeded: vi.fn().mockResolvedValue(undefined),
  DEMO: { userId: "user_42", clientId: "acme-telecom" }
}));

// Now import POST after mocking has been set up
import { POST } from "../../app/api/admin/rag-debug/route";

describe("POST /api/admin/rag-debug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 Unauthorized if no authenticated user is found", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const req = new NextRequest("http://localhost:3000/api/admin/rag-debug", {
      method: "POST",
      body: JSON.stringify({ queryText: "test query" }),
    });

    const response = await POST(req);
    expect(response.status).toBe(401);
    
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 Bad Request if queryText is missing", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "client-123" } } });

    const req = new NextRequest("http://localhost:3000/api/admin/rag-debug", {
      method: "POST",
      body: JSON.stringify({ userId: "user_42" }),
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
    
    const body = await response.json();
    expect(body.error).toBe("Missing queryText parameter");
  });

  it("returns retrieved context and timeline when called with correct parameters", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "client-123" } } });
    
    const mockRetrievedData = {
      stm: [],
      mtm: [{ id: "mem-123", summary: "matched memory" }],
      ltmUser: [],
      ltmClient: [],
      scores: [{ id: "mem-123", score: 0.85 }],
      explanations: {
        "mem-123": { memoryId: "mem-123", reason: "good similarity", metrics: { similarity: 0.85, importance: 0.6, recency: 0.9, retrievalFrequency: 1, rawScore: 0.85 } }
      },
      timeline: []
    };
    mockRetrieve.mockResolvedValueOnce(mockRetrievedData);

    const req = new NextRequest("http://localhost:3000/api/admin/rag-debug", {
      method: "POST",
      body: JSON.stringify({ 
        queryText: "my signal drops", 
        userId: "user_99",
        emotionLabel: "frustration",
        intensity: 0.7 
      }),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    
    const body = await response.json();
    expect(body.retrieved).toEqual(mockRetrievedData);
    
    // Verify retrieve was called with the correct client/user structure
    expect(mockRetrieve).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "client-123",
      userId: "user_99",
      queryText: "my signal drops",
      emotion: expect.objectContaining({
        current: expect.objectContaining({
          label: "frustration",
          intensity: 0.7
        })
      })
    }));
  });
});
