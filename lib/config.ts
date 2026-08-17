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
    // ltmClient raised 3 -> 6: a knowledge-base document can be dozens of
    // chunks (e.g. a multi-page resume/deck), and with real semantic
    // embeddings now driving ranking (see lib/util/local-embedder.ts) a
    // broader top-K surfaces more of the document's actual breadth per turn
    // instead of only ever showing the 3 highest-scoring chunks — directly
    // targets "the PDF has more in it than what the agent ever mentions".
    topK: { mtm: 6, ltmUser: 3, ltmClient: 6 },
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
    // (lib/agent/llm.ts) until one succeeds. Groq is now first: Groq's whole
    // product is running open models on custom LPU inference hardware for
    // very low per-token latency. ZenMux and OpenAI stay as fallbacks for
    // when Groq's key/quota isn't available. Each entry's `envKey` is read
    // by KeyRotator (lib/util/keys.ts), which already supports
    // comma-separated multi-key rotation for ANY of these. baseURL/model are
    // env-overridable (GROQ_MODEL / ZENMUX_BASE_URL / ZENMUX_MODEL) since
    // exact model catalogs are account/deployment-specific and change over
    // time (Groq in particular has fully removed models it once supported —
    // check `GET /openai/v1/models` with your key if a default below goes
    // stale).
    providers: [
      {
        name: "groq",
        baseURL: "https://api.groq.com/openai/v1",
        // Verified live against this account's actual `GET /openai/v1/models`
        // catalog (not assumed) — "llama-3.1-8b-instant" 404'd despite being
        // Groq's commonly-documented small/fast model, meaning it isn't on
        // this account/API version. Of what's actually available,
        // "allam-2-7b" is smaller but doesn't support tool calling at all
        // (a hard 400 from Groq, verified live) — a non-starter, since
        // every live turn needs tools. "openai/gpt-oss-20b" is the smallest
        // model that both exists on this account AND supports tool calling
        // (~6x smaller than "openai/gpt-oss-120b", the previous default).
        // It IS a reasoning model though — verified live it was silently
        // spending most/all of maxOutputTokens on a hidden `reasoning` field
        // before ever writing `content`, which is exactly what surfaced as
        // "[LLM] Tool-call loop exhausted without a final reply" and
        // occasional visibly truncated replies once this became the
        // primary provider. `reasoningEffort: "low"` below (Groq/OpenAI's
        // own supported knob for gpt-oss models) fixes that at the source
        // rather than just paying for a bigger token budget.
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        envKey: "GROQ_API_KEYS",
        reasoningEffort: "low" as const,
      },
      {
        name: "zenmux",
        baseURL: process.env.ZENMUX_BASE_URL || "https://zenmux.ai/api/v1",
        model: process.env.ZENMUX_MODEL || "openai/gpt-4o-mini",
        envKey: "ZENMUX_API_KEY",
      },
      { name: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini", envKey: "OPENAI_API_KEY" },
    ] as Array<{ name: string; baseURL: string; model: string; envKey: string; reasoningEffort?: "low" | "medium" | "high" }>,
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
    /**
     * Minimum text-layer content length before extracted PDF text is
     * trusted. Below this, lib/knowledge/pdf.ts's OCR fallback kicks in
     * instead. Live-verified this matters: a real graphic-design menu PDF
     * (all text rendered as vector paths, no text layer at all) returned
     * ZERO text items from pdfjs-dist's own getTextContent() — a
     * previous version of this check (using the pdf-parse library, since
     * removed) passed a near-empty extraction through anyway and silently
     * "succeeded" with a single near-content-free chunk, making the agent
     * unable to answer anything from a document that LOOKED successfully
     * ingested in the UI.
     */
    minRealTextChars: 20,
    /** Safety cap on how many pages OCR will process for one document —
     * OCR is slow (multiple seconds per page) and only runs at ingest
     * time (never blocks a live call turn), but an unbounded scanned
     * multi-hundred-page document could still make an upload request hang
     * far too long. */
    ocrMaxPages: 15,
    /**
     * Above this many chunks for one document, group them into
     * "stacks" of ~stackGroupSize chunks each and generate a one-line LLM
     * summary per stack (lib/knowledge/ingest.ts's writeStackSummaries()) — the summary itself
     * becomes a normally-retrievable top-level record, and its detail
     * chunks stay retrievable underneath it via `stackId`. Below this
     * threshold, chunks are retrieved directly with no extra hierarchy —
     * a 1-page menu (1 chunk) never touches this path at all, matching
     * "only big or multiple files should be made into this format."
     */
    stackThresholdChunks: 20,
    stackGroupSize: 8,
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
    /**
     * Persona hysteresis (see lib/emotion/persona-lock.ts): how many
     * consecutive turns must show the OPPOSITE valence direction from the
     * currently locked tone before the agent's persona actually shifts.
     * E.g. a caller who started angry (negative) stays getting the
     * de-escalating persona until 4 turns in a row read positive — not on
     * the first positive-sounding turn, which is exactly the "don't flip
     * tone on noise" behavior this was built for. Distress always
     * overrides this immediately regardless of streak — see the safety
     * override in resolvePersonaLock().
     */
    personaLockStreakThreshold: 4,
  },
  realtime: {
    /**
     * If a turn (STT-final -> handleTurn() resolving) hasn't produced any
     * spoken reply within this many ms, server.ts/stream-handler.ts
     * proactively speak a short "just a moment" filler so the caller isn't
     * sitting in dead air wondering if the call dropped — then the real
     * reply follows once it's ready. In steady state this practically
     * never fires (turns are typically ~1.5-3.5s end to end after this
     * session's latency fixes), but it's a real safety net for the
     * occasional slow turn (e.g. a third-party LLM provider's shared-tier
     * queueing spike, observed live to occasionally run 6-15s with no
     * error) rather than leaving the caller with silence for that long.
     */
    turnFillerThresholdMs: 3000,
    turnFillerPhrase: "One moment, let me check on that for you.",
  },
} as const;
