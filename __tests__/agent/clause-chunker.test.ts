import { describe, it, expect } from "vitest";
import { ClauseChunker } from "../../lib/agent/clause-chunker";

describe("ClauseChunker", () => {
  it("emits a clause as soon as sentence-ending punctuation + whitespace arrives", () => {
    const c = new ClauseChunker();
    expect(c.push("Hello there. ")).toEqual(["Hello there."]);
  });

  it("holds a clause back until a token delta completes it", () => {
    const c = new ClauseChunker();
    expect(c.push("Hello ")).toEqual([]);
    expect(c.push("there")).toEqual([]);
    expect(c.push(". ")).toEqual(["Hello there."]);
  });

  it("emits multiple clauses that arrive in a single delta, in order", () => {
    const c = new ClauseChunker();
    expect(c.push("First one. Second one! Third? ")).toEqual(["First one.", "Second one!", "Third?"]);
  });

  it("does not split on a mid-sentence abbreviation period followed by no whitespace boundary trick — only flushes on punctuation+whitespace", () => {
    const c = new ClauseChunker();
    // No trailing whitespace after the final '.', so nothing flushes yet.
    expect(c.push("Sure, one moment.")).toEqual([]);
  });

  it("safety valve flushes a long run-on without terminal punctuation, preferring a comma boundary", () => {
    const c = new ClauseChunker();
    const longText = "So here is a fairly long explanation of the situation, with quite a lot of clauses packed in one single breath and absolutely no period anywhere in sight just yet";
    const clauses = c.push(longText);
    expect(clauses.length).toBeGreaterThan(0);
    expect(clauses[0].length).toBeLessThan(longText.length);
  });

  it("holds back a clause containing an unbalanced '<' (partial function-call tag leak)", () => {
    const c = new ClauseChunker();
    expect(c.push("Sure. <function=cancel_booking>{\"id\": ")).toEqual(["Sure."]);
    // still buffering the unclosed tag — nothing more emitted yet
    const more = c.push('"123"}</function> done. ');
    // once balanced, subsequent pushes can proceed normally (the whole
    // buffered tag content flushes together once its sentence boundary hits)
    expect(more.join(" ")).toContain("done.");
  });

  it("flush() returns any trailing partial text once the stream ends", () => {
    const c = new ClauseChunker();
    c.push("No terminal punctuation here");
    expect(c.flush()).toBe("No terminal punctuation here");
  });

  it("flush() returns null when nothing is buffered", () => {
    const c = new ClauseChunker();
    c.push("Complete sentence. ");
    expect(c.flush()).toBeNull();
  });
});
