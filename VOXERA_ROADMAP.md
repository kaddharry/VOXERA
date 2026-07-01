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
| **Multi-Tenant Isolation** | 🟡 Needs Imp. | High | 85% | Needs Row-Level Security (RLS) enforcement at DB level. |
| **Telephony & WebSockets** | ✅ Stable | Medium | 95% | Queue is currently in-process memory; needs redis for horizontal scaling. |
| **Speech Emotion (SER)** | ✅ Stable | Medium | 97% | Expanded to 11 labels, 35+ lexicon entries, context-aware punctuation, positivity safety net. |
| **Memory (Vector Store)** | ✅ Stable | High | 94% | Circuit breaker integration prevents cascading timeouts. Needs compound indexes. |
| **Knowledge Base (RAG)** | 🟢 Complete | High | 95% | Cascading deletion, status polling, and version superseding are stable. |
| **Booking & Integrations** | 🟢 Complete | High | 90% | Advisory locks and calendar JWT sync are stable. Needs client credential encryption. |
| **Analytics Dashboard** | 🟢 Complete | Low | 95% | Lightweight SVG graphs and tool invocation logging are fully integrated. |
| **Acoustic CAI Processing**| 🟠 In Progress | Medium | 40% | Currently uses duration/pitch heuristics. Needs raw DSP waveform extraction. |
| **AI Orchestrator** | ✅ Stable | High | 95% | Parallelized pipeline, fire-and-forget logging. Latency reduced from ~29s to ~3-5s. |
| **Supabase Resilience** | 🟢 Complete | High | 100% | Circuit breaker, timeout fetch, graceful degradation. |
| **SaaS Builder & Billing**| 🔴 Not Started | High | 0% | Stripe subscription gates and self-serve onboarding wizard are unbuilt. |

---

## 4. Subsystem Roadmap & Technical Details

### 4.1 Multi-Tenant Data Hardening
* **Current State**: Authenticated client IDs are resolved server-side using Supabase SSR cookies (`lib/db/server.ts`) and used to scope database filters.
* **Technical Debt & Known Problems**: 
  - Database queries leverage the Supabase `SERVICE_ROLE_KEY` in backend files, bypassing Row Level Security (RLS) protections. If an API endpoint fails to apply a `.eq("clientId", clientId)` filter, cross-tenant data exposure can occur.
* **Testing Needed**: Write integration tests that simulate cross-tenant API requests (e.g., trying to read session logs or call logs using another client's session identifier) to assert that unauthorized requests return `403 Forbidden`.
* **Deployment Risks**: Modifying RLS schemas in production could disrupt existing database sessions if policies are configured incorrectly.
* **Roadmap Priority**: **Near-Term**

### 4.2 Database Performance & Compound Indexing
* **Current State**: Basic single-column indexes exist for primary keys and client lookups.
* **Technical Debt**:
  - High-frequency dashboard queries aggregate statistics over time series. Lacking compound indexing will lead to performance degradation as call logs and session logs scale.
* **Improvement Opportunities**:
  - Implement compound indices:
    - `session_logs("clientId", ts desc)`
    - `session_logs("clientId", "sessionId", ts)`
    - `reservations("clientId", date, time, status)`
* **Estimated Complexity**: Low (Simple SQL DDL migration)
* **Roadmap Priority**: **Near-Term**

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
* **Current State**: Google Calendar and Resend tokens/private keys are loaded from static environment variables.
* **Technical Debt**: In a true SaaS environment, each tenant will connect their own custom calendar/email accounts. Storing third-party keys in `.env` is unscalable and insecure.
* **Improvement Opportunities**:
  - Develop a secure database settings vault.
  - Encrypt third-party JWT credentials using AES-256 before writing to the database, decryption only on context load.
* **Roadmap Priority**: **Near-Term**

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
* [ ] Enable Row Level Security (RLS) on all Supabase tables and verify policies.
* [ ] Create compound indexes for analytical time-series logs.
* [ ] Encrypt Google Service Account tokens in database-backed tenant configurations.
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
