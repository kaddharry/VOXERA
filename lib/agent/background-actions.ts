/**
 * Background action worker ("sub-agent") for slow, state-changing tools (booking, cancelling, rescheduling).
 *
 * The voice agent talks; this worker does the work. A booking runs here, detached from the turn that asked
 * for it, so it keeps going if the caller talks over the agent or their sentence is merged into a longer one
 * (both cancel the in-flight turn, which used to throw the booking's confirmation away: the booking was made
 * but the caller heard "let me check the calendar" three times and never "it's booked").
 *
 * Every result lands in a per-call board. From there it is (a) read by whichever turn is running, (b) spoken
 * proactively by the call handler as soon as it settles if the agent is idle, and (c) put in the next turn's
 * prompt so the model knows what is already done instead of re-checking the calendar.
 *
 * Calls with the same tool + arguments share one job, so a repeated request can never double-book.
 */

export interface ActionRecord {
  id: number;
  sessionId: string;
  tool: string;
  key: string;
  status: "running" | "done";
  success: boolean;
  resultStr?: string;
  /** Spoken confirmation for a successful booking; undefined when the model should word it. */
  confirmation?: string;
  announced: boolean;
  announcedAt?: number;
  startedAt: number;
  settledAt?: number;
  promise: Promise<ActionRecord>;
}

const DEDUPE_WINDOW_MS = 120_000;
const MAX_PER_SESSION = 20;

const boards = new Map<string, ActionRecord[]>();
const listeners = new Map<string, Set<(rec: ActionRecord) => void>>();
let nextId = 1;

function stableKey(tool: string, args: Record<string, any>): string {
  const sorted = Object.keys(args ?? {}).sort().reduce<Record<string, unknown>>((o, k) => { o[k] = args[k]; return o; }, {});
  return `${tool}:${JSON.stringify(sorted)}`;
}

function parseResult(resultStr: string): { success: boolean; provider?: string; when?: string } {
  try {
    const r = JSON.parse(resultStr);
    return { success: r?.success === true, provider: typeof r?.provider === "string" ? r.provider : undefined, when: typeof r?.when === "string" ? r.when : undefined };
  } catch {
    return { success: /"success"\s*:\s*true/.test(resultStr) };
  }
}

/** One short sentence in the caller's script, or undefined when the model should word it itself. */
export function confirmationLine(tool: string, resultStr: string, callerText: string): string | undefined {
  if (tool !== "book_appointment") return undefined;
  const { success, provider, when } = parseResult(resultStr);
  if (!success || !provider || !when) return undefined;
  if (/[ऀ-ॿ]/.test(callerText)) return `आपकी अपॉइंटमेंट बुक हो गई है, ${provider} के साथ, ${when}।`;
  if (/[਀-૿ঀ-৿஀-௿ఀ-౿ഀ-ൿ଀-୿]/.test(callerText)) return undefined;
  return `You're all set. Your appointment is booked with ${provider} on ${when}.`;
}

function emit(rec: ActionRecord) {
  for (const cb of listeners.get(rec.sessionId) ?? []) {
    try { cb(rec); } catch (err) { console.error("[BackgroundActions] listener failed:", err); }
  }
}

/** Starts the action in the background, or joins an identical one already running / recently finished. */
export function runBackgroundAction(
  sessionId: string,
  tool: string,
  args: Record<string, any>,
  exec: () => Promise<string>,
  callerText = "",
): ActionRecord {
  const key = stableKey(tool, args);
  const board = boards.get(sessionId) ?? [];
  const now = Date.now();
  const existing = board.find((r) => r.key === key && (r.status === "running" || (r.success && now - (r.settledAt ?? now) < DEDUPE_WINDOW_MS)));
  if (existing) return existing;

  const rec = { id: nextId++, sessionId, tool, key, status: "running", success: false, announced: false, startedAt: now } as ActionRecord;
  rec.promise = (async () => {
    let resultStr: string;
    try {
      resultStr = await exec();
    } catch (err) {
      console.error(`[BackgroundActions] ${tool} threw:`, err);
      resultStr = JSON.stringify({ error: "The action failed. Tell the caller you could not complete it and offer to try again." });
    }
    rec.resultStr = resultStr;
    rec.success = parseResult(resultStr).success;
    rec.confirmation = rec.success ? confirmationLine(tool, resultStr, callerText) : undefined;
    rec.status = "done";
    rec.settledAt = Date.now();
    emit(rec);
    return rec;
  })();
  board.push(rec);
  boards.set(sessionId, board.slice(-MAX_PER_SESSION));
  return rec;
}

/** Called by a call handler: fires whenever an action finishes. Returns an unsubscribe function. */
export function onActionSettled(sessionId: string, cb: (rec: ActionRecord) => void): () => void {
  const set = listeners.get(sessionId) ?? new Set();
  set.add(cb);
  listeners.set(sessionId, set);
  return () => {
    set.delete(cb);
    if (set.size === 0) listeners.delete(sessionId);
  };
}

export function markAnnounced(rec: ActionRecord): void {
  rec.announced = true;
  rec.announcedAt = Date.now();
}

/** A turn that said it was cancelled before the caller heard it: let the next turn or the idle announcer say it again. */
export function unannounceSince(sessionId: string, since: number): void {
  for (const r of boards.get(sessionId) ?? []) if (r.announced && r.announcedAt !== undefined && r.announcedAt >= since) r.announced = false;
}

export function pendingAnnouncements(sessionId: string): ActionRecord[] {
  return (boards.get(sessionId) ?? []).filter((r) => r.status === "done" && r.success && !r.announced && r.confirmation);
}

export function hasRunningAction(sessionId: string): boolean {
  return (boards.get(sessionId) ?? []).some((r) => r.status === "running");
}

/** Prompt block for the next turn: what the background worker has finished or is still doing. */
export function actionsContext(sessionId: string): string | undefined {
  const board = boards.get(sessionId) ?? [];
  const lines: string[] = [];
  for (const r of board) {
    if (r.status === "running") {
      lines.push(`- IN PROGRESS: ${r.tool} is being carried out right now by the booking team. Do NOT call any tool again and do NOT re-check the calendar. Tell the caller briefly it is being finalised and you will confirm in a moment.`);
    } else if (r.success && Date.now() - (r.settledAt ?? 0) < 10 * 60_000) {
      const { provider, when } = parseResult(r.resultStr ?? "");
      const detail = provider && when ? ` (${provider}, ${when})` : "";
      lines.push(`- DONE: ${r.tool} succeeded${detail}.${r.announced ? "" : " The caller has NOT been told yet — confirm it first, in one short sentence."} Never say that slot is unavailable: it is the caller's own booking. Do not call tools for it again.`);
    }
  }
  return lines.length ? ["ACTIONS ON THIS CALL (background worker):", ...lines].join("\n") : undefined;
}

export function clearActions(sessionId: string): void {
  boards.delete(sessionId);
  listeners.delete(sessionId);
}
