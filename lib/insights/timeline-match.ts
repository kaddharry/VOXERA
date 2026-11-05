/**
 * Pairs an emotion/acoustic/cai session-log event with the utterance it
 * actually belongs to, for display (e.g. the Emotion Timeline's "what was
 * said" callout).
 *
 * BUG-E12: the Sessions admin page used to pair these purely by nearest
 * timestamp (`events.ts`), even though lib/agent/orchestrator.ts already
 * writes a `utteranceId` onto both the "emotion" event and its originating
 * "utterance" event specifically so overlapping turns can't be mismatched —
 * see that file's own comment: "Ties each per-turn event to its utterance —
 * turns can overlap (a barge-in starts the next before the last finished
 * logging), so ordering alone can pair an emotion with the wrong sentence."
 * The frontend was doing exactly the "ordering alone" pairing that comment
 * warns against, discarding the authoritative id it was already given. The
 * visible symptom: a timeline point labeled "neutral" showing the quote
 * "I feel very low" — that quote belongs to a different, nearby turn that
 * was time-adjacent but not the same utterance.
 */

export interface MinimalSessionEvent {
  ts: number;
  payload: Record<string, unknown>;
}

/** Further than this from any transcribed turn isn't really "what was being
 * said at that moment" anymore — used only as the nearest-time fallback's
 * cutoff, never for an exact utteranceId match. */
const MAX_TIME_DRIFT_MS = 4000;

/**
 * Finds the utterance event an emotion-bearing event (emotion/acoustic/cai)
 * actually belongs to. Prefers an exact `utteranceId` match (the link the
 * backend already writes on both sides); falls back to nearest-in-time only
 * when the id is missing (older rows logged before the field existed) or
 * doesn't resolve to a known utterance in this session's log.
 */
export function matchUtteranceForEvent<T extends MinimalSessionEvent>(
  event: MinimalSessionEvent,
  utteranceEvents: T[]
): T | null {
  const utteranceId = event.payload.utteranceId;
  if (typeof utteranceId === "string" && utteranceId.length > 0) {
    const exact = utteranceEvents.find((u) => u.payload.utteranceId === utteranceId);
    if (exact) return exact;
  }

  if (utteranceEvents.length === 0) return null;
  let best = utteranceEvents[0];
  let bestDiff = Math.abs(best.ts - event.ts);
  for (const u of utteranceEvents) {
    const diff = Math.abs(u.ts - event.ts);
    if (diff < bestDiff) {
      best = u;
      bestDiff = diff;
    }
  }
  return bestDiff <= MAX_TIME_DRIFT_MS ? best : null;
}
