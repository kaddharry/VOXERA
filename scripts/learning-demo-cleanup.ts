/**
 * Removes the demo patients created by scripts/learning-demo.ts and everything learned from them.
 * Lessons that older real calls also supported are put back as they were.
 * Run: npx tsx --env-file=.env.local scripts/learning-demo-cleanup.ts
 */
import { supabase } from "../lib/db/supabase";

const CLIENT = "e9215284-4095-4333-9fd3-e073c7e6c805";
const RUN = "demo-learn-";

(async () => {
  const patients = ((await supabase.from("patients").select("id").eq("clientId", CLIENT).like("phone", "+9192000000%")).data ?? []).map((p: any) => p.id as string);
  if (patients.length) {
    await supabase.from("appointments").delete().in("patient_id", patients);
    await supabase.from("follow_up_tasks").delete().in("patientId", patients);
    await supabase.from("alerts").delete().in("patientId", patients);
    await supabase.from("call_learnings").delete().in("patientId", patients);
  }
  const rows = (await supabase.from("call_learnings").select("id,scope,sourceCallIds").eq("clientId", CLIENT).in("scope", ["agent", "global"])).data ?? [];
  let touched = 0;
  for (const r of rows) {
    const src = r.sourceCallIds as string[];
    const rest = src.filter((c) => !c.startsWith(RUN));
    if (src.length === 0 || rest.length === src.length) continue;
    touched++;
    if (rest.length === 0 || (r.scope === "global" && rest.length < 3)) await supabase.from("call_learnings").delete().eq("id", r.id);
    else await supabase.from("call_learnings").update({ sourceCallIds: rest, supportCount: rest.length, status: rest.length >= 2 ? "active" : "pending" }).eq("id", r.id);
  }
  const sessions = [...new Set(((await supabase.from("session_logs").select("sessionId").like("sessionId", `${RUN}%`)).data ?? []).map((r: any) => r.sessionId as string))];
  for (const s of sessions) {
    await supabase.from("session_logs").delete().eq("sessionId", s);
    await supabase.from("memories").delete().eq("userId", s);
  }
  for (const p of patients) await supabase.from("patients").delete().eq("id", p).eq("clientId", CLIENT);
  console.log(`removed ${patients.length} demo patients, ${sessions.length} sessions, ${touched} lessons adjusted`);
  process.exit(0);
})();
