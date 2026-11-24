/**
 * End-to-end check of call learning against the REAL model + REAL embeddings,
 * with an in-memory store (no database writes).
 * Run: npx tsx --env-file=.env.local scripts/learning-e2e.mts
 */
import { learnFromCall, getLearningContext, invalidateLearningContext, loadTranscriptFromSession, type LearnDeps } from "../lib/learning";
import { extractWithLlm } from "../lib/learning/extract";
import { createMemoryLearningStore } from "../lib/learning/store";
import { embed } from "../lib/util/embed";
import { generateReply } from "../lib/agent/llm";

type T = { role: "user" | "agent"; text: string }[];
const CLIENT = "e2e-tenant";
const calls: Record<string, { agent: string; patient: string; turns: T }> = {
  c1: { agent: "aarti", patient: "riva", turns: [
    { role: "agent", text: "Hello Riva, this is Aarti from Sunshine Hospital, how is your recovery going?" },
    { role: "user", text: "Hello. My knee has been hurting when I climb the stairs, mostly in the evening." },
    { role: "agent", text: "I'm sorry to hear that. Would you like to come in to see the doctor?" },
    { role: "user", text: "Maybe. Please call me after six in the evening, I am at work until then. My daughter Meera helps me with my medicines." },
    { role: "agent", text: "Sure, I will note that." },
    { role: "user", text: "I also forgot my night tablet twice this week." },
    { role: "agent", text: "Okay, please take care." } ] },
  c2: { agent: "aarti", patient: "riva", turns: [
    { role: "agent", text: "Hello Riva, how is the knee now?" },
    { role: "user", text: "The knee is much better now, the pain is gone. I took all my tablets this week." },
    { role: "agent", text: "That is wonderful to hear." },
    { role: "user", text: "Yes. And please remember, only call me in the evening." } ] },
  c3: { agent: "devu", patient: "hardik", turns: [
    { role: "agent", text: "Hi Hardik, I can book you with Dr. Desai on Monday at 9, 9:30, 10, 10:30, 11 or 11:30, or Tuesday at 2, 2:30 or 3." },
    { role: "user", text: "That is too many options, I get confused. Just give me two choices." },
    { role: "agent", text: "Of course. Monday at 10 or Tuesday at 2?" },
    { role: "user", text: "Monday at 10 is fine. Also I am allergic to penicillin." } ] },
  c4: { agent: "aarti", patient: "meena", turns: [
    { role: "agent", text: "I have slots at 9, 9:30, 10, 10:30, 11, 11:30, 2, 2:30 and 3 this week, which one works?" },
    { role: "user", text: "Oh, so many times, I cannot decide. Please just tell me one or two times." },
    { role: "agent", text: "Sorry about that. How about Thursday at 11?" },
    { role: "user", text: "Yes, Thursday at 11 works." } ] },
};
const agentName: Record<string, string> = { aarti: "Aarti", devu: "Devu" };

const store = createMemoryLearningStore();
const deps: LearnDeps = {
  store,
  loadTranscript: async (id) => calls[id].turns,
  extract: extractWithLlm,
  embed: (t) => embed(t),
  resolveIdentity: async ({ clientId, agentId, patientId }) => ({ clientId, agentName: agentName[agentId ?? ""], names: [patientId === "riva" ? "Riva Sharma" : patientId === "hardik" ? "Hardik Kadd" : "Meena"], phones: [] }),
};

let failures = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures++; };

for (const id of ["c1", "c2", "c3", "c4"]) {
  const out = await learnFromCall({ sessionId: id, clientId: CLIENT, agentId: calls[id].agent, patientId: calls[id].patient }, deps);
  console.log(`\n${id}:`, JSON.stringify(out.merge), out.rejected?.length ? `rejected=${JSON.stringify(out.rejected)}` : "");
}
invalidateLearningContext();

console.log("\n── stored learnings ──");
for (const r of store.rows) console.log(`[${r.scope}${r.agentId ? ":" + r.agentId : ""}${r.patientId ? ":" + r.patientId : ""}] ${r.status.padEnd(7)} x${r.supportCount} ${r.category}/${r.key ?? "-"}: ${r.text}`);

const riva = await store.listPatient(CLIENT, "riva");
const rivaText = riva.map((r) => r.text.toLowerCase()).join(" | ");
check(riva.length >= 2, `Riva has ${riva.length} active facts`);
check(/6|six|evening/.test(rivaText), "Riva: evening call preference learned");
check(/meera|daughter/.test(rivaText), "Riva: daughter helps with medicines learned");
const knee = riva.filter((r) => /knee/i.test(r.text));
check(knee.length === 1 && /resolved|gone|better|no longer|improv/i.test(knee[0].text), `Riva: knee fact reflects the NEWEST call ("${knee[0]?.text}")`);
const hardik = (await store.listPatient(CLIENT, "hardik")).map((r) => r.text.toLowerCase()).join(" | ");
check(/penicillin/.test(hardik), "Hardik: penicillin allergy learned");
check(!rivaText.includes("penicillin") && !hardik.includes("meera"), "no cross-patient leakage");

const globals = await store.listGlobal(CLIENT);
check(globals.length >= 1, `global lesson formed from two different agents (${globals.length})`);
check(globals.every((g) => !/hardik|riva|meena|meera|penicillin/i.test(g.text)), "global lessons contain no personal details");

const ctx = await getLearningContext({ clientId: CLIENT, agentId: "aarti", patientId: "riva" }, store);
console.log("\n── context Aarti gets before her next call with Riva ──\n" + ctx);
check(!!ctx && /evening|6/i.test(ctx), "context carries Riva's preference");

const reply = await generateReply({
  system: `You are Aarti, a warm care coordinator at Sunshine Hospital on a live phone call. Reply in 1-2 short spoken sentences.\n\n${ctx}`,
  user: "USER: Hi, can you call me again tomorrow?",
  clientId: CLIENT,
  useTools: false,
});
console.log("\nAarti's next-call opening:", reply.text);
check(/evening|6|after six|pm/i.test(reply.text), "agent uses the learned call-time preference unprompted");

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
