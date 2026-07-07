export const CONFIG = {
  memory: {
    stmMaxTurns: 12,
    tierThresholds: { mtm: 0.3, ltm: 0.7 },
    mergeSimilarity: 0.93,
    decayTau0Ms: 1000 * 60 * 60 * 24 * 7,
    decayLambda: 2.0,
    ltmRecurrenceK: 3,
  },
  importance: {
    alpha: 0.3,
    beta: 0.2,
    gamma: 0.1,
    delta: 0.1,
    epsilon: 0.25,
    zeta: 0.05,
  },
  retrieval: {
    topK: { mtm: 6, ltmUser: 3, ltmClient: 3 },
    w: { sem: 0.45, emo: 0.2, rec: 0.15, imp: 0.15, stale: 0.05, redund: 0.15 },
    tauFreshMs: 1000 * 60 * 60 * 24 * 3,
    minSemScore: 0.35,
  },
  gates: {
    minSttConfidence: 0.55,
    minEmotionConfidence: 0.5,
    minRetrievalScore: 0.4,
  },
  deepgram: {
    sttModel: "nova-2-general",
    sttTier: "enhanced",
    ttsModel: "aura-asteria-en", // Default: female, friendly
    language: "en",
    // FR-25: Available voice personas for businesses to choose from
    voicePersonas: {
      "female-friendly": { model: "aura-asteria-en", label: "Female · Friendly" },
      "male-formal": { model: "aura-orion-en", label: "Male · Formal" },
      "female-formal": { model: "aura-athena-en", label: "Female · Formal" },
      "male-friendly": { model: "aura-arcas-en", label: "Male · Friendly" },
    } as Record<string, { model: string; label: string }>,
  },
  llm: {
    providers: [
      { name: "groq", baseURL: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", envKey: "GROQ_API_KEYS" },
      { name: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini", envKey: "OPENAI_API_KEY" },
    ] as Array<{ name: string; baseURL: string; model: string; envKey: string }>,
    maxInputTokens: 6000,
    maxOutputTokens: 400,
  },
  taskCritical: [
    "payment",
    "refund",
    "cancel",
    "medical",
    "legal",
    "safety",
    "signal",
    "outage",
    "password",
    "charge",
    "escalate",
  ],
  knowledge: {
    chunkSize: 500,
    chunkOverlap: 100,
    maxFileSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ["text/plain", "application/pdf"] as string[],
  },
  telephony: {
    // FR-19: Max concurrent calls before queue/reject logic kicks in
    maxConcurrentCalls: 10,
    // Twilio mulaw audio spec (do not change — Twilio always sends 8kHz mulaw)
    sampleRate: 8000,
    encoding: "mulaw" as const,
  },
} as const;
