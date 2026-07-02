import { detectTextEmotion } from "./lib/emotion/detect.js";
import { getEmotionPersona } from "./lib/emotion/persona.js";
import fs from "fs";
var SENTENCES = [
    "Oh, great! Another three-hour wait for technical support. This is exactly how I wanted to spend my afternoon.",
    "I wouldn't say the experience was exactly terrible, but it certainly wasn't what I’d call 'good' either.",
    "That new feature is sick!",
    "The update fixed my biggest issue, but honestly, the process was so painful I’m not sure it was worth the headache.",
    "Great features, terrible support.",
    "i am feeling low because i got an internship"
];
function runTests() {
    var md = "# Emotion Engine Stress Test Results\n\n";
    md += "Testing the emotion engine against highly difficult, nuanced, and contradictory sentences to see how it handles sarcasm, mixed signals, and complex negation.\n\n";
    for (var _i = 0, SENTENCES_1 = SENTENCES; _i < SENTENCES_1.length; _i++) {
        var text = SENTENCES_1[_i];
        var current = detectTextEmotion(text);
        var persona = getEmotionPersona({
            current: current,
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
        md += "### Sentence: \"".concat(text, "\"\n");
        md += "- **Detected Label:** `".concat(current.label, "` (Intensity: ").concat(current.intensity.toFixed(2), ")\n");
        md += "- **VAD:** v=".concat(current.vad.v.toFixed(2), ", a=").concat(current.vad.a.toFixed(2), ", d=").concat(current.vad.d.toFixed(2), "\n");
        md += "- **isMixed Flag:** `".concat(current.isMixed || false, "`\n");
        md += "- **LLM Persona Strategy:**\n";
        md += "  - **Tone:** ".concat(persona.tone, "\n");
        md += "  - **Opening Style:** ".concat(persona.openingStyle, "\n");
        md += "  - **Example:** \"".concat(persona.example, "\"\n\n");
        md += "---\n\n";
    }
    fs.writeFileSync("TEST_RESULTS.md", md);
    console.log("Wrote TEST_RESULTS.md");
}
runTests();
