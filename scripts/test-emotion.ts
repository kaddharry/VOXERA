import { detectTextEmotion } from "../lib/emotion/detect";
import { performance } from "perf_hooks";

const TEST_CASES = [
  "This is absolutely amazing!!! I can't wait!",
  "I am so frustrated, this is the third time it broke.",
  "I don't understand how this works at all???",
  "Thank you so much, you've been incredibly helpful.",
  "I am furious right now, this is unacceptable!",
  "Oh my god, I got the job!!! Yes yes yes!",
  "I'm feeling really down and miserable today.",
  "I expected better, this is such a let down.",
  "I'm terrified about what might happen next.",
  "It's finally resolved, what a relief.",
  "I just want to cancel everything, this is costing me money.",
  "Wow, that's incredible!!!",
  "This is a test of a completely neutral sentence.",
  "This is so ridiculous. I've been waiting for hours.",
  "What do you mean by that? I'm lost.",
];

console.log("=========================================");
console.log("   EMOTION / SENTIMENT ANALYSIS TEST");
console.log("=========================================\n");

let totalLatency = 0;
let maxLatency = 0;
let minLatency = Infinity;

for (const text of TEST_CASES) {
  const start = performance.now();
  
  // Run the emotion detection
  const result = detectTextEmotion(text);
  
  const end = performance.now();
  const latency = end - start;
  
  totalLatency += latency;
  maxLatency = Math.max(maxLatency, latency);
  minLatency = Math.min(minLatency, latency);

  console.log(`[Text]   : "${text}"`);
  console.log(`[Label]  : ${result.label.toUpperCase()} (Confidence: ${result.confidence.toFixed(2)} - ${result.confidenceCategory.level})`);
  console.log(`[VAD]    : v: ${result.vad.v.toFixed(2)}, a: ${result.vad.a.toFixed(2)}, d: ${result.vad.d.toFixed(2)}`);
  console.log(`[Latency]: ${latency.toFixed(4)} ms`);
  console.log("-----------------------------------------");
}

const avgLatency = totalLatency / TEST_CASES.length;

console.log("\n=========================================");
console.log("             PERFORMANCE REPORT");
console.log("=========================================");
console.log(`Total sentences tested : ${TEST_CASES.length}`);
console.log(`Average Latency        : ${avgLatency.toFixed(4)} ms`);
console.log(`Max Latency            : ${maxLatency.toFixed(4)} ms`);
console.log(`Min Latency            : ${minLatency.toFixed(4)} ms`);
console.log("=========================================\n");
