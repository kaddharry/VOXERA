/**
 * Scores an emotion engine on the hand-labelled set (__tests__/emotion/fixtures/emotion-dataset.ts):
 * overall accuracy, accuracy by language, the worst confusions, and speed per utterance.
 *   npx tsx --env-file=.env.local scripts/emotion-eval.ts            -> the engine the app uses today
 * Valence-group accuracy (positive / negative / neutral) is also shown, since "happy vs excited" is a smaller
 * mistake than "happy vs angry".
 */
import { HOLDOUT } from "../__tests__/emotion/fixtures/emotion-holdout";
import { DATASET, type Case } from "../__tests__/emotion/fixtures/emotion-dataset";
import { detectTextEmotion } from "../lib/emotion/detect";

const GROUP: Record<string, string> = {
  joy: "pos", excitement: "pos", gratitude: "pos", relief: "pos", calm: "pos",
  neutral: "neu", surprise: "neu", confusion: "neu",
  worry: "neg", fear: "neg", sadness: "neg", distress: "neg", pain: "neg", disappointment: "neg", frustration: "neg", anger: "neg",
};

export async function evaluate(name: string, predict: (c: Case) => Promise<string>, cases: Case[] = DATASET) {
  const wrong: Array<{ c: Case; got: string }> = [];
  const byLang: Record<string, [number, number]> = {};
  const confusion = new Map<string, number>();
  let ok = 0, groupOk = 0, totalMs = 0, maxMs = 0;
  for (const c of cases) {
    const t0 = performance.now();
    const got = await predict(c);
    const ms = performance.now() - t0; totalMs += ms; maxMs = Math.max(maxMs, ms);
    const hit = got === c.label;
    if (hit) ok++; else { wrong.push({ c, got }); confusion.set(`${c.label} → ${got}`, (confusion.get(`${c.label} → ${got}`) ?? 0) + 1); }
    if ((GROUP[got] ?? "?") === GROUP[c.label]) groupOk++;
    const l = (byLang[c.lang] ??= [0, 0]); l[1]++; if (hit) l[0]++;
  }
  const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`;
  console.log(`\n=== ${name} ===`);
  console.log(`exact label accuracy: ${pct(ok, cases.length)} (${ok}/${cases.length})   valence-group accuracy: ${pct(groupOk, cases.length)}`);
  console.log("by language:", Object.entries(byLang).map(([k, [a, b]]) => `${k} ${pct(a, b)}`).join("  "));
  console.log(`speed: avg ${(totalMs / cases.length).toFixed(1)} ms, slowest ${maxMs.toFixed(0)} ms per utterance`);
  console.log("most common mistakes:", [...confusion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} (${v})`).join(" | "));
  return { ok, total: cases.length, wrong };
}

if (process.argv[1]?.endsWith("emotion-eval.ts")) {
  (async () => {
    const log = console.log; console.log = () => {};
    await detectTextEmotion("warm up", { language: "en-IN" }); // load the model once
    console.log = log;
    await evaluate("HELD-OUT set (fast rules path)", async (c) => (await detectTextEmotion(c.text, { language: c.lang === "en" ? "en-IN" : "auto" })).primary.label, HOLDOUT);
    await evaluate("CURRENT engine (lexicon + English ONNX)", async (c) => (await detectTextEmotion(c.text, { language: c.lang === "en" ? "en-IN" : "auto" })).primary.label);
    process.exit(0);
  })();
}
