# VOXERA Engineering Roadmap

This document outlines the remaining tasks, technical debt, security enhancements, and future SaaS milestones for the VOXERA platform.

---

## 1. Executive Summary

VOXERA has a robust core foundation: real-time telephony streaming, custom WebSockets, dynamic emotion adaptation prompt coaching, Supabase vector databases, transactional booking safety, and custom lightweight SVG dashboard reporting. 

Recent engineering work has hardened the emotion engine (expanded from 9 to 11 labels with 35+ lexicon entries and context-aware detection), introduced a Supabase circuit breaker and timeout layer to prevent cascading failures, and parallelized the AI orchestrator pipeline to eliminate ~25 seconds of unnecessary latency.

The next phases of development will transition the codebase from a highly complete MVP into a hardened, secure, and commercially scalable SaaS platform. Near-term work focuses on security hardening (RLS, token encryption) and replacing audio heuristics with physical acoustic DSP metrics. Medium and long-term milestones describe self-serve multi-tenant onboarding, billing integrations, and multi-agent template builder workflows.

---

## 2. Current Project Completion

* **Core MVP Feature Set**: **92%**
* **SaaS Infrastructure & Billing**: **5%**
* **Overall Platform Readiness**: **68%**

---

## 3. Module Status Dashboard

| Module | Status | Priority | Completion | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Multi-Tenant Isolation** | 🟢 Complete | High | 100% | RLS policies implemented using auth.uid(). |
| **Telephony & WebSockets** | ✅ Stable | Medium | 95% | Queue is currently in-process memory; needs redis for horizontal scaling. |
| **Speech Emotion (SER)** | ✅ Stable | Medium | 98% | Expanded to 11 labels, 35+ lexicon entries, context-aware punctuation, positivity safety net. CI lint and build issues resolved. |
| **Memory (Vector Store)** | ✅ Stable | High | 100% | Circuit breaker integration. Compound indexes implemented. |
| **Knowledge Base (RAG)** | 🟢 Complete | High | 95% | Cascading deletion, status polling, and version superseding are stable. |
| **Booking & Integrations** | 🟢 Complete | High | 100% | Advisory locks, calendar JWT sync, and AES-256 credential encryption are stable. |
| **Analytics Dashboard** | 🟢 Complete | Low | 95% | Lightweight SVG graphs and tool invocation logging are fully integrated. |
| **Acoustic CAI Processing**| 🟠 In Progress | Medium | 40% | Currently uses duration/pitch heuristics. Needs raw DSP waveform extraction. |
| **AI Orchestrator** | ✅ Stable | High | 95% | Parallelized pipeline, fire-and-forget logging. Latency reduced from ~29s to ~3-5s. |
| **Supabase Resilience** | 🟢 Complete | High | 100% | Circuit breaker, timeout fetch, graceful degradation. |
| **SaaS Builder & Billing**| 🔴 Not Started | High | 0% | Stripe subscription gates and self-serve onboarding wizard are unbuilt. |

---

## 4. Subsystem Roadmap & Technical Details

### 4.1 Multi-Tenant Data Hardening
* **Current State**: Fully hardened. Row Level Security (RLS) policies enforce `auth.uid()::text = "clientId"` across all primary tables (`session_logs`, `reservations`, `memories`, `knowledge_documents`, `call_logs`).
* **Roadmap Priority**: **Completed (Issue #12)**

### 4.2 Database Performance & Compound Indexing
* **Current State**: Compound indices successfully deployed via migration `v8` (`session_logs("clientId", ts desc)` and `reservations("clientId", date, time, status)`).
* **Roadmap Priority**: **Completed (Issue #12)**

### 4.3 Real Acoustic Digital Signal Processing (DSP) for CAI
* **Current State**: The Commitment Acoustic Index (CAI) and audio analytics use duration and pitch-variation approximations inferred from VAD activation.
* **Known Problems**: The system does not analyze physical voice frequencies (pitch variation in Hz, speaking rates, amplitude peaks, or overlaps).
* **Improvement Opportunities**:
  - Parse packet metadata during WebSocket handling.
  - Implement real-time interruption detection if Twilio sends user packets while the agent TTS is streaming.
* **Dependencies**: WebAudio API on browser side; Node-based DSP audio resamplers on server side.
* **Roadmap Priority**: **Medium-Term**

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
* **Current State**: VOXERA is configured for single-tenant operations with default credentials.
* **Future Features (From SaaS Blueprint)**:
  - **Onboarding Wizard**: Self-serve forms allowing new business admins to describe their business, configure voice personas, and write custom greetings.
  - **Billing Integrations**: Gate agent activation and document limits behind Stripe subscriptions (e.g., Starter, Growth, Enterprise plans).
  - **Super-Admin Panel**: Global dashboard for platform maintainers to monitor system health, tenant limits, active integrations, and payment states.
* **Estimated Complexity**: High
* **Expected Engineering Impact**: Enables commercial monetization of the platform.
* **Roadmap Priority**: **Long-Term**

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
* [ ] Integrate real audio packet DSP parser to calculate physical pitch variation and vocal intensity.
* [ ] Implement Redis-backed distributed telephony queues to support multi-node hosting.
* [ ] Implement interruption triggers to halt agent TTS output immediately if user speech is detected.
* [ ] Externalize circuit breaker state to Redis for multi-node deployments.
* [ ] Replace lexicon-based emotion detection with a trained ML model (RoBERTa or similar) via the existing `detectTextEmotion` interface.

### 5.3 Phase III: SaaS Portal (Weeks 6 - 10)
* [ ] Build Stripe subscription hooks and checkout routes.
* [ ] Develop the admin onboarding registration wizard.
* [ ] Implement Super-Admin usage and monitoring panels.
