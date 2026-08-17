# VOXERA Engineering Roadmap

This document outlines the remaining tasks, technical debt, security enhancements, and future SaaS milestones for the VOXERA platform.

---

## 0. ✅ Resolved — Live Database Schema Fix (was: Action Required)

The production Supabase `memories` table was missing 14 columns (`emotion`, `vad_v/a/d`, `topic`, `ts`,
`summary`, `entities`, `importance`, `sourceUtteranceIds`, `recurrence`, `resolved`, `ttl`) that
`lib/memory/store.ts` writes to on every memory/knowledge-base save. `sql/migration_consolidated.sql`'s
`CREATE TABLE IF NOT EXISTS public.memories` is a full no-op against an existing table, and its old
patch section only backfilled 4 of these 14 columns — so every single vector-store write had been
silently failing since the DB predated the consolidated migration (`vectorStore.put()` logs the error
to console but never throws, so callers believed the write succeeded). This affected **all**
memory/emotion persistence and the knowledge-base RAG pipeline, not just the new file-format work
below.

**Fixed on 2026-08-17**: connected directly to the production Postgres instance (via the Supabase
Supavisor transaction pooler — the direct-connection host is IPv6-only and didn't resolve from this
environment) and ran the corrected `ADD COLUMN IF NOT EXISTS` patch. Verified before/after via
`information_schema.columns`: all 14 columns now present. Re-ran a full `ingestDocument()` →
`queryKnowledgeBase()` round trip against production immediately after — no more
`[VectorStore] Put Error]`, and the retrieved chunk matched what was written. Test rows cleaned up
afterward. `sql/migration_consolidated.sql` now has the complete column list for any future
environment (staging, a fresh clone) that needs the same patch applied. See the 2026-08-17 entry in
`VOXERA_IMPLEMENTATION.md` for how this was found and fixed.

---

## 1. Executive Summary

VOXERA has a robust core foundation: real-time telephony streaming, custom WebSockets, dynamic emotion adaptation prompt coaching, Supabase vector databases, transactional booking safety, and custom lightweight SVG dashboard reporting. 

Recent engineering work has hardened the emotion engine (expanded from 9 to 11 labels with 35+ lexicon entries and context-aware detection, plus fixes for a real acoustic "sadness bias" and a text-lexicon negation blindness bug), introduced a Supabase circuit breaker and timeout layer to prevent cascading failures, and parallelized the AI orchestrator pipeline to eliminate ~25 seconds of unnecessary latency.

The most recent phase delivered the multi-agent template builder this document previously listed only as a future milestone: accounts can now create multiple named voice agents, each with its own system prompt (written manually or AI-drafted from a description), greeting, and voice, storable and independently testable/callable — plus a resilient LLM routing layer (ZenMux primary, existing Groq key-rotation as automatic fallback) and a simplified onboarding flow that creates a real agent instead of a disconnected business-profile form.

The next phases of development will transition the codebase from a highly complete MVP into a hardened, secure, and commercially scalable SaaS platform. Near-term work focuses on security hardening (RLS, token encryption) and replacing audio heuristics with physical acoustic DSP metrics. Medium and long-term milestones describe billing re-integration into the new agent-creation flow, per-agent knowledge base isolation, and further explainability tooling for evaluators.

---

## 2. Current Project Completion

* **Core MVP Feature Set**: **94%**
* **Multi-Agent Builder Platform**: **90%**
* **SaaS Infrastructure & Billing**: **5%** (unchanged — billing was deliberately decoupled from the new onboarding flow, see §4.6)
* **Overall Platform Readiness**: **72%**

---
### Reliability & Production Hardening — Completed

The latest reliability hardening pass completed five production-facing fixes:

- **BUG-D1/D2:** Supabase circuit-breaker and timeout resilience.
- **BUG-D3:** Safe booking confirmation handling when customer email is unavailable.
- **BUG-E4:** More precise emotion detection for waiting/frustration language.
- **BUG-M1:** Safe persistence of missing or partially populated VAD values.
- **BUG-O4:** Graceful handling of empty or malformed LLM provider responses with fallback support.

All five fixes include targeted regression coverage.

---
## 3. Module Status Dashboard

| Module | Status | Priority | Completion | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Multi-Tenant Isolation** | 🟢 Complete | High | 100% | RLS policies implemented using auth.uid(). |
| **Telephony & WebSockets** | 🟢 Complete | Medium | 100% | Queue is now backed by Redis sorted sets; fully scaled via Pub/Sub. |
| **Speech Emotion (SER)** | 🟢 Complete (Phase 2) | Medium | 100% | Concurrent HF+Lexicon architecture, scored acoustic inference (crying/laughter detection), and full diagnostic instrumentation (per-engine comparison, diagnostic CLI) all verified. Local ONNX engine added (diagnostic-only). Fixed a real acoustic "sadness bias" and added a genuine "calm" label bucket (12 labels total) so steady/unhurried speech is actively recognized instead of defaulting to neutral. Fusion (`fuseEmotion()`) is now weighted multi-class — text-heavy 70/30 when text confidence >0.7, acoustic-heavy 40/60 otherwise — not just a flat confidence-margin pick. |
| **Memory (Vector Store)** | 🟢 Complete | High | 100% | Circuit breaker, compound indexes, and adaptive importance decay with chronological explainability. |
| **Knowledge Base (RAG)** | 🟢 Complete | High | 95% | Cascading deletion, status polling, and version superseding are stable. Now accepts TXT/PDF/Markdown/CSV/JSON/DOCX (was TXT/PDF only), with an inline upload/status tab in Agent Builder alongside the standalone `/admin/knowledge` manager. |
| **Booking & Integrations** | 🟢 Complete | High | 100% | Advisory locks, calendar JWT sync, and AES-256 credential encryption are stable. |
| **Analytics Dashboard** | 🟢 Complete | Low | 95% | Lightweight SVG graphs and tool invocation logging are fully integrated. |
| **Acoustic CAI Processing**| 🟢 Complete | Medium | 95% | Real DSP extraction (pitch, energy, ZCR, pauses) from PCM. Barge-in uses energy thresholds (raised to 800 RMS to reduce false triggers from background noise). Pause-detection noise floor is now actually configurable (was a dead config value shadowed by a hardcoded local constant). New manual sensitivity-calibration slider (-1..1) lets an operator counteract the engine's documented negative-read tendency in real time — a real scoring adjustment, not cosmetic. Live-testing its WS wiring surfaced and fixed a real pre-existing bug: `server.ts`'s message handler used `Buffer.isBuffer()` to distinguish audio from JSON control messages, but this `ws` version delivers both as Buffers — every client text message (ping, barge_in) had been silently misrouted into the audio path. A second, real pretrained acoustic model is now integrated alongside the DSP heuristic — `onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX` (emotion2vec+ has no ONNX export, confirmed via an open FunASR GitHub issue; an audeering VAD-native alternative was disqualified for being research-license-only). Diagnostic-only, shown side by side in the live analysis panel as "Acoustic (Heuristic)" vs "Acoustic (Wav2Vec2)" — not wired into production fusion yet, pending accuracy validation against real telephony-quality audio. Wired for the browser-mic "Live Test Call" path only; telephony (8kHz mulaw) doesn't populate it. |
| **AI Orchestrator** | ✅ Stable | High | 95% | Parallelized pipeline, fire-and-forget logging. Latency reduced from ~29s to ~3-5s. LLM calls route through a provider fallback chain — ZenMux (primary) → Groq (key-rotated) → OpenAI — via one ordered config array, no per-provider code paths. |
| **Supabase Resilience** | 🟢 Complete | High | 100% | Circuit breaker, timeout fetch, graceful degradation. |
| **Multi-Agent Builder** | 🟢 Complete | High | 90% | Accounts can create multiple named agents (`/admin/agents`), each with its own system prompt (manual or AI-drafted), greeting, and voice — stored, individually testable in the live drawer, and callable. Custom prompts are real-injected into the LLM context, layered on top of (never overriding) core safety/escalation rules. The AI-generate flow now accepts attached files (pricing sheets, FAQs, policy docs) — they're ingested into the account's knowledge base *and* their extracted text grounds the drafted prompt in real specifics rather than generic language. Gap: all agents under one account still share one knowledge base — see §4.6. |
| **Voice Agent Onboarding** | 🟢 Complete | Medium | 100% | Simplified to a 4-step flow (describe → write/AI-generate prompt → optional file upload → create) that creates a real agent, replacing a prior wizard that wrote to a disconnected business-profile form. Billing step deliberately removed — see §4.6. Live testing surfaced and fixed a session-persistence bug (middleware only refreshed auth on 2 of the app's routes) and a `pdf-parse` v1→v2 API break causing every PDF knowledge upload to 500 — see the 2026-08-17 entries in `VOXERA_IMPLEMENTATION.md`. |
| **SaaS Builder & Billing**| 🟡 Partial | High | 70% | Stripe subscription checkout/webhook routes exist and are wired to the `subscriptions` table, but are no longer invoked from onboarding after its redesign — re-integration (e.g. gating agent count by plan) is not yet built. |

---

## 4. Subsystem Roadmap & Technical Details

### 4.1 Multi-Tenant Data Hardening
* **Current State**: Fully hardened. Row Level Security (RLS) policies enforce `auth.uid()::text = "clientId"` across all primary tables (`session_logs`, `reservations`, `memories`, `knowledge_documents`, `call_logs`).
* **Roadmap Priority**: **Completed (Issue #12)**

### 4.2 Database Performance & Compound Indexing
* **Current State**: Compound indices successfully deployed via migration `v8` (`session_logs("clientId", ts desc)` and `reservations("clientId", date, time, status)`).
* **Roadmap Priority**: **Completed (Issue #12)**

### 4.3 Real Acoustic Digital Signal Processing (DSP) for CAI
* **Current State**: **Completed (Issue #14, #28)**. The Commitment Acoustic Index (CAI) and acoustic emotion analysis use real DSP extraction — pitch (Hz, via autocorrelation), energy, ZCR, energy modulation rate, pitch contour, speaking rate, and pause patterns — computed directly from PCM frames, not VAD-activation approximations. Multi-feature scored inference (not rigid thresholds) drives label selection, including crying/laughter discrimination. Real-time interruption detection (barge-in) is implemented via energy thresholds.
* **Roadmap Priority**: **Completed**

### 4.4 Distributed Queue Routing for Telephony
* **Current State**: The call queue manager (`lib/queue/manager.ts`) holds active calls in-process using an in-memory scheduler.
* **Known Problems**: If the Next.js backend scales to multiple server instances, the in-process scheduler cannot synchronize active calls, causing incorrect queue thresholds.
* **Future Features**:
  - Migrate call tracking states to a centralized Redis cluster or database queue table.
* **Estimated Complexity**: Medium
* **Expected Engineering Impact**: High scalability for simultaneous inbound caller groups.
* **Roadmap Priority**: **Medium-Term**

### 4.5 Credentials Encryption for Integrations
* **Current State**: Fully hardened. A secure database settings vault (`tenant_credentials`) stores tenant-specific Google Calendar keys. Private keys are encrypted via AES-256-GCM before writing to the database and decrypted only dynamically on context load.
* **Roadmap Priority**: **Completed (Issue #12)**

### 4.6 Self-Serve SaaS Builder & Stripe Billing
* **Current State**: The self-serve onboarding wizard (`/onboarding`) is built and creates a real
  agent: business description → write-or-AI-generate the system prompt → optional knowledge-base
  file upload → create. Stripe checkout/webhook routes and the `subscriptions` table exist and work
  in isolation, but the redesigned onboarding no longer calls into them — the
  prior wizard's plan-picker step was removed as part of simplifying onboarding down to "describe your
  agent and create it," and billing was not yet re-integrated into the new flow.
* **Future Features**:
  - **Billing re-integration**: gate agent count / knowledge-doc limits / call volume behind Stripe
    subscription tiers (Starter, Growth, Enterprise) from within Agent Builder or account settings,
    now that agent creation itself lives outside the old wizard.
  - **Per-agent knowledge base isolation**: today every agent under one account shares that account's
    entire `LTM_client` knowledge base (by `clientId`); scoping specific uploaded documents to
    specific agents is not yet built.
  - **Super-Admin Panel**: Global dashboard for platform maintainers to monitor system health, tenant
    limits, active integrations, and payment states.
* **Estimated Complexity**: Medium (billing re-integration) / High (per-agent knowledge isolation)
* **Expected Engineering Impact**: Enables commercial monetization of the platform.
* **Roadmap Priority**: **Long-Term**

### 4.7 Multi-Agent Builder & Prompt Injection
* **Current State**: **Completed.** An account can create multiple named agents (`agents` table,
  `sql/migration_v11.sql` added `description`/`system_prompt`/`greeting`/`voice_persona`), each with
  a real, custom system prompt — written manually or drafted by the platform's own LLM from a short
  description (`/api/onboarding/generate-prompt`). The prompt is genuinely injected into
  `buildLLMContext()` as its own block, additive to (never overriding) the platform's core rules and
  emotion-aware persona, so safety/escalation behavior can't be prompted away by an agent's creator.
  Any agent can be selected in the live test drawer or, once wired to a phone number, placed on a
  real call.
* **Known limitation**: shared knowledge base per account rather than per agent (see §4.6).
* **Roadmap Priority**: **Completed**

### 4.8a Voice Picker & Knowledge Upload Upgrade (Agent Builder)
* **Current State**: **Completed.** The Persona tab's voice picker replaced 4 fixed buttons with a
  searchable/filterable catalog of all 40 Deepgram Aura-2 voices (`lib/deepgram/voices.ts`, filter by
  gender/accent, free-text search over name/trait/accent) plus an inline play-to-preview button per
  voice (`/api/tts`). `lib/deepgram/tts.ts` now resolves `voice_persona` as either a direct Deepgram
  model id (`aura-2-*`) or one of the original 4 legacy keys, so no migration or new `agents` column
  was needed — `voice_persona` stays a free-form string. A new Knowledge tab in Agent Builder lets an
  account upload/list/delete knowledge documents inline (reusing the existing `/api/knowledge/upload`
  and `/api/knowledge/documents` routes) without leaving the agent editor. Supported file formats
  expanded from TXT/PDF only to TXT/PDF/Markdown/CSV/JSON/DOCX (`mammoth` added for DOCX extraction).
* **Known limitation carried forward**: knowledge is still shared per-account, not per-agent (§4.6).
* **Roadmap Priority**: **Completed**

### 4.8 LLM Provider Resilience
* **Current State**: **Completed.** LLM calls try ZenMux first, then fall back automatically to the
  existing Groq key-rotation setup, then OpenAI — one ordered array in `CONFIG.llm.providers`
  (`lib/config.ts`), no duplicate call paths. `KeyRotator` (`lib/util/keys.ts`) is generic over any
  comma-separated env var, so every provider in the chain gets multi-key rotation, timeouts, and
  exponential backoff on 429/5xx for free.
* **Roadmap Priority**: **Completed**

---

## 5. Development Milestones

### 5.1 Phase I: Hardening (Weeks 1 - 2)
* [x] **Emotion Engine Overhaul**: Expanded from 9 to 11 labels (`excitement`, `disappointment`). Lexicon expanded from 12 to 35+ entries. Fixed `!!` → frustration misclassification bug. Added context-aware punctuation detection and positivity safety net.
* [x] **Supabase Resilience Layer**: Implemented 5-second timeout fetch wrapper, circuit breaker pattern (3 failures → 30s cooldown), and graceful degradation across all database operations.
* [x] **Orchestrator Latency Fix**: Converted all 8 `logSessionEvent()` calls from blocking `await` to fire-and-forget `void`. Parallelized independent DB fetches and memory operations. Reduced turn latency from ~29s to ~3-5s.
* [x] **CI Lint & TypeScript Build Fix** (2026-07-02): Resolved ESLint `no-require-imports` errors by converting compiled CommonJS `.js` files to ES module syntax. Fixed TypeScript strict-mode error in `scripts/test-emotion.ts` by adding safe optional chaining for the optional `confidenceCategory` field. Fixed React Hook `useEffect` dependency warnings in Knowledge Base admin page. All lint errors and build errors eliminated.
* [x] Enable Row Level Security (RLS) on all Supabase tables and verify policies. (Issue #12)
* [x] Create compound indexes for analytical time-series logs. (Issue #12)
* [x] Encrypt Google Service Account tokens in database-backed tenant configurations. (Issue #12)
* [ ] Standardize local font assets to remove remote Google Web Fonts dependencies from build chains.

### 5.2 Phase II: Voice & Scaling (Weeks 3 - 5)
* [x] Integrate real audio packet DSP parser to calculate physical pitch variation and vocal intensity. (Issue #14)
* [x] Implement Redis-backed distributed telephony queues to support multi-node hosting. (Issue #13)
* [x] Implement interruption triggers to halt agent TTS output immediately if user speech is detected. (Issue #14)
* [x] Externalize circuit breaker state to Redis for multi-node deployments. (Issue #13)
* [x] Implement adaptive memory importance scoring, time-decay, and retrieval explainability. (Issue #9/17)
* [x] Integrate a trained ML emotion model (HuggingFace DistilRoBERTa) alongside the lexicon via a concurrent `detectTextEmotion()` router (`detectTextEmotionHF` + `detectTextEmotionLexicon`), with confidence-aware fusion. (Issue #26/#29)
* [x] **Emotion Engine Phase 1 — Diagnostics & Acoustic Upgrade**: Per-engine diagnostic comparison (HF/Lexicon/Local-ONNX/Acoustic) with diagnostic CLI; scored multi-feature acoustic inference with crying/laughter detection; new local ONNX emotion engine (diagnostic-only). (Issues #26–#31)
* [x] **Live-testing bug fixes from real voice calls**: fixed the acoustic engine's "sadness bias" (calm/neutral/positive speech defaulting to sadness), a text-lexicon negation-blindness bug ("not feeling good" scoring as joy), a small-talk misclassification ("How are you?" reading as confusion), and the agent replying before the caller finished a sentence (Deepgram `endpointing` was unset, using an overly short default).
* [x] **Root-caused and fixed a leaking support-ticket escalation phrase** ("connect you with a senior specialist") that survived multiple prompt-level fixes — the actual source was a separate output-guard layer (`guardOutput()`) re-injecting it after the LLM/persona layer had already been fixed.
* [x] **Six judge/evaluator-facing demo features**: engine-disagreement callout, scrubbable per-turn reasoning trace, visible retrieved-memory content, real per-stage pipeline latency, one-click scripted test scenarios, and a live session scorecard.
* [x] **Emotion Engine Phase 2 — Weighted Fusion, Calm Bucket, Dashboard Split**: `fuseEmotion()` upgraded from a flat confidence-margin pick to weighted multi-class fusion (text-heavy 70/30 above 0.7 text confidence, acoustic-heavy 40/60 below); added a 12th label (`calm`) with real competing acoustic scoring so steady/unhurried speech is actively recognized rather than defaulting to neutral; further VAD/barge-in calibration (endpointing 500→900ms, barge-in threshold 500→800 RMS) after live testing still showed occasional cut-offs; fixed a dead noise-floor config value that a hardcoded local constant was silently shadowing; split the diagnostic dashboard into separate Text/Acoustic engine divisions and exposed the acoustic engine's raw DSP metrics (pitch, energy/dB, ZCR, rate) instead of just its mapped label.

### 5.3 Phase III: SaaS Portal (Weeks 6 - 10)
* [x] Build Stripe subscription hooks and checkout routes.
* [x] Develop the admin onboarding registration wizard. *(Superseded — see below: redesigned into a simpler agent-creation flow that no longer includes the billing step.)*
* [x] **Multi-Agent Builder**: accounts can create multiple named voice agents, each with its own system prompt (manual or AI-generated), greeting, and voice — storable, individually testable, and callable.
* [x] **Onboarding redesign**: replaced the disconnected business-profile wizard with a 4-step flow (describe → write/AI-generate prompt → optional knowledge upload → create) that creates a real agent via the Multi-Agent Builder.
* [x] **LLM provider resilience**: ZenMux added as the primary LLM provider ahead of the existing Groq key-rotation fallback, one ordered config array, no duplicate call paths.
* [ ] Re-integrate Stripe billing into the redesigned onboarding/Agent Builder flow (plan-gated agent count, knowledge-doc limits).
* [ ] Implement Super-Admin usage and monitoring panels.

### 5.4 Phase IV: Production & AWS Deployment (Weeks 11+)
* [ ] Finalize AWS hosting architecture (ECS / EC2).
* [ ] Setup CI/CD pipelines (GitHub Actions) for automatic deployment.
* [ ] Productionize RDS and ElastiCache connections.
