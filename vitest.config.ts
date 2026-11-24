import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The small-model emotion classifier calls the LLM; unit tests that mock generateReply must not see extra calls.
    env: { EMOTION_LLM: "off" },
  },
});
