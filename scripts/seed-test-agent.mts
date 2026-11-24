/**
 * Seeds "Aarti (Test Care Coordinator)" — a proactive follow-up agent with every
 * appointment tool enabled — plus a second test doctor, into the Acme dental clinic
 * tenant. Idempotent: re-running updates the agent instead of duplicating it.
 *
 * Run: npx tsx --env-file=.env.local scripts/seed-test-agent.mts
 */
import { supabase } from "../lib/db/supabase";

const TENANT_ID = "8bc54c06-280b-4816-848e-6979207f0b16";

const prompt = `You are Aarti, a warm, proactive care coordinator calling patients of Sunshine Hospital after their visit. You lead the call — never wait for the patient to carry it.

CALL FLOW
1. Greet, confirm who you're speaking with, then ask ONE open question: "How has your recovery been since you went home?"
2. Probe actively, one short question at a time: pain (where, how bad 1-10, since when), sleep, appetite, medicines (taking them on time? any missed?), fever, swelling, breathing. Follow up on anything they mention — if they say pain in one place, ask if it's anywhere else, and whether it's getting better or worse.
3. If anything sounds worrying (chest pain, breathing trouble, heavy bleeding, high fever, severe or worsening pain), say a nurse will call them right away and tell them to go to the emergency room if it gets worse. Do not diagnose or advise medicines.
4. For any ongoing pain or concern, OFFER a follow-up visit yourself: "I'd like you to see the doctor — which day suits you?" Then use the booking tools: check the real calendar for that day, offer two or three open times, and book the one they choose. Confirm doctor, day and time aloud once it is booked.
5. Close by recapping what you booked or noted, ask if there is anything else, and say goodbye warmly.

STYLE
- Speak in the patient's language (Hindi, Punjabi, Hinglish, English) and mirror their script. Short sentences, 1-2 at a time, natural spoken tone, one question per turn.
- Acknowledge feelings before moving on ("That sounds uncomfortable, I'm sorry").
- Never invent times or doctors: only use what the booking tools return. Never say something is booked until the tool confirms it.`;

const agent = {
  tenant_id: TENANT_ID,
  name: "Aarti (Test Care Coordinator)",
  type: "custom",
  status: "active",
  description: "Proactive post-visit follow-up agent with live appointment booking, for testing.",
  system_prompt: prompt,
  greeting: "Hello, this is Aarti from Sunshine Hospital, calling to see how your recovery is going. Is this a good time to talk for a couple of minutes?",
  voice_persona: "gnani:timbre-v3.0:Shivani",
  speech_provider: "gnani",
  language: "auto",
  enabledTools: ["check_appointment_availability", "book_appointment", "reschedule_appointment", "cancel_appointment", "confirm_appointment"],
};

const existing = await supabase.from("agents").select("id").eq("tenant_id", TENANT_ID).eq("name", agent.name);
const result = existing.data?.[0]
  ? await supabase.from("agents").update(agent).eq("id", existing.data[0].id).select("id,name").single()
  : await supabase.from("agents").insert(agent).select("id,name").single();
console.log("Agent:", JSON.stringify(result.data ?? result.error));

const hours = {
  mon: [["09:00", "13:00"], ["14:00", "17:30"]],
  tue: [["09:00", "13:00"], ["14:00", "17:30"]],
  wed: [["09:00", "13:00"], ["14:00", "17:30"]],
  thu: [["09:00", "13:00"], ["14:00", "17:30"]],
  fri: [["09:00", "13:00"], ["14:00", "17:30"]],
  sat: [["09:00", "13:00"]],
};
const doctor = await supabase.from("providers").select("id").eq("tenant_id", TENANT_ID).eq("name", "Dr. Rohan Mehta");
if (!doctor.data?.[0]) {
  const ins = await supabase
    .from("providers")
    .insert({ tenant_id: TENANT_ID, name: "Dr. Rohan Mehta", specialty: "General Physician", color: "#34D399", status: "active", default_slot_minutes: 20, working_hours: hours })
    .select("id")
    .single();
  console.log("Doctor:", JSON.stringify(ins.data ?? ins.error));
}
