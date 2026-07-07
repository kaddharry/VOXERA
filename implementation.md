# VOXERA PR Implementation Summary

This document summarizes the core engineering logic implemented to resolve GitHub issues #4 through #9.

---

## 1. STM Memory Leak & Eviction Policy (Issue #5)
* **Problem:** Short-term memory (STM) persistence used an in-memory `Map` cache and a write-through mechanism to Supabase, but lacked an eviction strategy, causing an unbounded memory growth (potential Out-Of-Memory crash).
* **Eviction Logic:**
  * **TTL Eviction:** Cache entries expire and are deleted after **1 hour** of inactivity.
  * **LRU Eviction:** The cache size is bounded at a maximum of **200 concurrent sessions**. When exceeded, the least-recently accessed entry is evicted.
  * **Scheduled DB Sweeper:** A background cleanup task runs every **30 minutes** (using `setInterval` with `.unref()` so it doesn't block process exit) to remove stale sessions (older than 24 hours) from the Supabase database.

---

## 2. Telephony Queueing & Twilio `<Enqueue>` (Issue #8)
* **Problem:** Queueing previously relied on a polling loop where Twilio played a wait message, paused, and redirected back to check if slots were free. This was inefficient and lacked priority handling.
* **Optimized Queue Logic:**
  * **Twilio Native `<Enqueue>`:** When the agent capacity is full, the incoming call handler responds with `<Enqueue>voxera_queue</Enqueue>`, placing the call in Twilio's native hold queue.
  * **Priority Support:** VIP numbers or premium callers are automatically assigned higher priority (e.g., priority `1` instead of `5`) and are sorted to the front of the queue.
  * **Queue Overflow Protection:** Rejects incoming calls with `<Reject>` if the queue grows to 5x the maximum concurrent call limit (50 waiting callers) to prevent unbounded growth.
  * **Auto-Dequeue & Redirection:**
    * When an active call ends, the `callQueue.markCallEnded()` method fires.
    * This triggers an `onSlotAvailable` listener registered at startup (`lib/bootstrap.ts`).
    * The listener peeks at the top queued caller and uses the **Twilio REST API** (`getTwilioClient()`) to dynamically redirect the call out of `<Enqueue>` to a new webhook endpoint: `/api/telephony/dequeue`.
    * `/api/telephony/dequeue` returns the `buildConnectTwiml` payload to establish the WebSocket Media Stream.

---

## 3. TTS Audio Pipeline & Twilio Static Noise (Issue #4)
* **Problem:** TTS returned mp3 bytes, which were sent directly to Twilio's mulaw encoder, resulting in garbled audio.
* **Fix:** Migrated to `synthesizeLinear16()` which requests raw linear16 PCM audio at 8kHz directly from Deepgram. This matches the exact format needed by the mulaw encoder, eliminating static and noise.

---

## 4. AI Retrieval Pipeline & LLM Failover (Issue #7)
* **Resilient Retry & Key Rotation:** `KeyRotator` automatically handles rate limits, credential exhaustion, server errors (500/502/503), and timeouts (15s) with exponential backoff (1s → 2s → 4s) across multiple API keys.
* **Multi-Provider LLM Failover:** Attempts Groq API first, falls back to OpenAI if Groq fails, and defaults to offline fallback if both are offline.
* **pgvector Search:** Swapped full-table scan with the database-side `match_memories` pgvector RPC, returning the top-20 candidates for local scoring and re-ranking.
