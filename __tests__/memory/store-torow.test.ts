/**
 * Tests: BUG-M1 — toRow() dereferenced rec.vad with no guard
 * (lib/memory/store.ts)
 *
 * fromRow() already defaults vad_v/a/d to 0, but toRow() assumed rec.vad was
 * always present. Any caller constructing a MemoryRecord without VAD threw
 * inside the write path. toRow is not exported, so this exercises it through
 * vectorStore.put() and inspects the row handed to Supabase.
 *
 * Run: npx vitest run __tests__/memory/store-torow.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MemoryRecord } from "../../lib/types";

// Param is declared so mock.calls is typed and indexable below.
const upsertMock = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }));

vi.mock("../../lib/db/supabase", () => ({
  supabase: { from: () => ({ upsert: upsertMock }) },
  isSupabaseHealthy: () => true,
  recordSupabaseFailure: vi.fn(),
  recordSupabaseSuccess: vi.fn(),
}));

import { vectorStore } from "../../lib/memory/store";

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem-1",
    tier: "MTM",
    userId: "user-1",
    clientId: "demo",
    ts: 1_700_000_000_000,
    text: "the signal keeps dropping",
    summary: "signal drops",
    entities: [],
    topic: "connectivity",
    emotion: "frustration",
    vad: { v: -0.6, a: 0.6, d: 0.2 },
    intensity: 0.7,
    importance: 0.8,
    embedding: [0.1, 0.2],
    sourceUtteranceIds: [],
    recurrence: 1,
    resolved: false,
    ...overrides,
  } as MemoryRecord;
}

describe("BUG-M1 — toRow tolerates a missing vad", () => {
  beforeEach(() => upsertMock.mockClear());

  it("does not throw when vad is undefined", async () => {
    const rec = record();
    delete (rec as Partial<MemoryRecord>).vad;

    await expect(vectorStore.put(rec)).resolves.not.toThrow();
    expect(upsertMock).toHaveBeenCalled();
  });

  it("writes 0/0/0, matching fromRow's defaults", async () => {
    const rec = record();
    delete (rec as Partial<MemoryRecord>).vad;

    await vectorStore.put(rec);

    expect(upsertMock.mock.calls[0][0]).toMatchObject({ vad_v: 0, vad_a: 0, vad_d: 0 });
  });

  it("still writes real VAD values unchanged", async () => {
    await vectorStore.put(record());

    expect(upsertMock.mock.calls[0][0]).toMatchObject({ vad_v: -0.6, vad_a: 0.6, vad_d: 0.2 });
  });

  it("treats a partially populated vad as 0 on the missing axes", async () => {
    await vectorStore.put(record({ vad: { v: -0.4 } as MemoryRecord["vad"] }));

    expect(upsertMock.mock.calls[0][0]).toMatchObject({ vad_v: -0.4, vad_a: 0, vad_d: 0 });
  });
});
