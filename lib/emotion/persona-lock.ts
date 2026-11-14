import type { EmotionContext, EmotionLabel } from "../types";
import { CONFIG } from "../config";
import { supabase } from "../db/supabase";

/**
 * Persona hysteresis — keeps the agent's TONE stable across a call instead
 * of re-deciding it fresh every turn from the raw per-turn emotion read.
 *
 * Explicit product requirement: if a caller starts angry, the agent should
 * adopt a de-escalating tone ONCE and hold it — not flip tone on every
 * turn's noisy per-utterance emotion read. The tone should only actually
 * change once the emotion engine has shown a SUSTAINED shift (a run of N
 * consecutive turns all pointing the same new direction), not on any single
 * turn's reading. This is a valence-direction (positive/negative/neutral)
 * state machine with hysteresis, not a per-label one — "angry" vs
 * "frustrated" vs "distressed" are all still "negative" for this purpose;
 * what matters is whether the caller has durably moved to the OTHER side.
 *
 * Underlying emotion detection (lib/emotion/detect.ts, audio-emotion.ts,
 * fuseEmotion) still runs every turn as before — this doesn't skip that.
 * Two things still need it every turn regardless of the lock: the distress
 * safety-escalation path (which must never wait on a streak — see the
 * override below) and simply having an accurate per-turn signal to decide
 * whether THIS turn extends or breaks a pending streak. What the lock
 * actually saves is the LLM's tone whiplash from reacting to single-turn
 * noise, which was the actual product complaint — not compute.
 *
 * State is kept per session in this process (a phone call lives in one
 * Function for its whole length, so turns hit the cache) and written through
 * to Postgres (session_state, sql/migration_v33.sql), so a turn served by a
 * different instance (e.g. the HTTP /api/turn path) still sees it. A
 * database write never delays the turn.
 */

type ValenceSign = "neg" | "pos" | "neu";

interface PersonaLockState {
  lockedLabel: EmotionLabel;
  lockedSign: ValenceSign;
  pendingSign: ValenceSign | null;
  pendingStreak: number;
}

/** |v| below this is "neutral" — too small to count as a directional signal either way. */
const VALENCE_DEADBAND = 0.15;

function signOf(v: number): ValenceSign {
  if (v > VALENCE_DEADBAND) return "pos";
  if (v < -VALENCE_DEADBAND) return "neg";
  return "neu";
}

const STATE_KEY = "persona_lock";
const cache = new Map<string, { state: PersonaLockState; at: number }>();
const CACHE_MAX = 500;

async function loadState(sessionId: string): Promise<PersonaLockState | null> {
  const hit = cache.get(sessionId);
  if (hit) return hit.state;
  try {
    const { data } = await supabase.from("session_state").select("value").eq("session_id", sessionId).eq("key", STATE_KEY).maybeSingle();
    const state = (data?.value as PersonaLockState | undefined) ?? null;
    if (state) cache.set(sessionId, { state, at: Date.now() });
    return state;
  } catch {
    return null;
  }
}

async function saveState(sessionId: string, state: PersonaLockState): Promise<void> {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(sessionId, { state, at: Date.now() });
  // Written through in the background; expires after a day (the cron's
  // recover_telephony_state() deletes expired rows).
  void (async () => {
    try {
      const { error } = await supabase.from("session_state").upsert({
        session_id: sessionId,
        key: STATE_KEY,
        value: state,
        updated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      if (error) console.warn("[PersonaLock] Failed to persist state:", error.message);
    } catch (err) {
      console.warn("[PersonaLock] Failed to persist state:", err);
    }
  })();
}

export interface PersonaLockResult {
  /** The label to actually shape the LLM's tone with — sticky across turns. */
  label: EmotionLabel;
  /** True if this turn just committed a lock change (for logging/debugging). */
  justShifted: boolean;
  /** How many consecutive opposite-direction turns have been seen so far toward the next shift. */
  pendingStreak: number;
  pendingSign: ValenceSign | null;
}

/**
 * Resolves which persona label should shape this turn's tone, applying
 * hysteresis so a single noisy turn can't flip it. Call once per turn with
 * the turn's real fused emotion signal; the actual detected `current.label`
 * remains untouched everywhere else (memory scoring, trajectory, logging,
 * flags) — this only affects which PERSONA_MAP entry formatPersonaBlock()
 * uses for tone/language-rule coaching.
 */
export async function resolvePersonaLock(sessionId: string, emotion: EmotionContext): Promise<PersonaLockResult> {
  const { current, flags } = emotion;
  const currentSign = signOf(current.vad.v);

  // Safety override: genuine distress ALWAYS breaks through immediately,
  // regardless of streak state — matches the safety-first priority
  // getEmotionPersona() already applies to the unlocked case. A caller in
  // real distress must never wait on a 4-turn streak before the agent's
  // tone catches up.
  if (flags.increasing_distress || current.label === "distress") {
    const existingBeforeOverride = await loadState(sessionId);
    const state: PersonaLockState = { lockedLabel: "distress", lockedSign: currentSign, pendingSign: null, pendingStreak: 0 };
    await saveState(sessionId, state);
    // BUG-E11 fix: this used to hardcode justShifted: true on every turn
    // distress holds, not just the turn that actually entered it — the
    // field is documented as "this turn just committed a lock CHANGE",
    // which should be false on the 2nd/3rd/... consecutive distressed turn.
    const justShifted = existingBeforeOverride?.lockedLabel !== "distress";
    return { label: "distress", justShifted, pendingStreak: 0, pendingSign: null };
  }

  const existing = await loadState(sessionId);

  // First turn of the session (or state expired) — adopt the current read
  // as the initial baseline outright, nothing to hold steady against yet.
  if (!existing) {
    const state: PersonaLockState = { lockedLabel: current.label, lockedSign: currentSign, pendingSign: null, pendingStreak: 0 };
    await saveState(sessionId, state);
    return { label: current.label, justShifted: true, pendingStreak: 0, pendingSign: null };
  }

  const threshold = CONFIG.emotion.personaLockStreakThreshold;

  if (currentSign === existing.lockedSign || currentSign === "neu") {
    // Reinforces (or is ambiguous relative to) the current lock — any
    // pending opposite-direction streak resets, since the caller didn't
    // durably move away from the locked direction after all.
    const state: PersonaLockState = { ...existing, pendingSign: null, pendingStreak: 0 };
    await saveState(sessionId, state);
    return { label: existing.lockedLabel, justShifted: false, pendingStreak: 0, pendingSign: null };
  }

  // currentSign is the OPPOSITE of the locked direction — build or continue
  // a pending streak toward a real shift.
  const continuingStreak = existing.pendingSign === currentSign;
  const pendingStreak = continuingStreak ? existing.pendingStreak + 1 : 1;

  if (pendingStreak >= threshold) {
    // Sustained shift confirmed — commit the new lock using THIS turn's
    // actual label (not just the sign) so the persona is concrete, e.g.
    // "joy" rather than merely "positive".
    const state: PersonaLockState = { lockedLabel: current.label, lockedSign: currentSign, pendingSign: null, pendingStreak: 0 };
    await saveState(sessionId, state);
    return { label: current.label, justShifted: true, pendingStreak: 0, pendingSign: null };
  }

  const state: PersonaLockState = { ...existing, pendingSign: currentSign, pendingStreak };
  await saveState(sessionId, state);
  return { label: existing.lockedLabel, justShifted: false, pendingStreak, pendingSign: currentSign };
}
