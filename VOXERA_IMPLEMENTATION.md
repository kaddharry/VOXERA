# VOXERA Technical Implementation Handbook

This document serves as the authoritative technical implementation handbook for the VOXERA platform, describing the current production-ready architecture, workflows, database schemas, and external integrations.

---

## 1. Overview

VOXERA is a multi-tenant, emotion-adaptive AI voice receptionist and SaaS operations platform. It allows businesses to handle phone calls, answer customer queries using a document-trained Knowledge Base (RAG), and book appointments with real-time Google Calendar and Resend email synchronizations.

---

## 2. High-Level Architecture

The system operates across three primary boundaries:
1. **Next.js App Router Frontend & Management API**: Handles tenant authentication, document uploads, settings configuration, and session analytics.
2. **Telephony & Audio Streaming Engine**: Connects Twilio phone lines to a real-time WebSocket connection, handling bi-directional audio codecs (mulaw to PCM and vice versa) and streaming audio packets to/from Deepgram.
3. **AI Orchestrator & Database Layer**: Routes transcriptions through vector memory stores, applies emotion-aware prompt policies, runs LLM tool-calling loops, interacts with Google Calendar/Resend, and records structured event logs in Supabase Postgres.

```
                  [Caller Phone Line]
                          │ (SIP)
                          ▼
                   [Twilio Telecom]
                          │ (HTTPS Webhook)
                          ▼
            [Next.js api/telephony/incoming] ── (Retrieves Tenant ID)
                          │ (Returns TwiML Connect Stream)
                          ▼
               [Twilio Media Stream]
                          │ (WebSockets / 8kHz mulaw)
                          ▼
            [Next.js api/telephony/stream] ── (TelephonyStreamHandler)
                          │
                          ├─► [PCM Conversion] ──► [Deepgram Live STT]
                          │                                │ (Text Transcript)
                          │                                ▼
                          │                        [AI Orchestrator]
                          │                                │ (Semantic Memory + RAG)
                          │                                ├─► [Supabase Vector DB]
                          │                                ├─► [Groq Llama 3.3]
                          │                                ├─► [Integrations: Google Calendar, Resend]
                          │                                ▼
                          │                        (Text Response)
                          │                                │
                          │                                ▼
                          │                        [Deepgram TTS]
                          │                                │ (MP3 Audio)
                          │                                ▼
                          │                        [Audio Codec / mulaw]
                          │                                │ (8kHz mulaw)
                          │                                ▼
                          └────────────────────────► [Twilio Stream]
```

---

## 3. Feature Status Summary

All core features are implemented, tested, and fully integrated:
* **Multi-Tenant Isolation & Security (FR-23)**: Fully active and hardened. Row-Level Security (RLS) is strictly enforced on all tables mapping to `auth.uid()`. Client IDs are securely resolved server-side from Supabase cookies. Tenant integrations (like Google Calendar) use AES-256-GCM encryption for credential storage.
* **Voice Cloning & TTS (FR-24)**: Supports integration with ElevenLabs for custom tenant voice cloning alongside Deepgram Aura.
* **Customer Recovery SMS (FR-25)**: Automated post-call SMS follow-ups are triggered for conversations ending with negative sentiments using Twilio/Resend.
* **Distributed State & Redis (FR-26)**: Core telephony queues and circuit breaker states are synchronized across horizontal instances using `ioredis` and Pub/Sub.
* **Telephony & Real-Time Codecs (FR-1, FR-19)**: Inbound Twilio streams are processed in-process via custom WebSockets. Supports queue routing, wait metric estimations, and status logging.
* **Emotion-Aware Routing (FR-11, FR-18)**: Dynamically injects voice coaching rules into system prompts. Triggers human-escalation flags upon sustained customer negativity or extreme anger.
* **Vector Memory & Document Ingestion (FR-10, FR-16)**: Supports paginated document table, error detail drawer, cascade deletions, and automatic duplicate prevention (superseding old document chunks).
* **Advisory Slot Locking (FR-13)**: Employs Postgres-level advisory transactions to eliminate double-booking race conditions.
* **Integrations (FR-14, FR-15)**: Actively syncs Google Calendar events via a custom OAuth2 JWT client and sends personalized confirmation emails via Resend.
* **SVG/CSS Dashboard (FR-22)**: Visualizes real-time metrics, heatmaps, trends, conversion rates, and confidence distributions without heavy graphing libraries.

---

## 4. System Modules

### 4.1 Authentication & Multi-Tenancy
* **Purpose**: Restricts access to client analytics, settings, and documents, guaranteeing zero cross-tenant leakage.
* **Implementation Logic**:
  - Uses `@supabase/ssr` to instantiate cookie-based clients.
  - Layout-level middleware (`app/admin/layout.tsx`) intercepts unauthenticated routes and redirects users to `/login`.
  - Backend API endpoints extract the authenticated client credentials directly from the session cookie instead of trusting client-supplied URL parameters.
  - Supabase backend enforces multi-tenant isolation directly via RLS policies mapping to `auth.uid()`. `SERVICE_ROLE_KEY` usage has been deprecated in favor of secure user contexts.
* **Files & Directories**:
  - [server.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/db/server.ts) — Server-side Supabase client initialization.
  - [page.tsx](file:///Users/hardikkadd/Desktop/Projects/VOXERA/app/login/page.tsx) & [actions.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/app/login/actions.ts) — Server actions for login, logout, and signup.
  - [layout.tsx](file:///Users/hardikkadd/Desktop/Projects/VOXERA/app/admin/layout.tsx) — Protected layout routing.

### 4.2 Telephony, WebSockets & Audio Codecs
* **Purpose**: Establishes bi-directional audio connections with Twilio.
* **Implementation Logic**:
  - Incoming Webhook (`/api/telephony/incoming`) validates Twilio signatures, verifies active phone numbers, checks queue thresholds, and generates hold (`buildWaitTwiml`) or media stream (`buildConnectTwiml`) TwiML responses.
  - WebSocket Upgrade (`/api/telephony/stream`) runs an in-process socket handler.
  - `TelephonyStreamHandler` converts 8kHz mono mulaw audio bytes to 16kHz linear PCM using an in-memory decoding lookup table.
  - Transformed PCM is piped into `DeepgramLiveWrapper` via WebSockets.
  - When the orchestrator produces a response, Deepgram TTS generates an MP3, which is decoded to raw PCM, resampled, encoded back into 8kHz mulaw bytes, and flushed to Twilio.
* **Files & Directories**:
  - [twilio.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/telephony/twilio.ts) — HMAC webhook validation and TwiML generators.
  - [stream-handler.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/telephony/stream-handler.ts) — Mulaw codec conversion table and telephony socket manager.
  - [route.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/app/api/telephony/incoming/route.ts) — Webhook entry endpoint.
  - [route.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/app/api/telephony/stream/route.ts) — WebSocket upgrade endpoint.
  - [route.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/app/api/telephony/status/route.ts) — Twilio callback endpoint to update call durations.
  - [server.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/server.ts) — Standalone WebSocket server running on port 3001 for browser/script testing.
  - **Issue #14 Enhancements**:
    - **Energy-Based Barge-In**: Incoming audio packets compute RMS energy via `computeRmsEnergy()`. TTS playback is only interrupted when RMS exceeds `CONFIG.telephony.bargeInEnergyThreshold` (default: 500), preventing false triggers from background noise.
    - **PCM Accumulation**: Decoded PCM chunks are buffered in `turnAudioChunks[]` during each speech turn and concatenated for acoustic feature extraction upon final transcript.
    - **Interruption Tracking**: Barge-in events increment `turnInterruptionCount`, which is passed to the CAI calculator for engagement scoring.

### 4.3 Speech Emotion Recognition (SER) & Emotion Engine
* **Purpose**: Dynamically adjusts agent speaking tone, policies, and safeguards based on the caller's feeling states.
* **Implementation Logic**:
  - Classifies caller mood into one of 11 labels: `neutral`, `frustration`, `anger`, `sadness`, `distress`, `fear`, `confusion`, `joy`, `gratitude`, `excitement`, `disappointment`.
  - Uses a **35+ entry lexicon** (`lib/emotion/lexicon.ts`) covering anger, frustration, distress, sadness, disappointment, fear, confusion, joy, excitement (including pride, accomplishment, celebration keywords), gratitude, stress, and relief.
  - **Context-aware punctuation handling**: Multiple exclamation marks (`!!`) and question marks (`???`) boost arousal in the direction of the already-detected valence, instead of blindly assuming frustration. A **positivity safety net** catches edge cases where a clearly positive message (high valence + high arousal) was incorrectly classified as a negative emotion.
  - Maps labels to structured voice configurations (`lib/emotion/persona.ts`), with 11 full persona definitions including tone instructions, forbidden phrases, opening style coaching, and example sentences.
  - Injects formatted markdown blocks at the highest priority location inside the LLM prompt.
  - Traverses the session timeline to identify sustained negative turns (3 consecutive anger/distress turns or intensity > 0.70), returning `escalate: "human"` to immediately route the caller to human staff.
* **Files & Directories**:
  - [lexicon.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/emotion/lexicon.ts) — 35+ keyword-to-emotion mappings with VAD offsets and weights.
  - [detect.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/emotion/detect.ts) — Text emotion detector with context-aware punctuation and positivity safety net.
  - [persona.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/emotion/persona.ts) — 11 full persona definitions with tone rules, warnings, and priority overrides.
  - [context.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/agent/context.ts) — System prompt builder incorporating emotion coach blocks.
  - [policy.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/agent/policy.ts) — Escalation, pacing, and upsell directive engine.
  - [audio-emotion.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/emotion/audio-emotion.ts) — Issue #14: Maps physical acoustic features (pitch, energy, rate, pauses) to EmotionSignal with `source: "audio"`. Replaces the previous null-returning stub.

### 4.4 Memory & Vector Store (RAG)
* **Purpose**: Stores and retrieves semantic memories and client documents.
* **Implementation Logic**:
  - Stores memory records in a flat Postgres table `memories`.
  - Semantic lookup uses the `match_memories` Supabase RPC, computing cosine similarity over OpenAI-compatible 1536-dimensional embeddings.
  - Automatically deduplicates and merges similar memories using cosine similarity (`>= 0.85`).
  - Implements **Adaptive Memory Ranking & Time-Decay**: 
    - Stored memories maintain an `importance_score` that decays dynamically based on a **7-day half-life** since last retrieval or edit activity.
    - Critical user details (such as allergies, permanent preferences, VIP status, language) are preserved with a score floor of `0.70`, ensuring they never decay out of priority.
    - Retrieving a memory adds a logarithmic boost `+ 0.1 * ln(1 + retrieval_count)` and updates `last_retrieved_at`.
  - Implements **Selection Explainability**: Every retrieved memory calculates its score components (similarity, dynamic importance, recency, retrieval frequency) and generates a detailed explanation for RAG evaluation.
  - **Timeline Chronological Grouping**: Retrieved memories are grouped into event buckets based on time proximity (within 48 hours) and topic sharing, formatting memory context as a narrative sequence.
* **Files & Directories**:
  - [retrieval.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/memory/retrieval.ts) — Semantic search via pgvector, adaptive exponential decay ranking, and timeline clustering.
  - [writer.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/memory/writer.ts) — Memory extraction, recurrence tracking, and LTM promotion.

### 4.5 Knowledge Base Ingestion Pipeline
* **Purpose**: Transforms raw uploaded files into searchable vector knowledge chunks.
* **Implementation Logic**:
  - Upload route (`/api/knowledge/upload`) parses files (.txt, .pdf) and creates an initial document log in the `knowledge_documents` table with status `'processing'`.
  - Compares the uploaded filename against existing documents. If a matching name exists, it increments the file version, marks the old document as `'superseded'`, and removes its existing chunks from the database to avoid duplicate search hits.
  - Extracts text, splits it into semantic chunks, generates 1536-dimensional embeddings, and writes to the `memories` table under a shared `documentId` key.
  - On failure, logs the message stack to `errorMessage` and flags status as `'failed'`. On success, writes status `'ready'`.
  - Cascading deletes are enforced: removing a document via the API executes a foreign key cascade that automatically purges all associated vector memory chunks.
* **Files & Directories**:
  - [ingest.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/knowledge/ingest.ts) — Version checking, chunking, and db serialization.
  - [route.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/app/api/knowledge/upload/route.ts) — Raw file parsing api.
  - [route.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/app/api/knowledge/documents/route.ts) — Search pagination and cascade deletion endpoint.
  - [page.tsx](file:///Users/hardikkadd/Desktop/Projects/VOXERA/app/admin/knowledge/page.tsx) — Management dashboard featuring polling refreshes and error drawers.

### 4.6 Booking Engine & Third-Party Integrations
* **Purpose**: Schedules customer bookings while ensuring thread-safe calendars and notifications.
* **Implementation Logic**:
  - **Thread Safety**: Booking execution runs via the `create_reservation_atomic` Postgres function. This RPC acquires a transactional advisory lock (`pg_advisory_xact_lock`) on the hash of the slot (`clientId + date + time`), preventing race-condition double bookings.
  - **Google Calendar Sync**: Employs a custom REST client to issue signed JSON Web Tokens (RS256 signature using `crypto`) to Google's OAuth2 endpoints on behalf of a Service Account. Tenant credentials are AES-256 encrypted at rest in the `tenant_credentials` table. FreeBusy calls check external conflicts before updating events.
  - **Email Alerts**: Uses the Resend SDK to dynamically send html emails based on state: Confirmations (Green), Rescheduled modifications (Blue), and Cancellations (Red).
* **Files & Directories**:
  - [reservations.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/db/reservations.ts) — Reservation queries, cancellation logs, and atomic RPC invoker.
  - [calendar.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/integrations/calendar.ts) — Custom Google OAuth JWT handler and calendar event API actions.
  - [email.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/integrations/email.ts) — Resend template formatter and dispatcher.
  - [tools.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/agent/tools.ts) — Tool definitions for `create_booking`, `modify_booking`, `cancel_booking`, and `check_availability`.

### 4.7 Analytics Engine
* **Purpose**: Aggregates operation metrics and visualizes dashboards.
* **Implementation Logic**:
  - Analytics API aggregates database tables, filtering on the authenticated `clientId`.
  - Custom SVG/CSS progress arcs, segmented horizontal bars, and vertical layout grids render clean graphics natively, eliminating runtime issues associated with heavy visualization modules.
  - Tool execution routes write logs directly to the database via `dispatchToolCall`, avoiding double counts.
* **Files & Directories**:
  - [route.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/app/api/analytics/route.ts) — Heatmap, trends, and bucket statistics aggregator.
  - [page.tsx](file:///Users/hardikkadd/Desktop/Projects/VOXERA/app/admin/page.tsx) — Dashboard UI.

### 4.8 AI Orchestrator
* **Purpose**: Coordinates conversational loops with optimized parallelism.
* **Implementation Logic**:
  - Uses `llama-3.3-70b-versatile` hosted on Groq.
  - Computes the Commitment Acoustic Index (CAI) based on speech rate, pause intervals, and intensity.
  - Executes tool calling loops, updating sessions with log records on execution outcomes.
  - **Parallelized pipeline**: Independent database fetches (`LTM_user` + `MTM`) run concurrently via `Promise.all`. Memory write and retrieval are also parallelized. This reduces the critical path to only the LLM inference call.
  - **Fire-and-forget observability logging**: All 8 session event log writes are dispatched with `void` (no `await`), ensuring that logging failures or Supabase timeouts never block the user-facing response.
* **Files & Directories**:
  - [orchestrator.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/agent/orchestrator.ts) — Core parallelized loop with fire-and-forget logging.
  - [llm.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/agent/llm.ts) — LLM call wrappers.
  - [session-logger.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/logging/session-logger.ts) — Circuit-breaker-protected event logger that catches all errors internally.

### 4.9 Supabase Resilience Layer
* **Purpose**: Prevents cascading timeouts when the Supabase database is temporarily unreachable.
* **Implementation Logic**:
  - **Timeout Fetch**: All Supabase HTTP requests are wrapped with a 5-second `AbortController` timeout, preventing DNS failures (`ENOTFOUND`) from blocking the pipeline for 10+ seconds.
  - **Distributed Circuit Breaker**: After 3 consecutive Supabase failures, the circuit opens for a 30-second cooldown period. The failure state is pushed asynchronously to Redis (`voxera:cb:consecutive_failures`) and broadcasted via Pub/Sub, updating the local cache of all distributed instances instantly without incurring network penalty on read.
  - **Graceful Degradation**: When the circuit is open, the orchestrator continues to function using in-memory STM data and the local lexicon-based emotion engine. Logging is silently skipped. The system self-heals when connectivity is restored.
* **Files & Directories**:
  - [supabase.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/db/supabase.ts) — Timeout fetch wrapper, circuit breaker state, and health check API.

### 4.10 Acoustic Feature Extraction & Voice Intelligence
* **Purpose**: Extracts physical acoustic properties from raw PCM audio to power real emotion analysis, CAI scoring, and barge-in detection.
* **Implementation Logic**:
  - Operates on 8kHz mono linear16 PCM buffers accumulated during each caller speech turn.
  - **RMS Energy**: Root-mean-square amplitude via `Buffer.readInt16LE()`. Used for barge-in energy thresholds (prevents false interrupts from noise) and vocal intensity.
  - **Zero-Crossing Rate (ZCR)**: Counts sign changes per 20ms frame. Discriminates voiced/unvoiced speech.
  - **Pitch Estimation**: Autocorrelation on windowed PCM frames to estimate F0 in Hz. Returns median pitch and coefficient of variation (pitch dynamics).
  - **Speaking Rate**: Words-per-minute from transcript word count and audio duration.
  - **Pause Detection**: Scans for contiguous silence regions (RMS below threshold for >300ms). Returns pause count and total pause duration.
  - All computations are pure JavaScript — no FFT libraries, no native bindings, no external dependencies.
* **Files & Directories**:
  - [acoustic.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/audio/acoustic.ts) — Pure-JS DSP feature extractor.

### 4.11 Input Guardrails & AI Safety
* **Purpose**: Pre-LLM defense layer that detects and blocks prompt injection and jailbreak attempts in voice transcripts before they reach the AI orchestrator.
* **Implementation Logic**:
  - **Multi-Pattern Detection**: 12+ regex patterns covering role-assumption attacks ("ignore previous instructions"), system prompt extraction ("reveal your system prompt"), delimiter injection (`<<<SYSTEM>>>`), DAN/jailbreak tropes, encoding evasion, and hypothetical framing.
  - **Weighted Scoring**: Each pattern contributes a calibrated weight (0.5–0.9) to a composite threat score. Inputs scoring ≥0.6 are blocked.
  - **Safe Deflection**: Blocked inputs receive natural-sounding voice-appropriate responses (randomized from 5 templates) without ever reaching the LLM.
  - **Defense-in-Depth**: This pre-LLM guard complements the existing post-LLM `guardOutput()` filter. The two layers operate independently.
* **Files & Directories**:
  - [input-guard.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/agent/input-guard.ts) — Pattern matching, scoring, and deflection engine.

---

## 5. Database Schema

Here are the primary multi-tenant database tables used in the production environment:

### 5.1 `knowledge_documents`
Tracks administrative file uploads:
```sql
CREATE TABLE public.knowledge_documents (
  id text PRIMARY KEY,
  "clientId" text NOT NULL,
  filename text NOT NULL,
  "mimeType" text NOT NULL,
  status text NOT NULL DEFAULT 'processing', -- 'processing' | 'ready' | 'failed' | 'superseded'
  "chunkCount" integer DEFAULT 0,
  "errorMessage" text,
  version integer DEFAULT 1,
  "createdAt" bigint NOT NULL
);
```

### 5.2 `memories`
Stores 1536-dimensional vector embedding chunks:
```sql
CREATE TABLE public.memories (
  id text PRIMARY KEY,
  tier text NOT NULL,
  "userId" text,
  "clientId" text NOT NULL,
  ts bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  text text NOT NULL,
  summary text NOT NULL DEFAULT '',
  entities text[] NOT NULL DEFAULT '{}',
  topic text NOT NULL DEFAULT 'general',
  emotion text NOT NULL DEFAULT 'neutral',
  vad_v real NOT NULL DEFAULT 0,
  vad_a real NOT NULL DEFAULT 0,
  vad_d real NOT NULL DEFAULT 0,
  intensity real NOT NULL DEFAULT 0,
  importance real NOT NULL DEFAULT 0.5,
  importance_score real NOT NULL DEFAULT 0.5,
  retrieval_count integer NOT NULL DEFAULT 0,
  last_retrieved_at bigint,
  embedding vector(1536),
  "sourceUtteranceIds" text[] NOT NULL DEFAULT '{}',
  recurrence integer NOT NULL DEFAULT 1,
  resolved boolean NOT NULL DEFAULT false,
  ttl bigint
);
```

### 5.2.1 Adaptive Memory Ranking & Explainability Pipeline
The Memory & RAG subsystem employs an adaptive memory ranking, decay, explainability, and chronological event grouping pipeline:
1. **Dynamic Scoring & Re-ranking:** Re-ranking uses pgvector similarity coupled with custom metrics.
2. **Adaptive Score Decay:** Static memory importance score (`importance_score`) decays over time with a **7-day half-life** since last retrieval or write activity to prevent obsolete data from cluttering agent context.
3. **Preservation Floors for Critical Facts:** Key facts (LTM user/client memories, or records containing critical keywords like allergies, preferences, language, vip, payment, compliance) have a preservation floor of `0.70`, ensuring they never decay below this point and are consistently prioritized.
4. **Retrieval Usage Boost:** Whenever a memory is selected in the retrieval results, its `retrieval_count` is incremented, and its `importance_score` gets a logarithmic boost: `importance_score = min(decayed_importance + 0.05 * ln(1 + retrieval_count), 1.0)`.
5. **Selection Explainability:** Every retrieval result maps the exact relevance score components (semantic similarity, dynamic importance, recency, emotion match, staleness) to produce a detailed natural language explanation for administrators.
6. **Chronological Timeline Grouping:** Retrieved memories are grouped into events using proximity (within 48 hours) and topic sharing, providing a sequential narrative to the LLM.

### 5.3 `reservations`
Manages customer bookings:
```sql
CREATE TABLE public.reservations (
  id text PRIMARY KEY,
  "clientId" text NOT NULL,
  date text NOT NULL, -- YYYY-MM-DD
  time text NOT NULL, -- HH:MM
  status text NOT NULL DEFAULT 'confirmed', -- 'confirmed' | 'cancelled'
  "customerName" text,
  "customerEmail" text,
  "customerPhone" text,
  "calendarEventId" text,
  "createdAt" bigint NOT NULL
);
```

### 5.4 `call_logs`
Tracks telephony call metrics:
```sql
CREATE TABLE public.call_logs (
  id text PRIMARY KEY, -- Twilio CallSid
  "clientId" text NOT NULL,
  "callerNumber" text,
  status text NOT NULL DEFAULT 'active', -- 'active' | 'completed' | 'failed' | 'queued'
  "startedAt" bigint NOT NULL,
  "endedAt" bigint,
  "durationMs" bigint,
  "sessionId" text,
  "queueWaitMs" bigint DEFAULT 0
);
```

---

## 6. Important Design Decisions

1. **Flattened Vector Database Schema**: Swapped dynamic metadata JSONB blobs for explicit columns (`vad_v`, `intensity`, etc.) to prevent runtime type exceptions, simplify indexing, and accelerate mathematical scoring matches in Postgres.
2. **Postgres advisory locks (`pg_advisory_xact_lock`)**: Implemented transactional advisory locks during slot allocation, securing appointments against race conditions without relying on heavy external queue engines.
3. **No Third-Party Charting Packages**: Programmed raw SVGs and Tailwind layouts for heatmaps and analytics dials to avoid runtime canvas issues, improve loading speed, and ensure layout responsiveness.
4. **Native Local Development execution**: The environment runs using `npm run dev` and `npm run server` locally while using external managed services (Supabase, Groq, Deepgram), minimizing local computing overhead.
5. **Fire-and-Forget Observability**: Session event logging is treated as non-critical telemetry that should never block the user-facing response path. All log writes are dispatched without `await` and protected by a circuit breaker, ensuring the system remains responsive even during complete database outages.
6. **Context-Aware Punctuation Detection**: Punctuation cues (`!!`, `???`, ALL CAPS) amplify arousal in the direction of the already-detected valence rather than forcing a fixed label. This prevents false negatives where enthusiastic positive messages are misclassified as frustration.
7. **Supabase Circuit Breaker**: A threshold-based circuit breaker (3 failures → 30s cooldown) prevents the cascading timeout pattern where N sequential failed database calls each block for ~3-5 seconds, compounding to 30+ second response times.

---

## 7. Current Limitations

* **Lexicon-Based Emotion Detection**: The text emotion classifier uses a keyword lexicon rather than a trained ML model (e.g., RoBERTa). While the lexicon now covers 35+ patterns across 11 labels, edge cases involving sarcasm, irony, or highly ambiguous language may still be misclassified. The architecture is designed for drop-in replacement with a real model via the `detectTextEmotion` signature.
* **Pitch Estimation Accuracy**: The autocorrelation-based pitch estimator works well for clean speech but may produce inaccurate results in very noisy telephony environments. A Wav2Vec2/HuBERT-based feature extractor would improve robustness.

---

## 8. Changelog

### 2026-07-02 — CI Lint & TypeScript Build Fix

**Problems Discovered:**
1. **ESLint `no-require-imports` errors** in two compiled JavaScript files (`lib/emotion/detect.js` and `test-stress-runner.js`) used CommonJS `require()` syntax, which is forbidden by the `@typescript-eslint/no-require-imports` rule enforced in CI.
2. **TypeScript build error** in `scripts/test-emotion.ts` at line 44: `result.confidenceCategory` is declared as optional (`?`) in the `EmotionSignal` interface, but was accessed without a null check, causing `TS2532: Object is possibly 'undefined'`.
3. **React Hook warnings** in `app/admin/knowledge/page.tsx` (lines 73 and 98): two `useEffect` hooks referenced `fetchDocuments` without listing it as a dependency, triggering `react-hooks/exhaustive-deps` warnings.

**Root Causes:**
1. The `.js` files were TypeScript compiler outputs that retained CommonJS module syntax (`require()`, `module.exports`). The ESLint configuration does not ignore `.js` files (only `.next/`, `out/`, `build/`), so these compiled outputs were linted alongside source code.
2. The `EmotionSignal.confidenceCategory` field is typed as `ConfidenceCategory | undefined` (optional with `?`). While `detectTextEmotion()` always populates this field, TypeScript's strict mode correctly flags the access as unsafe since the type allows `undefined`.
3. The `fetchDocuments` async function was defined as a plain closure inside the component body, creating a new reference on every render but not tracked by `useEffect` dependency arrays.

**Files Modified:**
- [detect.js](file:///Users/hardikkadd/Desktop/Projects/VOXERA/lib/emotion/detect.js) — Converted CommonJS `require()` to ES module `import` declarations; replaced `Object.defineProperty(exports, ...)` with `export` function declarations.
- [test-stress-runner.js](file:///Users/hardikkadd/Desktop/Projects/VOXERA/test-stress-runner.js) — Converted CommonJS `require()` and `__importDefault` wrapper to ES module `import`; updated internal call-site references from compiled patterns (`detect_1.detectTextEmotion`) to direct names.
- [test-emotion.ts](file:///Users/hardikkadd/Desktop/Projects/VOXERA/scripts/test-emotion.ts) — Added optional chaining (`?.`) with nullish coalescing (`?? "unknown"`) for the `confidenceCategory.level` access.
- [page.tsx](file:///Users/hardikkadd/Desktop/Projects/VOXERA/app/admin/knowledge/page.tsx) — Wrapped `fetchDocuments` in `useCallback` with `[currentPage, searchQuery]` dependencies; added `fetchDocuments` to both `useEffect` dependency arrays.

**Implementation Approach:**
- All fixes preserve existing runtime behaviour. No ESLint rules were disabled, no TypeScript strict checks were suppressed, and no `as any` casts were introduced.
- The ES module conversions in `.js` files maintain the same public API surface (`detectTextEmotion`, `detectAudioEmotionStub`, `fuseEmotion` exports).
- The TypeScript fix uses `?.` + `??` to safely degrade to `"unknown"` if `confidenceCategory` is ever `undefined`, matching the defensive coding style used elsewhere in the codebase.

**Validation Performed:**
- `npm run lint` → **0 errors, 0 warnings** (all lint errors and the `useEffect` dependency warnings resolved).
- `npm run build` → **Build succeeded** (TypeScript type checking passed, all 15 static pages generated, production bundle optimized).

**Final Outcome:**
All CI-blocking errors are resolved. The existing Pull Request on `feature/improve-emotion-analysis` is now ready to merge.

### 2026-07-09 — Voice Cloning & Security Hardening (Issues #16 & #12)

**Features Implemented:**
1. **Custom Voice Cloning (Issue #16)**: Integrated ElevenLabs TTS engine, allowing tenants to configure custom voice personas.
2. **Automated Recovery SMS (Issue #16)**: Added logic to `TelephonyStreamHandler` to detect negative ending sentiments (anger, frustration) and trigger an automated SMS recovery workflow to the caller via configured templates.
3. **Database Security & RLS (Issue #12)**: Implemented Row-Level Security (RLS) across `session_logs`, `reservations`, `memories`, `knowledge_documents`, and `call_logs`. Refactored backend routes to use `auth.uid()` rather than bypassing security via `SERVICE_ROLE_KEY`.
4. **Credential Encryption (Issue #12)**: Developed an AES-256-GCM encryption utility (`lib/util/crypto.ts`) and a new `tenant_credentials` table. Google Calendar private keys are now securely encrypted at rest.
5. **Compound Indexing (Issue #12)**: Added crucial compound indices via `migration_v8.sql` for analytical dashboards (`idx_session_logs_client_ts`, `idx_reservations_client_slot`), ensuring O(log N) scale performance.

### 2026-07-10 — Distributed Architecture & Redis Scaling (Issue #13)

**Features Implemented:**
1. **Redis Infrastructure**: Integrated `ioredis` with an in-memory `MockRedis` fallback to keep local dev environments stable without requiring a Docker container.
2. **Distributed Queue Manager**: Rebuilt the `CallQueueManager` using Redis Sorted Sets (`zadd`) to guarantee FIFO ordering within priority bands. Wait times and queue positions are now shared across all horizontal nodes.
3. **Pub/Sub Synchronization**: Real-time slot availability is broadcast via Redis Pub/Sub (`voxera:slot_available`), triggering all scale-out instances simultaneously.
4. **Distributed Circuit Breaker**: Supabase database failures are written to Redis asynchronously and broadcasted via Pub/Sub, updating the local fast-cache of all instances immediately.

**Final Outcome:**
VOXERA is now capable of horizontal scaling. Critical telephony queues and state management are centralized in Redis, solving all single-node limitations.

### 2026-07-10 — Advanced Voice Intelligence & Telephony Experience (Issue #14)

**Features Implemented:**
1. **Acoustic Feature Extraction**: New pure-JS DSP module (`lib/audio/acoustic.ts`) that extracts RMS energy, zero-crossing rate, pitch (autocorrelation), speaking rate, and pause patterns from raw 8kHz PCM audio — zero external dependencies.
2. **Energy-Based Barge-In**: Upgraded `TelephonyStreamHandler` to compute RMS energy on incoming audio. TTS playback only stops when caller audio exceeds the configurable energy threshold (`CONFIG.telephony.bargeInEnergyThreshold`), eliminating false barge-ins from background noise.
3. **Acoustic Emotion Analysis**: New `detectAudioEmotion()` in `lib/emotion/audio-emotion.ts` maps physical acoustic features to EmotionSignal (pitch→arousal, energy→intensity, rate→valence). Replaces the previous null-returning stub.
4. **Text+Audio Emotion Fusion**: The existing `fuseEmotion()` now receives real audio emotion signals, enabling confidence-weighted VAD fusion between text and acoustic channels.
5. **Real CAI Metrics**: The orchestrator passes actual pitch variation, speaking rate, barge-in count, and pause duration to `calculateCAI()` instead of heuristic placeholders.
6. **Prompt Injection Guardrail**: New `guardInput()` in `lib/agent/input-guard.ts` runs before the LLM. Detects 12+ jailbreak/injection pattern families (role assumption, prompt extraction, delimiter injection, DAN mode, etc.) with weighted scoring and natural voice deflections.

**Files Created:**
- `lib/audio/acoustic.ts` — PCM acoustic feature extraction
- `lib/emotion/audio-emotion.ts` — Acoustic-to-emotion mapper
- `lib/agent/input-guard.ts` — Pre-LLM prompt injection guardrail
- `__tests__/e2e/voice-intelligence.test.ts` — 31 integration tests

**Files Modified:**
- `lib/telephony/stream-handler.ts` — Energy barge-in, PCM accumulation, interruption tracking
- `lib/agent/orchestrator.ts` — Input guard, acoustic emotion, real CAI metrics
- `lib/emotion/detect.ts` — Removed audio emotion stub
- `lib/types.ts` — Added AcousticFeatures interface
- `lib/config.ts` — Energy thresholds
- `lib/logging/session-logger.ts` — New event types (input_guard, acoustic)

**Validation Performed:**
- `npx vitest run` → **184 tests passed, 0 failures** across 16 test files
- `npm run lint` → **0 errors, 0 warnings**
- `npm run build` → **Build succeeded** (TypeScript type checking passed, all pages generated)

---

### Sprint 5 (Issue #15: SaaS Commercialization)
**Objective**: Transform VOXERA from a single-tenant demo into a production-ready SaaS platform with self-service onboarding, subscription billing, and tenant management.

**Changes Implemented**:
1. **Stripe Billing Integration**: 
   - Created Stripe SDK wrapper (`lib/billing/stripe.ts`) defining Starter, Growth, and Enterprise tiers.
   - Built checkout API route and webhook handler for `checkout.session.completed`, `customer.subscription.updated`, and `deleted` events.
   - Designed a new `subscriptions` table (Migration v10) with RLS for multi-tenant isolation.
2. **Onboarding Wizard Upgrade**: 
   - Added Step 3: Choose Plan to `app/onboarding/planner.tsx`.
   - Updated `lib/db/onboarding.ts` to properly save business hours and AI settings (`language`, `tone`, `greeting`) into `business_settings`.
   - Automatically redirect tenants to Stripe Checkout if they choose a paid tier.
3. **Admin Tenant Dashboard**: 
   - Built a Super-Admin panel (`/admin/tenants`) summarizing tenant creation, subscription status, call volume, and knowledge document metrics.

**Files Created**:
- `lib/billing/stripe.ts` — Stripe tier logic and limits
- `app/api/billing/checkout/route.ts` — Stripe Checkout endpoint
- `app/api/billing/webhook/route.ts` — Stripe webhook handler
- `app/admin/tenants/page.tsx` — Admin tenant management dashboard
- `__tests__/e2e/saas-commercialization.test.ts` — Integration tests for Stripe & billing
- `sql/migration_v10.sql` — Subscriptions schema and RLS

**Files Modified**:
- `lib/db/onboarding.ts` — Added logic to save AI settings and operating hours
- `app/onboarding/planner.tsx` — Added pricing UI and redirection logic
- `app/admin/layout.tsx` — Added Tenants link to the sidebar
- `VOXERA_ROADMAP.md` — Updated Phase III completion status

**Validation Performed**:
- `npx vitest run` → **188 tests passed, 0 failures** across 17 test files
- `npm run lint` → **0 errors, 0 warnings**
- `npm run build` → **Build succeeded**

