/**
 * One-time: puts lessons learned BEFORE the clinical-review rule existed behind it. Any agent/global lesson that
 * gives medical guidance is marked "needs review" and, if it was already live, pulled back out of calls until a
 * person approves it on the Agent Learning page. Safe to re-run. Pass --dry to only print what would change.
 * Run: npx tsx --env-file=.env.local scripts/learning-flag-clinical.ts [--dry]
 */
import { supabase } from "../lib/db/supabase";
import { isClinicalLesson, REVIEW_PENDING } from "../lib/learning/clinical";

(async () => {
  const dry = process.argv.includes("--dry");
  const rows = (await supabase.from("call_learnings").select("id,scope,status,key,text").in("scope", ["agent", "global"]).neq("status", "retired")).data ?? [];
  let n = 0;
  for (const r of rows as any[]) {
    if (r.key || !isClinicalLesson(r.text)) continue;
    n++;
    console.log(`${dry ? "would flag" : "flagged"} [${r.scope}/${r.status}${r.status === "active" ? " → pulled from calls" : ""}] ${r.text.slice(0, 120)}`);
    if (!dry) await supabase.from("call_learnings").update({ key: REVIEW_PENDING, status: "pending", updatedAt: Date.now() }).eq("id", r.id);
  }
  console.log(`${n} lesson(s) ${dry ? "would need" : "now need"} review.`);
  process.exit(0);
})();
