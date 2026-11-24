/**
 * Removes everything left behind by scripts/learning-full-e2e.ts if it was interrupted: its temporary patients
 * (phones +91910000000x), its temporary agent, its sessions (prefix lrn-e2e-) and everything learned from them.
 * Lessons that an older, real call also supported are put back as they were.
 * Run: npx tsx --env-file=.env.local scripts/learning-e2e-cleanup.ts
 */
import { supabase } from "../lib/db/supabase";
import { dispatchToolCall } from "../lib/agent/tools";

const CLIENT = "e9215284-4095-4333-9fd3-e073c7e6c805";
const RUN = "lrn-e2e-";

(async () => {
  const patients = ((await supabase.from("patients").select("id").eq("clientId", CLIENT).like("phone", "+91910000000%")).data ?? []).map((p: any) => p.id as string);
  const agents = ((await supabase.from("agents").select("id").like("name", "Devansh (learning e2e%")).data ?? []).map((a: any) => a.id as string);
  if (patients.length) {
    for (const a of (await supabase.from("appointments").select("id").in("patient_id", patients)).data ?? []) {
      await dispatchToolCall("cancel_appointment", { appointmentId: a.id, reason: "test cleanup" }, { clientId: CLIENT, patientId: patients[0] }).catch(() => {});
      await supabase.from("appointments").delete().eq("id", a.id);
    }
    await supabase.from("follow_up_tasks").delete().in("patientId", patients);
    await supabase.from("alerts").delete().in("patientId", patients);
    await supabase.from("call_learnings").delete().in("patientId", patients);
  }
  for (const a of agents) await supabase.from("call_learnings").delete().eq("agentId", a);
  const rows = (await supabase.from("call_learnings").select("id,scope,sourceCallIds").eq("clientId", CLIENT).in("scope", ["agent", "global"])).data ?? [];
  let fixed = 0;
  for (const r of rows) {
    const src = r.sourceCallIds as string[];
    const rest = src.filter((c) => !c.startsWith(RUN));
    if (src.length === 0 || rest.length === src.length) continue;
    fixed++;
    if (rest.length === 0 || (r.scope === "global" && rest.length < 2)) await supabase.from("call_learnings").delete().eq("id", r.id);
    else await supabase.from("call_learnings").update({ sourceCallIds: rest, supportCount: rest.length, status: rest.length >= 2 ? "active" : "pending" }).eq("id", r.id);
  }
  const sessions = [...new Set(((await supabase.from("session_logs").select("sessionId").like("sessionId", `${RUN}%`)).data ?? []).map((r: any) => r.sessionId as string))];
  for (const s of sessions) {
    await supabase.from("session_logs").delete().eq("sessionId", s);
    await supabase.from("memories").delete().eq("userId", s);
  }
  for (const p of patients) await supabase.from("patients").delete().eq("id", p).eq("clientId", CLIENT);
  for (const a of agents) await supabase.from("agents").delete().eq("id", a);
  console.log(`cleanup: ${patients.length} patients, ${agents.length} agents, ${sessions.length} sessions, ${fixed} lessons put back`);
  process.exit(0);
})();
