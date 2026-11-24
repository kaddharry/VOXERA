/**
 * FULL end-to-end test of call learning with the REAL model, orchestrator and database:
 * two agents, four patients, seven calls. Proves that
 *   - each call teaches the right patient (and only that patient),
 *   - what one agent learned about a patient is used by the OTHER agent next time,
 *   - lessons become agent lessons, and a lesson seen by two agents becomes GLOBAL (no personal details),
 *   - a brand-new patient + any agent gets the global lessons,
 *   - the learned context really reaches the live prompt of every later call,
 *   - re-processing a call changes nothing, and a changed fact replaces the old one.
 * It creates temporary patients/agent and removes everything it created (and only that) at the end.
 *
 * Run: npx tsx --env-file=.env.local scripts/learning-full-e2e.ts
 */
import { supabase } from "../lib/db/supabase";
import { handleTurn } from "../lib/agent/orchestrator";
import { learnFromCall, getLearningContext, invalidateLearningContext } from "../lib/learning";
import { createPatient } from "../lib/db/patients";
import { createAgent, getTenantIdForUser } from "../lib/db/agents";
import { dispatchToolCall } from "../lib/agent/tools";

const CLIENT = "e9215284-4095-4333-9fd3-e073c7e6c805";
const AARTI = "a5f7133c-16f8-484f-a096-1082741e4377";
const RUN = `lrn-e2e-${Date.now()}`;

let fails = 0;
const results: string[] = [];
const check = (ok: boolean, msg: string) => { const line = `${ok ? "PASS" : "FAIL"}  ${msg}`; console.log(line); results.push(line); if (!ok) fails++; };
const soft = (ok: boolean, msg: string) => { const line = `${ok ? "PASS" : "NOTE"}  (behaviour) ${msg}`; console.log(line); results.push(line); };

// capture the orchestrator's "learned context for this turn: N chars" lines
const usedContext: Array<{ n: number }> = [];
const realLog = console.log;
console.log = (...a: unknown[]) => {
  const m = /learned context for this turn: (?:(\d+) chars|none)/.exec(String(a[0]));
  if (m) usedContext.push({ n: m[1] ? Number(m[1]) : 0 });
  realLog(...a);
};

async function say(agentId: string, patientId: string, sessionId: string, text: string): Promise<string> {
  const spoken: string[] = [];
  const out = await handleTurn(
    { sessionId, userId: sessionId, clientId: CLIENT, agentId, patientId, transcript: text, sttConfidence: 0.9, language: "en-IN" },
    { onReplyChunk: (c: string) => spoken.push(c) } as any,
  );
  const reply = spoken.join(" ") || out.reply;
  realLog(`    patient: ${text}\n    agent:   ${reply.slice(0, 220)}`);
  return reply;
}

(async () => {
  const createdPatients: string[] = [];
  let agentB: string | null = null;
  const sessions: string[] = [];
  try {
    // ── setup ─────────────────────────────────────────────────────────────────
    const tenantId = (await getTenantIdForUser(supabase, CLIENT))!;
    const b = await createAgent(supabase, tenantId, {
      name: `Devansh (learning e2e ${RUN.slice(-6)})`,
      description: "Temporary agent for the learning end-to-end test",
      system_prompt:
        "You are Devansh, a calm follow-up coordinator for Sunshine Hospital, calling patients after a visit. Ask short questions one at a time, " +
        "note concerns, and offer to book a follow-up with the doctors you can see in the booking tools. Keep every turn to one or two short sentences.",
      greeting: "Hello, this is Devansh from Sunshine Hospital.",
      voice_persona: "gnani:timbre-v3.0:Avinash",
      speech_provider: "gnani",
      language: "auto",
      enabledTools: ["check_appointment_availability", "book_appointment", "reschedule_appointment", "cancel_appointment", "confirm_appointment"],
    });
    agentB = b!.id;
    const mk = async (name: string, phone: string) => { const p = (await createPatient(supabase, CLIENT, { name, phone, notes: "" }))!; createdPatients.push(p.id); return p.id; };
    const P1 = await mk("Meera Kapoor", "+919100000001");
    const P2 = await mk("Sameer Qureshi", "+919100000002");
    const P3 = await mk("Anita Deshpande", "+919100000003");
    const P4 = await mk("Rohan Bhatt", "+919100000004");
    const A = AARTI, B = agentB;
    const sid = (n: string) => { const s = `${RUN}-${n}`; sessions.push(s); return s; };
    const learn = async (session: string, agentId: string, patientId: string) => {
      await new Promise((r) => setTimeout(r, 3500)); // session events are written fire-and-forget
      const o = await learnFromCall({ sessionId: session, clientId: CLIENT, agentId, patientId });
      realLog(`    learned: ${JSON.stringify(o.merge)}${o.rejected?.length ? " rejected=" + o.rejected.length : ""}`);
      return o;
    };
    const facts = async (p: string) => (await supabase.from("call_learnings").select("text,status,category,sourceCallIds").eq("patientId", p).eq("status", "active")).data ?? [];
    const lower = (xs: { text: string }[]) => xs.map((x) => x.text.toLowerCase()).join(" | ");

    // ── the calls ──────────────────────────────────────────────────────────────
    realLog("\n=== C1  Aarti ↔ Meera (back pain, evenings only, husband helps)");
    let s = sid("c1");
    await say(A, P1, s, "Yes, this is Meera speaking.");
    await say(A, P1, s, "My back has been hurting since the surgery, mostly at night. Please only call me after seven in the evening, in the mornings I am at school teaching.");
    await say(A, P1, s, "I take my tablets after dinner and my husband Karan reminds me every night.");
    await learn(s, A, P1);
    const c1 = s;

    realLog("\n=== C2  Devansh ↔ Sameer (diabetes, short calls, wants two slot options)");
    s = sid("c2");
    await say(B, P2, s, "Yes, Sameer here.");
    await say(B, P2, s, "My sugar was high yesterday, I have diabetes. I prefer very short calls, in the mornings I am usually driving.");
    await say(B, P2, s, "When you read out that many time slots I cannot remember them. Please just give me two options.");
    await learn(s, B, P2);

    realLog("\n=== C3  Aarti ↔ Anita (hard of hearing, daughter helps, too many options)");
    s = sid("c3");
    await say(A, P3, s, "Yes, Anita speaking.");
    await say(A, P3, s, "My hearing is not good so please speak slowly. My daughter Pooja usually answers the phone when I cannot.");
    await say(A, P3, s, "That is too many choices, I get confused. Just tell me one or two times.");
    await learn(s, A, P3);

    realLog("\n=== C4  Devansh ↔ Anita (a DIFFERENT agent, same patient)");
    s = sid("c4");
    await say(B, P3, s, "Hello, this is Anita.");
    await say(B, P3, s, "I am hard of hearing, so talk slowly please. If I do not pick up, ask for my daughter Pooja.");
    await say(B, P3, s, "Please do not list so many times, two choices is enough for me.");
    await learn(s, B, P3);

    realLog("\n=== C5  Aarti ↔ Meera again (her back is better: a changed fact)");
    s = sid("c5");
    await say(A, P1, s, "Hello, Meera speaking.");
    await say(A, P1, s, "My back is much better now, the pain is completely gone. But still only call me in the evening.");
    await learn(s, A, P1);

    // ── mid-test checks ──────────────────────────────────────────────────────────
    realLog("\n=== checks: what was learned");
    invalidateLearningContext();
    const f1 = await facts(P1), f2 = await facts(P2), f3 = await facts(P3);
    realLog("  Meera:", f1.map((f) => f.text), "\n  Sameer:", f2.map((f) => f.text), "\n  Anita:", f3.map((f) => f.text));
    check(f1.length >= 2 && f2.length >= 2 && f3.length >= 2, `every patient has learned facts (Meera ${f1.length}, Sameer ${f2.length}, Anita ${f3.length})`);
    check(/evening|7|seven/.test(lower(f1)), "Meera: evening-only call preference learned");
    check(/karan|husband/.test(lower(f1)), "Meera: husband reminds her learned");
    check(/diabet|sugar/.test(lower(f2)), "Sameer: diabetes / high sugar learned");
    check(/short|brief/.test(lower(f2)), "Sameer: prefers short calls learned");
    check(/hear/.test(lower(f3)) && /pooja|daughter/.test(lower(f3)), "Anita: hearing + daughter learned (from TWO different agents)");
    const knee = f1.filter((f) => /back/i.test(f.text));
    check(knee.length === 1 && /better|gone|resolved|improv|no longer/i.test(knee[0].text), `Meera's back fact was REPLACED by the newer statement ("${knee[0]?.text}")`);
    check(!/diabet|sugar|hear|pooja/.test(lower(f1)) && !/back|karan|hear|pooja/.test(lower(f2)) && !/back|karan|diabet|sugar/.test(lower(f3)), "no patient's facts leaked into another patient");

    // idempotency: processing the same call again changes nothing
    const before = JSON.stringify((await facts(P1)).map((f) => [f.text, (f.sourceCallIds as string[]).length]));
    await learnFromCall({ sessionId: c1, clientId: CLIENT, agentId: A, patientId: P1 });
    const after = JSON.stringify((await facts(P1)).map((f) => [f.text, (f.sourceCallIds as string[]).length]));
    check(before === after, "re-processing a finished call changes nothing (idempotent)");

    // agent + global lessons
    const lessons = (await supabase.from("call_learnings").select("scope,status,agentId,text,sourceCallIds").in("scope", ["agent", "global"]).eq("clientId", CLIENT)).data ?? [];
    const mine = lessons.filter((l: any) => (l.sourceCallIds as string[]).length > 0 && (l.sourceCallIds as string[]).every((c) => c.startsWith(RUN)));
    realLog("  lessons from this run:");
    mine.forEach((l: any) => realLog(`    [${l.scope}${l.agentId ? ":" + (l.agentId === A ? "Aarti" : "Devansh") : ""}/${l.status} x${(l.sourceCallIds as string[]).length}] ${l.text}`));
    check(mine.some((l: any) => l.scope === "agent"), "agents learned lessons from their calls");
    // Whether the model extracts a matching lesson from two calls is up to the model (pending -> active is
    // unit-tested deterministically), so this one is informational.
    soft(mine.some((l: any) => l.scope === "agent" && l.status === "active"), "a lesson supported by 2 calls became ACTIVE for its agent");
    const globals = mine.filter((l: any) => l.scope === "global" && l.status === "active");
    check(globals.length >= 1, `a lesson seen by two different agents became a GLOBAL lesson (${globals.length})`);
    const pii = ["meera", "kapoor", "sameer", "qureshi", "anita", "deshpande", "rohan", "bhatt", "karan", "pooja", "9100000"];
    check(mine.every((l: any) => !pii.some((w) => (l.text as string).toLowerCase().includes(w))), "no lesson (agent or global) contains a patient's name, family member or phone");

    // ── later calls: is it USED? ─────────────────────────────────────────────────
    realLog("\n=== C6  Devansh ↔ Meera (Devansh never spoke to Meera; Aarti did)");
    invalidateLearningContext();
    const ctxBM = (await getLearningContext({ clientId: CLIENT, agentId: B, patientId: P1 })) ?? "";
    check(/back|evening|karan|7|seven/i.test(ctxBM), "Devansh's context for Meera contains what AARTI learned about her");
    check(!/diabet|hear|pooja|sugar/i.test(ctxBM), "…and nothing about other patients");
    const n0 = usedContext.length;
    s = sid("c6");
    await say(B, P1, s, "Hello, Meera here.");
    const r6 = await say(B, P1, s, "Could you call me again tomorrow morning at nine?");
    const used6 = usedContext.slice(n0);
    check(used6.length >= 2 && used6.every((u) => u.n > 0), `learned context reached every turn's live prompt (${used6.map((u) => u.n).join(", ")} chars)`);
    check(used6.every((u) => u.n === ctxBM.length), "the prompt used exactly the context computed for (Devansh, Meera)");
    soft(/evening|7|seven|after|not in the morning|mornings/i.test(r6), "reply respects Meera's evening-only preference");
    await learn(s, B, P1);

    realLog("\n=== C7  Aarti ↔ Rohan (a brand-new patient, no history)");
    invalidateLearningContext();
    const ctxAR = (await getLearningContext({ clientId: CLIENT, agentId: A, patientId: P4 })) ?? "";
    const ctxBR = (await getLearningContext({ clientId: CLIENT, agentId: B, patientId: P4 })) ?? "";
    // an agent that already holds the very same lesson shows it under its own heading, so check the lesson text itself
    check(globals.length > 0 && globals.every((g: any) => ctxAR.includes(g.text) && ctxBR.includes(g.text)), "a new patient's calls (either agent) get every GLOBAL lesson in their prompt");
    check(!/WHAT WE ALREADY KNOW ABOUT THIS PATIENT/.test(ctxAR) && !/meera|sameer|anita|diabet|hear/i.test(ctxAR + ctxBR), "…and no other patient's personal facts");
    const n1 = usedContext.length;
    s = sid("c7");
    await say(A, P4, s, "Yes, this is Rohan.");
    const r7 = await say(A, P4, s, "I would like an appointment with Dr. Priya Desai tomorrow, what times do you have?");
    check(usedContext.slice(n1).every((u) => u.n > 0), "the global lessons reached the new patient's live prompt");
    const slotMentions = (r7.match(/\b\d{1,2}(:\d{2})?\s?(am|pm|a\.m\.|p\.m\.)/gi) ?? []).length;
    soft(slotMentions <= 3, `offered ${slotMentions} time(s) — the shared lesson asks for few options`);
  } catch (err) {
    realLog("FAIL  script error:", err);
    fails++;
  } finally {
    // ── cleanup: only what this run created ────────────────────────────────────────
    try {
      const appts = (await supabase.from("appointments").select("id").in("patient_id", createdPatients)).data ?? [];
      for (const a of appts) {
        await dispatchToolCall("cancel_appointment", { appointmentId: a.id, reason: "test cleanup" }, { clientId: CLIENT, patientId: createdPatients[0] }).catch(() => {});
        await supabase.from("appointments").delete().eq("id", a.id);
      }
      await supabase.from("follow_up_tasks").delete().in("patientId", createdPatients);
      await supabase.from("alerts").delete().in("patientId", createdPatients);
      await supabase.from("call_learnings").delete().in("patientId", createdPatients);
      if (agentB) await supabase.from("call_learnings").delete().eq("agentId", agentB);
      // agent/global lessons that came only from this run's sessions (incl. Aarti's)
      const rows = (await supabase.from("call_learnings").select("id,scope,sourceCallIds").eq("clientId", CLIENT).in("scope", ["agent", "global"])).data ?? [];
      for (const r of rows) {
        const src = r.sourceCallIds as string[];
        const rest = src.filter((c) => !c.startsWith(RUN));
        if (src.length === 0 || rest.length === src.length) continue; // not touched by this run
        if (rest.length === 0 || (r.scope === "global" && rest.length < 2)) await supabase.from("call_learnings").delete().eq("id", r.id);
        else {
          // an older lesson (e.g. from a real call) that this run also reinforced: put it back exactly as it was
          await supabase.from("call_learnings").update({ sourceCallIds: rest, supportCount: rest.length, status: rest.length >= 2 ? "active" : "pending" }).eq("id", r.id);
        }
      }
      for (const sn of sessions) {
        await supabase.from("session_logs").delete().eq("sessionId", sn);
        await supabase.from("memories").delete().eq("userId", sn);
      }
      for (const p of createdPatients) await supabase.from("patients").delete().eq("id", p).eq("clientId", CLIENT);
      if (agentB) await supabase.from("agents").delete().eq("id", agentB);
      realLog(`\ncleanup: removed ${createdPatients.length} patients, ${agentB ? 1 : 0} agent, ${sessions.length} sessions and everything learned in this run`);
    } catch (e) {
      realLog("cleanup error:", e);
    }
    realLog(fails ? `\n${fails} check(s) FAILED` : "\nAll checks passed");
    process.exit(fails ? 1 : 0);
  }
})();
