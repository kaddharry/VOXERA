import { describe, it, expect, vi } from "vitest";
vi.mock("../../lib/db/supabase", () => ({ supabase: { from: vi.fn() }, isSupabaseHealthy: () => true, recordSupabaseSuccess: vi.fn(), recordSupabaseFailure: vi.fn() }));
import { sanitizeReply, toolFillerPhrase, looksLikeToolMarkup, stripToolMarkup } from "../../lib/agent/llm";

describe("sanitizeReply strips tool-call markup", () => {
  it("never lets a text-form tool call reach the caller", () => {
    expect(sanitizeReply("You bet. </tool_call>")).toBe("You bet.");
    expect(sanitizeReply("<tool_call>{\"name\":\"book_appointment\"}</tool_call>Done.")).toBe("Done.");
    expect(sanitizeReply("Sure [TOOL_CALLS] one moment")).not.toMatch(/TOOL_CALLS/);
  });
});

describe("looksLikeToolMarkup", () => {
  it("recognises every text-form tool call seen live", () => {
    expect(looksLikeToolMarkup("[Tool call: check_appointment_availability {providerId: abc}]")).toBe(true);
    expect(looksLikeToolMarkup("</tool_call>")).toBe(true);
    expect(looksLikeToolMarkup('{providerId: "x", startsAt: "2026"}')).toBe(true);
    expect(looksLikeToolMarkup("book_appointment")).toBe(true);
  });
  it("leaves normal speech alone", () => {
    expect(looksLikeToolMarkup("I can check the calendar and book that for you.")).toBe(false);
    expect(looksLikeToolMarkup("Your appointment is on Friday at 3 pm.")).toBe(false);
  });
  it("sanitizeReply strips the bracketed form", () => {
    expect(sanitizeReply("Sure. [Tool call: book_appointment {a: 1}] Done.")).toBe("Sure. Done.");
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

describe("stripToolMarkup", () => {
  it("removes a whole bracketed call inside one clause and keeps the speech around it", () => {
    expect(stripToolMarkup("Sure. [Tool call: book_appointment {a: 1}] Done.", false)).toEqual({ text: "Sure.  Done.", open: false });
  });
  it("swallows a call split across clauses, keeping what follows the closing bracket", () => {
    let r = stripToolMarkup('Let me look. [Tool call: check_appointment_availability {providerId: "abc"', false);
    expect(r).toEqual({ text: "Let me look. ", open: true });
    r = stripToolMarkup('date: "2026-11-26"}] Tomorrow is open.', r.open);
    expect(r).toEqual({ text: " Tomorrow is open.", open: false });
  });
  it("swallows a middle fragment that has no bracket at all", () => {
    expect(stripToolMarkup('date: "2026-11-26",', true)).toEqual({ text: "", open: true });
  });
  it("never touches normal speech", () => {
    expect(stripToolMarkup("I can book that for you tomorrow.", false)).toEqual({ text: "I can book that for you tomorrow.", open: false });
  });
});
