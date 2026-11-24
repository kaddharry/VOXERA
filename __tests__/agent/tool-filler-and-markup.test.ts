import { describe, it, expect, vi } from "vitest";
vi.mock("../../lib/db/supabase", () => ({ supabase: { from: vi.fn() }, isSupabaseHealthy: () => true, recordSupabaseSuccess: vi.fn(), recordSupabaseFailure: vi.fn() }));
import { sanitizeReply, toolFillerPhrase } from "../../lib/agent/llm";

describe("sanitizeReply strips tool-call markup", () => {
  it("never lets a text-form tool call reach the caller", () => {
    expect(sanitizeReply("You bet. </tool_call>")).toBe("You bet.");
    expect(sanitizeReply("<tool_call>{\"name\":\"book_appointment\"}</tool_call>Done.")).toBe("Done.");
    expect(sanitizeReply("Sure [TOOL_CALLS] one moment")).not.toMatch(/TOOL_CALLS/);
  });
});

describe("toolFillerPhrase", () => {
  it("answers in the caller's script and differs for booking vs checking", () => {
    expect(toolFillerPhrase("check_appointment_availability", "any slot tomorrow?")).toMatch(/calendar/i);
    expect(toolFillerPhrase("book_appointment", "yes book it")).toMatch(/book/i);
    expect(toolFillerPhrase("book_appointment", "हाँ, दस बजे")).toMatch(/[ऀ-ॿ]/);
    expect(toolFillerPhrase("check_appointment_availability", "ਹਾਂਜੀ")).toMatch(/[਀-੿]/);
  });
});
