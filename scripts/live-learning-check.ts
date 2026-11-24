/**
 * LIVE end-to-end check of call learning: real orchestrator + real model + the real database.
 * Uses a throwaway patient id and removes everything it created (including any agent/global
 * lessons derived from its own test sessions).
 * Run: npx tsx --env-file=.env.local scripts/live-learning-check.ts
 */
import { supabase } from "../lib/db/supabase";
import { handleTurn } from "../lib/agent/orchestrator";
import { learnFromCall } from "../lib/learning";
(async () => {
const AGENT = "a5f7133c-16f8-484f-a096-1082741e4377"; // Aarti (Test Care Coordinator)
const CLIENT = "e9215284-4095-4333-9fd3-e073c7e6c805";
const PATIENT = "e2e-test-patient-" + Date.now();
const sessions = [`e2e-s1-${Date.now()}`, `e2e-s2-${Date.now()}`];
let fails = 0; const check = (ok: boolean, m: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${m}`); if (!ok) fails++; };

async function say(sessionId: string, text: string) {
  const out = await handleTurn({ sessionId, userId: sessionId, clientId: CLIENT, agentId: AGENT, patientId: PATIENT, transcript: text, sttConfidence: 0.9, language: "en-IN" });
  console.log(`  PATIENT: ${text}\n  AARTI:   ${out.reply}`);
  return out.reply;
}
try {
  console.log("── call 1 ──");
  await say(sessions[0], "Hello, yes I can talk. My knee hurts when I climb stairs, mostly in the evening.");
  await say(sessions[0], "Please call me only after six in the evening, I am at work till then. My daughter Meera helps me with my medicines.");
  await new Promise((r) => setTimeout(r, 4000)); // session events are written fire-and-forget

  const rows = await supabase.from("session_logs").select("id").eq("sessionId", sessions[0]).eq("type", "utterance");
  check((rows.data?.length ?? 0) >= 4, `real session_logs transcript written (${rows.data?.length} utterances)`);

  const out = await learnFromCall({ sessionId: sessions[0], clientId: CLIENT, agentId: AGENT, patientId: PATIENT });
  console.log("learn:", JSON.stringify(out.merge));
  check(out.status === "learned", "learnFromCall completed");

  const saved = await supabase.from("call_learnings").select("scope,category,text,evidence,status").eq("patientId", PATIENT);
  console.log("saved in DB:", saved.data?.map((r) => `[${r.status}] ${r.category}: ${r.text}`));
  check((saved.data?.length ?? 0) >= 2, `${saved.data?.length} patient learnings stored in the real table`);
  const all = (saved.data ?? []).map((r) => r.text.toLowerCase()).join(" | ");
  check(/6|six|evening/.test(all), "call-time preference stored");
  check(/meera|daughter/.test(all), "caregiver stored");

  console.log("\n── call 2 (new session, same patient) ──");
  const reply = await say(sessions[1], "Hello again. Do you remember what I told you last time?");
  check(/evening|six|6|pm|knee|stairs|meera|daughter|medicine/i.test(reply), "second call's reply uses what was learned");
} finally {
  const del = await supabase.from("call_learnings").delete().eq("patientId", PATIENT);
  // agent/global lessons that came only from these test sessions
  const lessons = await supabase.from("call_learnings").select("id,sourceCallIds").eq("clientId", CLIENT).in("scope", ["agent", "global"]);
  const mine = (lessons.data ?? []).filter((l: any) => (l.sourceCallIds as string[]).length > 0 && (l.sourceCallIds as string[]).every((c) => c.startsWith("e2e-s")));
  for (const l of mine) await supabase.from("call_learnings").delete().eq("id", l.id);
  console.log(`removed ${mine.length} test-derived lesson(s)`);
  for (const s of sessions) await supabase.from("session_logs").delete().eq("sessionId", s);
  console.log("\ncleanup:", del.error ? del.error.message : "test learnings and session logs removed");
  console.log(fails ? `${fails} check(s) FAILED` : "All checks passed");
  process.exit(fails ? 1 : 0);
}

})();
