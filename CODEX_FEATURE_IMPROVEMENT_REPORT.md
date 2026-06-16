# Codex - VOXERA Feature Improvement Report

This report reviews the current implementation against the SRD, the Opus refinement plan, and the existing project reports. It does not change the SRD. It focuses on where the product and codebase can be improved next.

## Executive Summary

VOXERA has a strong working skeleton: Next.js admin routes, Supabase-backed memory/session storage, Deepgram STT/TTS integration, RAG ingestion, a voice-agent UI, CAI logging, and basic booking tools. The main improvement areas are not broad new features; they are correctness, tenant safety, observability, and turning demo-grade approximations into production-grade behavior.

Highest-priority improvements:

1. Complete multi-tenant isolation across every API and tool path.
2. Emit real tool invocation logs instead of only counting a type that is never written.
3. Fix confidence-category display and make confidence actionable in policy and analytics.
4. Replace placeholder CAI/audio metrics with measurements from real speech timing and audio features.
5. Add document-level knowledge management instead of listing raw memory chunks only.
6. Make booking availability, cancellation, email, and calendar actions tenant-scoped and auditable.

## What Looks Implemented

The following features are visibly present in the codebase:

- Admin authentication shell and protected admin layout: `app/admin/layout.tsx`, `app/login/actions.ts`.
- Analytics endpoint and dashboard cards: `app/api/analytics/route.ts`, `app/admin/page.tsx`.
- Session event storage: `lib/logging/session-logger.ts`, `sql/migration.sql`.
- Session history UI: `app/admin/sessions/page.tsx`.
- Knowledge upload and chunk ingestion: `app/api/knowledge/upload/route.ts`, `lib/knowledge/ingest.ts`.
- Knowledge list view: `app/admin/knowledge/page.tsx`, `app/api/knowledge/query/route.ts`.
- Voice persona UI and TTS persona input: `app/admin/settings/page.tsx`, `app/api/tts/route.ts`, `lib/deepgram/tts.ts`.
- CAI calculation/logging: `lib/emotion/cai.ts`, `lib/agent/orchestrator.ts`.
- LLM tool-calling loop: `lib/agent/llm.ts`, `lib/agent/tools.ts`.
- Supabase vector memory mapping: `lib/memory/store.ts`, `lib/memory/retrieval.ts`, `lib/memory/writer.ts`.

## Feature Improvements By Area

### 1. Multi-Tenant Isolation

Current issue:

- `/api/turn` accepts `clientId` and `userId` directly from the browser request body. That means a caller can potentially submit another tenant's `clientId`.
- `/api/session/[sessionId]` reads session logs by `sessionId` only and does not authenticate or filter by `clientId`.
- `/api/knowledge/query` uses the authenticated user when present, but can fall back to `body.clientId` and demo data.
- `lib/db/supabase.ts` uses the service role key, which is fine for backend code, but it means every route must enforce tenant boundaries before calling database helpers.
- `checkAvailability()` and `cancelBooking()` in `lib/db/reservations.ts` are not scoped by `clientId`.

Recommended improvement:

- Resolve `clientId` server-side for every authenticated route.
- Remove client-controlled `clientId` trust from production APIs.
- Add `clientId` to availability and cancellation queries.
- Add row-level security policies in Supabase, even if backend service-role helpers remain.
- Add tests that attempt cross-tenant reads and writes.

SRD impact:

- Improves FR-23 Multi-Tenant Business Management.
- Improves NFR-6 Security, NFR-7 Privacy, and NFR-10 Auditability.

### 2. Tool Invocation Logging

Current issue:

- `SessionEventType` includes `tool_invocation`.
- The analytics route counts `tool_invocation` events.
- But `dispatchToolCall()` does not write session events, and `generateReply()` only has `clientId`, not `sessionId` or `userId`.

Recommended improvement:

- Pass a full execution context into `generateReply()` and `dispatchToolCall()`: `sessionId`, `userId`, `clientId`.
- Log every tool call with:
  - tool name
  - redacted arguments
  - started timestamp
  - completed timestamp
  - status
  - result summary
  - error message if failed
- Include booking IDs, email status, and calendar status in tool logs.

SRD impact:

- Completes FR-12 Tool Invocation Framework.
- Completes the tool-invocation part of FR-21 Session Logging.
- Improves NFR-10 Auditability.

### 3. Confidence Classification

Current issue:

- `lib/emotion/confidence.ts` correctly returns `{ level, explanation }`.
- `VoiceAgent.tsx` treats `confidenceCategory` like a string, which can render as `[object Object]`.
- The analytics dashboard does not aggregate confidence categories.
- Low confidence is not consistently used to trigger clarification or escalation.

Recommended improvement:

- Render `confidenceCategory.level` and optionally expose the explanation in trace details.
- Add confidence distribution to `/api/analytics`: high, medium, low.
- Apply low-confidence state in policy decisions, especially for FR-18 escalation and clarification.
- Align all UI labels with SRD thresholds:
  - High: `>= 0.80`
  - Medium: `>= 0.50` and `< 0.80`
  - Low: `< 0.50`

SRD impact:

- Improves FR-7 Confidence Estimation.
- Improves FR-18 Human Escalation.
- Improves FR-22 Analytics Dashboard.

### 4. CAI And Audio Feature Quality

Current issue:

- CAI is logged, but it uses placeholder values in `orchestrator.ts`: fixed speaking rate, fixed pause duration, no real interruptions, and pitch variation inferred from VAD arousal.
- FR-5 acoustic feature extraction is not implemented beyond approximations.
- FR-20 expects pitch variation, speaking rate, interruptions, pause duration, and response length.

Recommended improvement:

- Capture timestamps from STT partial/final events to calculate speaking rate and pause duration.
- Add interruption tracking based on user speech while TTS/agent response is active.
- Add an audio-feature layer for pitch/energy features before CAI scoring.
- Store CAI input factors in session logs, not only the final score/explanation.
- Mark CAI as estimated vs measured until real acoustic features are available.

SRD impact:

- Improves FR-5 Feature Extraction.
- Improves FR-20 CAI.
- Improves FR-28 Explainability.

### 5. Knowledge Base Management

Current issue:

- Upload works by converting files into `LTM_client` memory chunks.
- The admin list view shows chunks grouped by topic, not source documents.
- There is no document metadata table, delete flow, re-ingest flow, versioning, or pagination.
- `listAll` can load all client knowledge chunks at once.

Recommended improvement:

- Add a `knowledge_documents` table with `id`, `clientId`, `filename`, `mimeType`, `status`, `chunkCount`, `createdAt`, and `updatedAt`.
- Add a `documentId` field to memory chunks.
- Support delete/re-index operations at document level.
- Add pagination and search in `/admin/knowledge`.
- Store extraction errors and ingestion status for admin visibility.

SRD impact:

- Improves FR-16 Knowledge Base Management.
- Improves FR-10 RAG quality and maintainability.

### 6. Booking, Calendar, And Email Workflows

Current issue:

- `checkAvailability()` is not tenant-scoped.
- `cancelBooking()` is not tenant-scoped.
- `createBooking()` sends confirmation to `user@example.com`.
- Calendar integration is invoked, but operational status is not logged as a session event.
- Tool set does not yet cover modify booking, retrieve customer records, update spreadsheet, or explicit send email.

Recommended improvement:

- Add `clientId` to every reservation query.
- Add database constraints or transaction logic to prevent race-condition double booking.
- Require customer contact details before sending confirmation.
- Log email and calendar outcomes into `session_logs`.
- Extend tools incrementally: `modify_booking`, `send_email`, `retrieve_customer_record`.

SRD impact:

- Improves FR-12 Tool Invocation Framework.
- Improves FR-13 Reservation Management.
- Improves FR-14 Calendar Integration.
- Improves FR-15 Email Notification System.

### 7. Admin Analytics

Current issue:

- Dashboard includes calls, tool calls, escalations, bookings, average CAI, emotions, recent sessions, and recent events.
- Missing SRD dashboard metrics include confidence distribution, peak hours, conversion rate, average call duration, missed bookings, and session count over time.
- `app/admin/page.tsx` still assumes `data.metrics` exists after a successful response.

Recommended improvement:

- Add safe default analytics data on the frontend.
- Add confidence buckets to analytics.
- Add time-series session counts grouped by hour/day.
- Track call duration from first to last event per session.
- Derive conversion rate from sessions that lead to confirmed bookings.
- Define missed booking events explicitly.

SRD impact:

- Improves FR-22 Analytics Dashboard.

### 8. Voice Persona And Business Settings

Current issue:

- Voice persona and greeting are stored in browser `localStorage`.
- `/api/tts` accepts `persona` from the request body.
- The custom greeting does not appear to be enforced by server-side agent configuration.

Recommended improvement:

- Add a `business_settings` table keyed by `clientId`.
- Store persona, greeting, business hours, escalation contact, and tone preferences server-side.
- Resolve settings in `/api/turn` and `/api/tts` using authenticated `clientId`.
- Use custom greeting in the actual first-turn conversation flow.

SRD impact:

- Improves FR-25 Voice Persona Configuration.
- Supports FR-23 Multi-Tenant Business Management.

### 9. Telephony And Queueing

Current issue:

- The browser voice-agent path is present.
- Telephony provider handling, incoming call metadata, queue state, wait estimates, and concurrent call routing are not visible as complete production features.
- `lib/queue/manager.ts` exists, but it is not clearly integrated into incoming-call APIs.

Recommended improvement:

- Add telephony webhook routes for incoming call/session creation.
- Store call metadata in a dedicated table.
- Integrate queue manager with call lifecycle events.
- Expose queue metrics in analytics.

SRD impact:

- Improves FR-1 Incoming Call Handling.
- Improves FR-19 Call Queue Management.

### 10. Database Migrations And Production Safety

Current issue:

- `sql/migration.sql` drops the `memories` table as part of setup.
- This is okay for local reset, but dangerous for production migration.
- There are indexes, but session analytics could benefit from compound indexes by `clientId` and `ts`.

Recommended improvement:

- Split setup/reset scripts from production migrations.
- Add additive migrations with clear versioning.
- Add indexes such as:
  - `session_logs("clientId", ts desc)`
  - `session_logs("clientId", "sessionId", ts)`
  - `reservations("clientId", date, time, status)`
- Add RLS policies for tenant data.

SRD impact:

- Improves NFR-4 Reliability.
- Improves NFR-6 Security.
- Improves NFR-10 Auditability.

### 11. Testing And Verification

Current issue:

- `npm.cmd run build` passes when network access is available for Google font fetching.
- Existing scripts are smoke-style, but there is no clear automated regression suite around the highest-risk flows.

Recommended improvement:

- Add unit tests for:
  - confidence thresholds
  - CAI scoring boundaries
  - retrieval empty embedding guard
  - memory row serialization
- Add integration tests for:
  - authenticated tenant isolation
  - session timeline lookup
  - tool invocation logging
  - knowledge upload/query/list flow
  - booking create/cancel flow
- Replace network-dependent Google fonts with local fonts or checked-in font assets for reliable builds in restricted environments.

SRD impact:

- Improves NFR-4 Reliability.
- Improves NFR-8 Maintainability.
- Supports evaluation requirements.

## Suggested Priority Order

1. Security pass: tenant isolation for `/api/turn`, `/api/session/[sessionId]`, knowledge query, and reservations.
2. Tool logging pass: emit `tool_invocation` session events from every tool call.
3. Confidence pass: fix UI rendering and add analytics aggregation.
4. Booking pass: tenant-scope availability/cancel and log calendar/email outcomes.
5. Knowledge pass: add document metadata, delete/reindex, and pagination.
6. CAI/audio pass: replace placeholder acoustic inputs with measured timing/audio features.
7. Admin analytics pass: confidence, peak hours, conversion, duration, missed booking metrics.
8. Production hardening: RLS, additive migrations, tests, local fonts.

## Bottom Line

The current project is beyond a mockup: core paths exist and the build passes. The next step should be a hardening sprint, not a broad rewrite. The system will improve fastest by closing tenant-safety gaps, making every tool/action auditable, and turning the current dashboard numbers into trustworthy metrics backed by session events.
