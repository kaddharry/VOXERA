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
    // Order is the fallback priority, tried top to bottom by generateReply()
    // (lib/agent/llm.ts) until one succeeds: ZenMux first, then the existing
    // Groq key-rotation setup, then OpenAI. Each entry's `envKey` is read by
    // KeyRotator (lib/util/keys.ts), which already supports comma-separated
    // multi-key rotation for ANY of these — ZenMux gets that for free, not
    // just Groq. baseURL/model are env-overridable (ZENMUX_BASE_URL /
    // ZENMUX_MODEL) since ZenMux's exact model catalog is account/deployment
    // -specific; the values below are only fallback defaults.
    providers: [
      {
        name: "zenmux",
        baseURL: process.env.ZENMUX_BASE_URL || "https://zenmux.ai/api/v1",
        model: process.env.ZENMUX_MODEL || "openai/gpt-4o-mini",
        envKey: "ZENMUX_API_KEY",
      },
      {
        name: "groq",
        baseURL: "https://api.groq.com/openai/v1",
        // Was hardcoded to "llama-3.3-70b-versatile", which Groq has since
        // fully removed from their catalog (confirmed live: every request
        // returned a 400 "does not exist or you do not have access to it"
        // — every single turn silently fell through past Groq to whatever
        // came after it, all session). Groq's available models change
        // over time faster than most providers here, so this is now
        // env-overridable like ZenMux's — check `GET /openai/v1/models`
        // with your key if this one goes stale too.
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        envKey: "GROQ_API_KEYS",
      },
      { name: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini", envKey: "OPENAI_API_KEY" },
    ] as Array<{ name: string; baseURL: string; model: string; envKey: string }>,
    maxInputTokens: 6000,
    // Kept tight for voice/realtime turns — long completions add seconds of
    // TTS-wait latency and break the "feels like a phone call" pacing.
    maxOutputTokens: 160,
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
    maxFileSizeBytes: 10 * 1024 * 1024,
    allowedMimeTypes: [
      "text/plain",
      "application/pdf",
      "text/markdown",
      "text/csv",
      "application/json",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
    ] as string[],
  },
  telephony: {
    // FR-19: Max concurrent calls before queue/reject logic kicks in
    maxConcurrentCalls: 10,
    // Twilio mulaw audio spec (do not change — Twilio always sends 8kHz mulaw)
    sampleRate: 8000,
    encoding: "mulaw" as const,
    // Issue #14: Energy threshold for barge-in detection (16-bit PCM RMS).
    // Only trigger TTS interruption when caller audio exceeds this level.
    // Prevents false barge-ins from background noise. Was 500 — live testing
    // showed room static/AC hum on some lines registering enough RMS to
    // falsely trigger; raised to reduce that without requiring a shout to
    // interrupt (typical speech RMS is 1000-6000+, see the energyNorm
    // normalization in lib/emotion/audio-emotion.ts).
    bargeInEnergyThreshold: 800,
    // Issue #14: Silence threshold for pause detection in acoustic analysis
    // (lib/audio/acoustic.ts's detectPauses()). Was 200 and, until now, only
    // duplicated by a hardcoded local constant in acoustic.ts rather than
    // actually read from here — raised modestly to treat more low-level
    // background noise as silence, still well below genuine speech energy.
    silenceEnergyThreshold: 300,
  },
  emotion: {
    /**
     * When true, the orchestrator additionally runs the full diagnostic
     * engine comparison (HF + Lexicon + Local ONNX + Acoustic) on every turn
     * and attaches it to the trace/session log. Off by default in production
     * to avoid the extra local-model inference and logging cost on every
     * live call — enable for debugging or via scripts/test-emotion-diagnostic.ts.
     */
    diagnosticMode: false,
    /** Strict latency budget (ms) for the HuggingFace API call. */
    hfLatencyBudgetMs: 200,
    /**
     * Latency budget (ms) for the local ONNX text-emotion model
     * (lib/emotion/local-emotion-classifier.ts). Higher than the HF budget
     * because it's a one-time model-load cost on cold start, not a per-call
     * network round trip — once warm it typically finishes in single-digit
     * ms. Doesn't actually cancel the in-flight classification (JS can't
     * abort mid-inference), just stops the production turn from waiting on
     * it past this point.
     */
    localOnnxLatencyBudgetMs: 500,
    /**
     * Latency budget (ms) for the wav2vec2 local acoustic-ML diagnostic
     * engine (lib/emotion/local-audio-detect.ts). Unlike the text ONNX
     * model, this one has no existing race/timeout at all — verified live,
     * its cold load is ~56s and even warm inference is ~330ms, both far
     * past what a live turn can afford to block on. This budget is enforced
     * by runDiagnosticEmotion() (lib/emotion/emotion-debug.ts) the same way
     * localOnnxLatencyBudgetMs is: it doesn't cancel in-flight inference,
     * it just stops the diagnostics pass from waiting on it past this point.
     */
    localAudioMlLatencyBudgetMs: 1500,
    /** Maximum audio confidence for short utterances (<5s). */
    audioConfidenceCeiling: 0.75,
    /** Maximum audio confidence for long utterances (>8s) with clear patterns. */
    audioConfidenceCeilingLong: 0.85,
    /** Minimum confidence margin required for one engine to override another in fusion. */
    fusionConfidenceMargin: 0.15,
    /** Below this confidence, both engines are effectively guessing → default to neutral. */
    fusionMinConfidence: 0.3,
  },
} as const;
