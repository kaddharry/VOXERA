/**
 * LIVE check of the booking path: real orchestrator + model + calendar, one roster patient.
 * Books a slot through the agent, confirms it spoke (filler + confirmation, never "unavailable"),
 * asks again to prove the patient's own slot is never reported as taken, then cancels and
 * removes what it created.
 * Run: npx tsx --env-file=.env.local scripts/live-booking-check.ts
 */
import { supabase } from "../lib/db/supabase";
import { handleTurn } from "../lib/agent/orchestrator";
import { dispatchToolCall } from "../lib/agent/tools";

const AGENT = "a5f7133c-16f8-484f-a096-1082741e4377";
const CLIENT = "e9215284-4095-4333-9fd3-e073c7e6c805";
const PATIENT = "2QIa9RiM3nXN";
const DOCTOR = "40d245b2-eefd-4d71-96e2-696a6e42b048"; // Dr. Priya Desai
const SESSION = `e2e-book-${Date.now()}`;
let fails = 0;
const check = (ok: boolean, m: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${m}`); if (!ok) fails++; };

async function say(text: string) {
  const spoken: string[] = [];
  const t0 = Date.now();
  let firstAt = 0;
  const out = await handleTurn(
    { sessionId: SESSION, userId: SESSION, clientId: CLIENT, agentId: AGENT, patientId: PATIENT, transcript: text, sttConfidence: 0.9, language: "en-IN" },
    { onReplyChunk: (c: string) => { if (!firstAt) firstAt = Date.now() - t0; spoken.push(c); } } as any,
  );
  console.log(`  PATIENT: ${text}\n  SPOKEN (${spoken.length} clause(s), first after ${firstAt}ms): ${spoken.join(" | ")}`);
  return { spoken, reply: out.reply, firstAt };
}

(async () => {
  const created: string[] = [];
  // Everything that already exists is off-limits: only rows created DURING this run are ever removed.
  const before = new Set(((await supabase.from("appointments").select("id").eq("patient_id", PATIENT)).data ?? []).map((r: any) => r.id));
  const mine = async () => ((await supabase.from("appointments").select("id,starts_at,status,booked_via").eq("patient_id", PATIENT).eq("provider_id", DOCTOR).neq("status", "cancelled")).data ?? []).filter((r: any) => !before.has(r.id));
  try {
    // a free weekday afternoon slot, two days out
    const d = new Date(Date.now() + 2 * 86400000);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
    const pretty = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" }).format(d);

    await say("Yes, this is Vikas speaking. I'm doing okay, thank you."); // a real call has already identified the patient
    const r1 = await say(`I want to book an appointment with Dr. Priya Desai on ${pretty} at 3 pm.`);
    await new Promise((r) => setTimeout(r, 1500));
    const rows = await mine();
    for (const r of rows) created.push(r.id);
    console.log("  booked rows:", JSON.stringify(rows));
    check(rows.length === 1 && new Date(rows[0].starts_at).getTime() === new Date(`${day}T15:00:00+05:30`).getTime(), "the AGENT booked exactly the requested slot (backend row exists)");
    check(r1.spoken.length >= 2, "agent spoke a filler AND a confirmation (not silent)");
    check(r1.firstAt > 0 && r1.firstAt < 6000, `first words after ${r1.firstAt}ms`);
    const final1 = r1.spoken.join(" ");
    check(!/not available|unavailable|already taken|isn't available/i.test(final1), "does not claim the slot is unavailable");
    check(/booked|confirmed|all set|scheduled|set up|set for/i.test(final1), "confirms the booking with the time");
    check(!/<\/?tool_call|<function/i.test(final1), "no tool-call markup was spoken");

    // ask again: the patient's own slot must not be reported as taken
    const r2 = await say(`Can you confirm my ${pretty} 3 pm appointment is booked?`);
    check(!/not available|unavailable|already taken|isn't available/i.test(r2.spoken.join(" ")), "re-asking does not say the patient's own slot is unavailable");
    check(!/<\/?tool_call|<function/i.test(r2.spoken.join(" ")), "no tool-call markup spoken on the follow-up either");

    // idempotent book
    const dup = JSON.parse(await dispatchToolCall("book_appointment", { providerId: DOCTOR, startsAt: `${day}T15:00:00+05:30`, durationMinutes: 30 }, { clientId: CLIENT, patientId: PATIENT, sessionId: SESSION }));
    check(dup.success === true, `booking the same slot again returns success (${dup.alreadyBooked ? "alreadyBooked" : "new"})`);
    const after = await mine();
    check(after.length === 1, "no duplicate appointment was created");
    for (const r of after) if (!created.includes(r.id)) created.push(r.id);
  } catch (err) {
    console.log("FAIL  script error:", err);
    fails++;
  } finally {
    // even after a crash: remove anything created during this run (and only that)
    for (const r of await mine().catch(() => [])) if (!created.includes(r.id)) created.push(r.id);
    for (const id of created) {
      await dispatchToolCall("cancel_appointment", { appointmentId: id, reason: "automated test cleanup" }, { clientId: CLIENT, patientId: PATIENT });
      await supabase.from("appointments").delete().eq("id", id);
    }
    await supabase.from("session_logs").delete().eq("sessionId", SESSION);
    console.log(`cleanup: removed ${created.length} test appointment(s)`);
    console.log(fails ? `${fails} check(s) FAILED` : "All checks passed");
    process.exit(fails ? 1 : 0);
  }
})();
