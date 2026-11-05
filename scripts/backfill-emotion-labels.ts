/**
 * One-time backfill: reprocesses historical "emotion" session_logs rows
 * through today's (fixed) text-classification engine and updates any whose
 * label/confidence meaningfully changes.
 *
 * Why this exists: lib/emotion/lexicon.ts and lib/emotion/detect.ts had
 * several bugs fixed in this audit (contraction negation never firing, the
 * "sick" slang collision, missing clinical-trend/medication/healthcare-
 * frustration coverage — see __tests__/emotion/audit-findings.test.ts and
 * __tests__/emotion/lexicon-coverage-expansion.test.ts). Those fixes only
 * change how NEW calls get classified — every "emotion" row already written
 * to session_logs keeps whatever label was computed at call time. This
 * script re-runs the CURRENT engine over each historical row's own
 * transcript text and updates the stored label where it's now different.
 *
 * Scope and honesty about what this can't do:
 *   - TEXT-ONLY reclassification. The original acoustic engine's full VAD
 *     reading was never persisted (session_logs only kept
 *     `audioSignal: { label, confidence }`), so the audio side of fusion is
 *     reconstructed from that label+confidence via HF_VAD_MAP — the same
 *     approximation already used elsewhere in this codebase when only a
 *     label/score is available. It is NOT a re-run of the original acoustic
 *     analysis (that would need the original audio, which isn't stored).
 *   - trajectory/zDeviation/flags are left untouched — correctly recomputing
 *     those requires replaying an entire call's turns in order, which is a
 *     separate, larger undertaking and out of scope here.
 *   - Every touched row is marked `backfilled: true` with the previous
 *     label preserved under `previousLabel`, so this is auditable, not a
 *     silent rewrite of history.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-emotion-labels.ts
 *     Dry run (default) — prints what WOULD change, writes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-emotion-labels.ts --apply
 *     Actually performs the updates.
 *
 *   ... --client-id=<uuid>
 *     Defaults to the admin2@gmail.com account's clientId if omitted.
 */
import { supabase } from "../lib/db/supabase";
import { recomputeEmotionForText, type StoredEmotionPayload } from "../lib/insights/backfill-emotion";

const APPLY = process.argv.includes("--apply");
const CLIENT_ID_ARG = process.argv.find((a) => a.startsWith("--client-id="))?.split("=")[1];
const DEFAULT_EMAIL = "admin2@gmail.com";

interface SessionLogRow {
  id: string;
  sessionId: string;
  ts: number;
  type: string;
  payload: Record<string, unknown>;
}

async function resolveClientId(): Promise<string> {
  if (CLIENT_ID_ARG) return CLIENT_ID_ARG;
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  const user = data.users.find((u) => u.email === DEFAULT_EMAIL);
  if (!user) throw new Error(`No user found for ${DEFAULT_EMAIL} and no --client-id given`);
  return user.id;
}

async function main() {
  const clientId = await resolveClientId();
  console.log(`[Backfill] Scope: clientId=${clientId}  mode=${APPLY ? "APPLY (will write)" : "DRY RUN (no writes)"}`);

  const { data: emotionRows, error: emoErr } = await supabase
    .from("session_logs")
    .select("id, sessionId, ts, type, payload")
    .eq("clientId", clientId)
    .eq("type", "emotion")
    .order("ts", { ascending: true });
  if (emoErr) throw emoErr;

  const { data: utteranceRows, error: uttErr } = await supabase
    .from("session_logs")
    .select("id, sessionId, ts, type, payload")
    .eq("clientId", clientId)
    .eq("type", "utterance");
  if (uttErr) throw uttErr;

  const utteranceByKey = new Map<string, SessionLogRow>();
  for (const u of (utteranceRows as SessionLogRow[]) ?? []) {
    const uid = u.payload.utteranceId as string | undefined;
    if (uid) utteranceByKey.set(`${u.sessionId}:${uid}`, u);
  }

  let processed = 0;
  let skippedNoUtterance = 0;
  let unchanged = 0;
  let errored = 0;
  const changes: Array<{
    id: string;
    sessionId: string;
    ts: number;
    text: string;
    oldLabel: string;
    oldConfidence: number;
    newLabel: string;
    newConfidence: number;
  }> = [];

  for (const row of (emotionRows as SessionLogRow[]) ?? []) {
    processed++;
    const utteranceId = row.payload.utteranceId as string | undefined;
    const utterance = utteranceId ? utteranceByKey.get(`${row.sessionId}:${utteranceId}`) : undefined;
    const text = utterance?.payload.text as string | undefined;
    if (!text || !text.trim()) {
      skippedNoUtterance++;
      continue;
    }

    try {
      const old = row.payload as unknown as StoredEmotionPayload;
      const result = await recomputeEmotionForText(text, old);
      if (!result.changed) {
        unchanged++;
        continue;
      }
      changes.push({
        id: row.id,
        sessionId: row.sessionId,
        ts: row.ts,
        text,
        oldLabel: old.label,
        oldConfidence: old.confidence,
        newLabel: result.label,
        newConfidence: result.confidence,
      });

      if (APPLY) {
        const newPayload = {
          ...row.payload,
          label: result.label,
          intensity: result.intensity,
          confidence: result.confidence,
          confidenceCategory: result.confidenceCategory,
          vad: result.vad,
          textSignal: result.textSignal,
          isMixed: result.isMixed,
          backfilled: true,
          backfilledAt: Date.now(),
          previousLabel: old.label,
          previousConfidence: old.confidence,
        };
        const { error: updErr } = await supabase.from("session_logs").update({ payload: newPayload }).eq("id", row.id);
        if (updErr) {
          console.error(`[Backfill] FAILED to update row ${row.id}:`, updErr.message);
          errored++;
        }
      }
    } catch (err) {
      errored++;
      console.error(`[Backfill] Error reprocessing row ${row.id}:`, err);
    }
  }

  console.log(`\n[Backfill] Processed ${processed} emotion rows.`);
  console.log(`  Skipped (no matching utterance text): ${skippedNoUtterance}`);
  console.log(`  Unchanged (new read agrees with stored): ${unchanged}`);
  console.log(`  Changed: ${changes.length}${APPLY ? " (written)" : " (dry run — not written)"}`);
  console.log(`  Errors: ${errored}`);

  if (changes.length > 0) {
    console.log(`\n[Backfill] Changes:`);
    for (const c of changes) {
      const when = new Date(c.ts).toISOString();
      console.log(
        `  ${c.sessionId}  ${when}  "${c.text.slice(0, 60)}${c.text.length > 60 ? "…" : ""}"\n` +
        `    ${c.oldLabel} (${c.oldConfidence.toFixed(2)}) → ${c.newLabel} (${c.newConfidence.toFixed(2)})`
      );
    }
  }

  if (!APPLY && changes.length > 0) {
    console.log(`\n[Backfill] This was a DRY RUN. Re-run with --apply to write these ${changes.length} changes.`);
  }
}

main().catch((err) => {
  console.error("[Backfill] Fatal error:", err);
  process.exit(1);
});
