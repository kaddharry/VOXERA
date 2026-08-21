/**
 * Splits a stream of LLM token deltas into speakable clauses as soon as each
 * one is complete, instead of waiting for the whole reply. This is what lets
 * TTS start on sentence 1 while the LLM is still generating sentence 3 — the
 * core trick behind sub-second voice-agent latency (see the research this
 * was built from: ElevenLabs/Vapi/LiveKit all chunk on sentence boundaries
 * and start synthesis on the first complete clause).
 *
 * Flushes on `.!?` followed by whitespace. A safety valve forces a flush
 * past SAFETY_VALVE_CHARS even without terminal punctuation, so a long
 * run-on sentence (or a model that under-punctuates) doesn't silently delay
 * speech — matches the "speak after enough words and a comma" approach
 * documented for production voice agents.
 *
 * Defensive guard: never emits a clause containing an unbalanced `<` —
 * covers the documented Groq quirk (lib/agent/llm.ts's sanitizeReply) of
 * leaking `<function=...>...</function>` tool-call markup directly into
 * message content. Holds the clause back until the tag closes or the
 * stream ends (flush() then hands the raw remainder to the caller, who runs
 * it through the same sanitizer used on the non-streaming path).
 */

const SENTENCE_END_RE = /[.!?]+["')\]]?\s+/g;
const SAFETY_VALVE_CHARS = 150;

export class ClauseChunker {
  private buffer = "";

  /** Feed a new text delta. Returns zero or more clauses now complete and safe to speak, in order. */
  push(delta: string): string[] {
    this.buffer += delta;
    const clauses: string[] = [];

    for (;;) {
      SENTENCE_END_RE.lastIndex = 0;
      const match = SENTENCE_END_RE.exec(this.buffer);
      if (!match) break;

      const end = match.index + match[0].length;
      const candidate = this.buffer.slice(0, end);
      if (!isAngleBracketBalanced(candidate)) {
        // Still inside a partially-streamed tag (e.g. `<function=...>` with
        // no closing `</function>` yet) — hold everything from here until
        // more text arrives or the stream ends. Once balanced, it's safe to
        // emit even though it still contains `<...>` — the caller runs
        // every clause through sanitizeReply(), which strips the whole
        // `<function>...</function>` block correctly once it's complete.
        break;
      }
      const trimmed = candidate.trim();
      if (trimmed) clauses.push(trimmed);
      this.buffer = this.buffer.slice(end);
    }

    if (isAngleBracketBalanced(this.buffer) && this.buffer.length > SAFETY_VALVE_CHARS) {
      const cut = findSafetyValveCut(this.buffer);
      if (cut > 0) {
        const trimmed = this.buffer.slice(0, cut).trim();
        if (trimmed) clauses.push(trimmed);
        this.buffer = this.buffer.slice(cut);
      }
    }

    return clauses;
  }

  /** Call once the stream has ended. Returns any trailing partial text, or null if none. */
  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest.length > 0 ? rest : null;
  }
}

function isAngleBracketBalanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "<") depth++;
    else if (ch === ">") depth = Math.max(0, depth - 1);
  }
  return depth === 0;
}

function findSafetyValveCut(text: string): number {
  const commaIdx = text.lastIndexOf(", ", SAFETY_VALVE_CHARS);
  if (commaIdx > 20) return commaIdx + 2;
  const spaceIdx = text.lastIndexOf(" ", SAFETY_VALVE_CHARS);
  return spaceIdx > 20 ? spaceIdx + 1 : 0;
}
