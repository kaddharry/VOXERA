# VOXERA Test Results & Validation Log

This document records the exact test suites, validation steps, and outcomes for all major Epic Pull Requests. It serves as a historical source of truth for AI agents (and human engineers) to easily verify the stability of merged features.

---

## 2026-08-18 — Issue #TBD: Custom Node Server for Twilio WebSocket Upgrades (PR #TBD)
**Status:** ✅ VERIFIED
**Key Technologies:** Node `http.Server` `upgrade` event, `ws` (`noServer` mode), Next.js custom server (`getRequestHandler`), `tsx`, Docker

**Validation Steps:**
1. **Root Cause Confirmed:** `app/api/telephony/stream/route.ts` reached for the raw Node socket via `(req as any).socket ?? (req as any)._socket`. `NextRequest` extends the Web `Request` and carries no Node socket in any runtime, so the guard always fell through and returned **426 on every call** — `TelephonyStreamHandler` was never constructed and Twilio Media Streams could never connect. Returning `new Response(null, { status: 101 })` performs no handshake either.
2. **Custom Server Owns the Listener:** Added `server/index.ts`, which creates the `http.Server`, routes all traffic through Next's `getRequestHandler()`, and handles `upgrade` on `/api/telephony/stream` via a `noServer` `WebSocketServer`. Query-param names and the `"demo"` fallback match the `wss://` URL already built at `app/api/telephony/incoming/route.ts:87`, so no TwiML change was required.
3. **Live Upgrade Handshake:** Against the production server, a `ws://` client on `/api/telephony/stream?callSid=TEST1&…` reached **`OPEN — upgrade accepted`**, with `[TelephonyStream] upgrade accepted: callSid=TEST1` logged and `TelephonyStreamHandler` constructed. It then progressed as far as `DEEPGRAM_API_KEY is not set` — the external-service boundary — proving the audio path is reachable. This is the exact request that returns 426 on `main`.
4. **Wrong-Path Rejection:** An upgrade to `/api/nope` was destroyed immediately (`socket hang up`, close 1006) rather than left hanging.
5. **HTTP Unaffected:** `GET /` returned 200 and `POST /api/telephony/incoming` returned 200 (TwiML) through the custom server, confirming Next request handling is intact.
6. **Env Load Ordering:** `lib/redis/client.ts:117` and `lib/db/supabase.ts:139` read `process.env` at module load, and Next only loads env during `app.prepare()`. Added `server/env.ts`, imported first, so `.env.local` is applied before any `lib/*` module initialises — otherwise a local production run silently falls back to placeholder Supabase credentials and `MockRedis`. Verified as a no-op in containers (dotenv never overwrites existing values).
7. **Standalone Output Removed:** `output: "standalone"` was deleted from `next.config.ts`. Inspection of the prior build showed `.next/standalone/node_modules` contained only `next` and `ioredis` — `ws`, `@deepgram/sdk`, `@supabase/*`, `twilio`, `nanoid`, and `openai` were all pruned by output tracing because Next bundles them for its own routes. A custom server needs them as resolvable modules, so the Dockerfile now ships `.next` plus a full `node_modules`.
8. **Lockfile Sync:** `tsx` moved from `devDependencies` to `dependencies`; `npm install --package-lock-only` was run so `package-lock.json` matches. Without this, `npm ci` in the Docker build fails hard on the mismatch.
9. **Call-Slot Leak Fixed (`TelephonyStreamHandler`):** `init()` called `callQueue.markCallStarted()` before awaiting `deepgram.connect()`, and only registered the ws `"close"`/`"error"` listeners *after* it. A rejected `connect()` therefore incremented `voxera:active_calls` with no path left to `onCallEnded()`, permanently leaking a concurrency slot — ten failures wedged the system at `MAX_CONCURRENT_CALLS` and every subsequent call was rejected. The constructor now catches, and `onInitFailed()` releases the slot (guarded by a `slotTaken` flag so a failure *before* the increment cannot release a slot it never took), closes Deepgram, marks the call `failed`, and closes the socket with 1011.
10. **Regression Cover Proven:** The new suite was run against the pre-fix code at HEAD — **4 of 6 tests failed** (slot release, unhandled rejection, `failed` status + socket close, and the ten-consecutive-failures budget check). All 6 pass against the fix. `onCallEnded()` also gained a `hasEnded` idempotence guard, since cleanup is now reachable from three paths.

**E2E Test Execution:**
- `npx vitest run __tests__/telephony/stream-handler-init.test.ts` → **6 tests passed, 0 failures** (4 of them verified failing against pre-fix HEAD)
- `npx vitest run __tests__/telephony/` → **57 tests passed, 0 failures** across 5 files (confirms deleting the dead route broke nothing)
- `npx vitest run` → **190 tests passed, 0 failures** across 17 test files (no regressions)
- `npm run lint` → **0 errors, 0 warnings**
- `npm run build` → **Build succeeded** (TypeScript passed; `/api/telephony/stream` correctly absent from the route table)
- `npm run start:prod` + `ws` client probe → **upgrade accepted**; wrong-path probe → **immediate close**

---

## 2026-07-10 — Issue #14: Advanced Voice Intelligence & Telephony Experience (PR #TBD)
**Status:** ✅ VERIFIED
**Key Technologies:** Pure-JS DSP (PCM Buffer math), Autocorrelation Pitch Estimation, Pre-LLM Input Guard, Acoustic Emotion Fusion

**Validation Steps:**
1. **Acoustic Feature Extraction:** Verified `computeRmsEnergy()` returns exact RMS values for known constant-amplitude buffers. Confirmed `extractAcousticFeatures()` correctly computes speaking rate (WPM), detects pauses in silence-interleaved audio, and handles sub-frame (<10ms) edge cases gracefully.
2. **Energy-Based Barge-In:** Validated that loud speech PCM (amplitude 15000) exceeds the 500-RMS barge-in threshold while low-amplitude noise (~10) and moderate ambient noise (~200) stay below threshold. This prevents false TTS interruptions from background noise.
3. **Acoustic Emotion Analysis:** Confirmed `detectAudioEmotion()` correctly maps high-energy+high-pitch+fast-rate+high-variation to "excitement", low variation to "anger", low-energy+slow-rate to "sadness", and high-pause-ratio to "confusion". Verified confidence scales proportionally with audio duration (<2s = low, >5s = high).
4. **Text+Audio Emotion Fusion:** Verified `fuseEmotion()` produces `source: "fused"` output with confidence-weighted VAD blending when both text and audio signals are present. Confirmed text-only fallback when audio is null.
5. **Prompt Injection Guardrail:** Tested 12+ attack vectors: role assumption ("ignore previous instructions"), DAN mode, system prompt extraction, delimiter injection, role override, hypothetical bypass. All blocked with threatScore ≥0.6. Verified 6 normal customer queries pass through safely with no false positives.
6. **Full Pipeline Integration:** Confirmed `handleTurn()` with acoustic features uses real CAI metrics. Verified injection attempts short-circuit the LLM pipeline — `generateReply()` is never called and a safe deflection is returned.

**E2E Test Execution:**
- `npx vitest run __tests__/e2e/voice-intelligence.test.ts` → **31 tests passed, 0 failures** (21ms)
- `npx vitest run` → **184 tests passed, 0 failures** across 16 test files (no regressions)
- `npm run lint` → **0 errors, 0 warnings**
- `npm run build` → **Build succeeded** (TypeScript passed, all 12 static pages generated)

---

## 2026-07-10 — Issue #13: Distributed Architecture & Redis Telephony Scaling (PR #21)
**Status:** ✅ VERIFIED & MERGED
**Key Technologies:** `ioredis`, Distributed Pub/Sub, Sorted Sets

**Validation Steps:**
1. **Mock Fallback Resilience:** Validated the implementation of the `MockRedis` class ensuring local test suites pass instantly without requiring a live Redis Docker container.
2. **Distributed Queue Ordering:** Verified `CallQueueManager` logic using `redis.zadd` sorted sets. Ensured the computed priority score (`priority * 1e13 + joinedAt`) accurately enforces FIFO ordering across multiple independent node instances.
3. **Queue Synchronization:** Evaluated the Pub/Sub model. Verified that `redis.publish("voxera:slot_available", "1")` correctly triggers all horizontal nodes to pull callers out of Twilio queues simultaneously.
4. **Hybrid Circuit Breaker:** Tested the Supabase Circuit Breaker. Confirmed that failure increments are pushed asynchronously to Redis (`voxera:cb:consecutive_failures`) and broadcasted via pub/sub, while reads (`isSupabaseHealthy`) hit a synchronous local memory cache for sub-millisecond latency.

**E2E Test Execution:**
- Executed `__tests__/scaling/redis-scaling.test.ts`. 
- Verified that scaling tests pass locally using the decoupled `MockRedis` layer.

---

## 2026-07-09 — Issue #12: Core Database Security & Hardening (PR #20)
**Status:** ✅ VERIFIED & MERGED
**Key Technologies:** Row Level Security (RLS), AES-256-GCM, Compound Indexing

**Validation Steps:**
1. **Row Level Security Enforcement:** Verified `migration_v8.sql` policies correctly mapping `auth.uid()::text = "clientId"` on `session_logs`, `reservations`, `memories`, `knowledge_documents`, and `call_logs`.
2. **API Isolation:** Verified backend routes were refactored to consume the authenticated client JWT instead of bypassing security via `SERVICE_ROLE_KEY`.
3. **Credential Encryption:** Audited `lib/util/crypto.ts`. Confirmed Google Calendar keys are encrypted at rest using AES-256-GCM inside the new `tenant_credentials` table, safely protecting third-party SaaS secrets.
4. **Performance Scaling:** Checked time-series indexes (`idx_session_logs_client_ts`) for dashboard analytic optimization.

---

## 2026-07-08 — Issue #16: Business Voice Personalization and Customer Recovery (PR #18)
**Status:** ✅ VERIFIED & MERGED
**Key Technologies:** ElevenLabs API, Twilio SMS/Resend

**Validation Steps:**
1. **Voice Cloning Integration:** Verified the addition of the ElevenLabs TTS provider integration. Confirmed fallback resilience and proper stream handling logic matching the Deepgram implementations.
2. **Post-Call SMS Recovery:** Audited `TelephonyStreamHandler` logic. When a call completes with a negative emotional trajectory (anger, frustration), verified that it correctly dispatches an automated retention SMS / Email via the configured templates.
3. **Emotion Engine Triggers:** Verified that the newly introduced 11-label emotion engine correctly maps intense negative states to the recovery triggers without firing false positives on neutral interactions.

---

*(This document is actively maintained by the engineering team and AI assistants. Ensure every new major PR appends its results here).*
