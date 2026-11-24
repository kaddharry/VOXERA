/**
 * Runs many patients through ONE agent (Aarti) so the Agent Learning page has something real to show.
 * Unlike scripts/learning-full-e2e.ts this KEEPS the demo patients and everything learned from them.
 * It removes only the side effects it caused in your calendar (bookings the agent made, alerts, reminder tasks).
 * Remove it all later with: npx tsx --env-file=.env.local scripts/learning-demo-cleanup.ts
 *
 * Run: npx tsx --env-file=.env.local scripts/learning-demo.ts
 */
import { supabase } from "../lib/db/supabase";
import { handleTurn } from "../lib/agent/orchestrator";
import { learnFromCall } from "../lib/learning";
import { createPatient } from "../lib/db/patients";
import { dispatchToolCall } from "../lib/agent/tools";

const CLIENT = "e9215284-4095-4333-9fd3-e073c7e6c805";
const AARTI = "a5f7133c-16f8-484f-a096-1082741e4377";
const RUN = `demo-learn-${Date.now()}`;

const TOO_MANY = "That is too many time slots, I cannot keep them in my head. Please just give me two options.";
const HEARING = "My hearing is weak, please speak slowly. My daughter usually picks up the phone when I cannot.";
const EVENING = "Please call me only in the evening after six, I am at work the whole day.";
const REMIND = "I keep forgetting my tablets, my son reminds me every night.";

const PATIENTS: Array<{ name: string; lines: string[] }> = [
  { name: "Priya Nair", lines: ["I had my knee replaced two weeks ago and the swelling is not going down.", TOO_MANY] },
  { name: "Arjun Malhotra", lines: ["My blood pressure readings have been high this week, around one sixty.", EVENING] },
  { name: "Kavita Rao", lines: ["I had a cataract surgery and my eye feels itchy.", HEARING] },
  { name: "Imran Sheikh", lines: ["I get breathless when I climb stairs since the heart procedure.", EVENING] },
  { name: "Lata Pillai", lines: ["The stitches from my operation are paining at night.", TOO_MANY] },
  { name: "Harpreet Singh", lines: ["I have diabetes and my sugar is sometimes very low in the morning.", HEARING] },
  { name: "Neha Joshi", lines: ["I am eight months pregnant and I get dizzy in the afternoon.", EVENING] },
  { name: "Vijay Kulkarni", lines: ["I am recovering from a hip fracture and I cannot sleep well.", REMIND] },
  { name: "Sunita Das", lines: ["My asthma gets worse near dust and I used my inhaler three times today.", TOO_MANY] },
  { name: "Mohan Reddy", lines: ["I am eighty years old and live alone since the discharge.", HEARING] },
  { name: "Divya Menon", lines: ["I had a thyroid surgery last week and my voice is hoarse.", EVENING] },
  { name: "Rakesh Gupta", lines: ["I had a stroke last month and my left hand is still weak.", REMIND] },
];

async function main() {
  const createdPatients: string[] = [];
  const sessions: string[] = [];
  const realLog = console.log;
  // keep the output readable: only our own lines
  console.log = () => {};
  const out = (...a: unknown[]) => realLog(...a);
  try {
    let n = 0;
    for (const p of PATIENTS) {
      n++;
      const rec = await createPatient(supabase, CLIENT, {
        name: p.name,
        phone: `+9192000000${String(n).padStart(2, "0")}`,
        notes: "Demo patient created by the learning demo (safe to delete).",
        assignedAgentId: AARTI,
      });
      if (!rec) continue;
      createdPatients.push(rec.id);
      const session = `${RUN}-${n}`;
      sessions.push(session);
      out(`\n[${n}/${PATIENTS.length}] ${p.name}`);
      for (const text of [`Yes, this is ${p.name.split(" ")[0]} speaking.`, ...p.lines]) {
        const spoken: string[] = [];
        const r = await handleTurn(
          { sessionId: session, userId: session, clientId: CLIENT, agentId: AARTI, patientId: rec.id, transcript: text, sttConfidence: 0.9, language: "en-IN" },
          { onReplyChunk: (c: string) => spoken.push(c) } as any,
        );
        out(`   patient: ${text.slice(0, 90)}\n   Aarti:   ${(spoken.join(" ") || r.reply).slice(0, 110)}`);
      }
      await new Promise((r) => setTimeout(r, 3500));
      const l = await learnFromCall({ sessionId: session, clientId: CLIENT, agentId: AARTI, patientId: rec.id });
      out(`   learned: ${JSON.stringify(l.merge)}`);
    }
  } finally {
    // side effects only: bookings the agent made, escalation alerts and reminder tasks for the demo patients
    try {
      for (const a of (await supabase.from("appointments").select("id").in("patient_id", createdPatients)).data ?? []) {
        await dispatchToolCall("cancel_appointment", { appointmentId: a.id, reason: "demo cleanup" }, { clientId: CLIENT, patientId: createdPatients[0] }).catch(() => {});
        await supabase.from("appointments").delete().eq("id", a.id);
      }
      await supabase.from("follow_up_tasks").delete().in("patientId", createdPatients);
      await supabase.from("alerts").delete().in("patientId", createdPatients);
      for (const s of sessions) await supabase.from("memories").delete().eq("userId", s);
    } catch (e) {
      out("side-effect cleanup error:", e);
    }
    console.log = realLog;
    out(`\ndone: ${createdPatients.length} demo patients kept with what the agent learned from them.`);
    process.exit(0);
  }
}
main();
