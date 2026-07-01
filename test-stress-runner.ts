import { detectTextEmotion } from "./lib/emotion/detect";
import { getEmotionPersona } from "./lib/emotion/persona";
import fs from "fs";

const SENTENCES = [
  "Oh, great! Another three-hour wait for technical support. This is exactly how I wanted to spend my afternoon.",
  "I wouldn't say the experience was exactly terrible, but it certainly wasn't what I’d call 'good' either.",
  "That new feature is sick!",
  "The update fixed my biggest issue, but honestly, the process was so painful I’m not sure it was worth the headache.",
  "Great features, terrible support.",
  "i am feeling low because i got an internship"
];

function runTests() {
  let md = "# Emotion Engine Stress Test Results\n\n";
  md += "Testing the emotion engine against highly difficult, nuanced, and contradictory sentences to see how it handles sarcasm, mixed signals, and complex negation.\n\n";

  for (const text of SENTENCES) {
    const current = detectTextEmotion(text);
    const persona = getEmotionPersona({
      current,
      trajectory: { slope_v: 0, slope_a: 0, window: 0 },
      zDeviation: 0,
      flags: {
        repeated_frustration: false,
        increasing_distress: false,
        affect_oscillation: false,
        chronic_negativity: false
      },
      baseline: { v: 0, a: 0, d: 0, sigma_v: 0, sigma_a: 0, sigma_d: 0 }
    });

    md += `### Sentence: "${text}"\n`;
    md += `- **Detected Label:** \`${current.label}\` (Intensity: ${current.intensity.toFixed(2)})\n`;
    md += `- **VAD:** v=${current.vad.v.toFixed(2)}, a=${current.vad.a.toFixed(2)}, d=${current.vad.d.toFixed(2)}\n`;
    md += `- **isMixed Flag:** \`${current.isMixed || false}\`\n`;
    md += `- **LLM Persona Strategy:**\n`;
    md += `  - **Tone:** ${persona.tone}\n`;
    md += `  - **Opening Style:** ${persona.openingStyle}\n`;
    md += `  - **Example:** "${persona.example}"\n\n`;
    md += `---\n\n`;
  }

  fs.writeFileSync("TEST_RESULTS.md", md);
  console.log("Wrote TEST_RESULTS.md");
}

runTests();
