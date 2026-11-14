# VOXERA — data flow (as implemented)

This describes what the code actually does, file by file. Deployment is all-Vercel (Fluid Compute) with Supabase as the only state store. There is no Redis.

## 1. Services

```
                    ┌──────────────────── Vercel (Fluid Compute, Node.js) ─────────────────────┐
 Twilio ──HTTPS──▶  │ /api/telephony/incoming   /status   /stream-status   /amd                 │
 Twilio ──HTTPS──▶  │ /api/telephony/queue-wait (queue waitUrl)   /dequeue (queue action)       │
 Twilio ══WSS═══▶   │ /api/telephony/stream  (upgradeWebSocket, ≤300 s on Hobby)                │
 Browser ───────▶   │ dashboard pages + APIs;  /api/session/[id]/stream (SSE)  /replay          │
 Vercel Cron ───▶   │ /api/cron/dispatch  (every 15 min)                                        │
                    └──────┬──────────────────┬─────────────────┬──────────────┬────────────────┘
                           ▼                  ▼                 ▼              ▼
                 Supabase Postgres     Supabase Realtime    Deepgram     Groq → ZenMux
                 (data, pgvector,      (private Broadcast   (STT + TTS)  (LLM; OpenAI-
                  call slots, queue,    channels: live                    compatible API)
                  jobs, rate limits)    call events)        Gnani (optional, Indian languages)
                 Hugging Face (model downloads for the local ONNX models, cached in /tmp)
```

## 2. An inbound or outbound call

| # | Step | Code | Depends on | Failure behaviour |
|---|---|---|---|---|
| 1 | Twilio requests the webhook (inbound: phone number's Voice URL; outbound: the URL `lib/telephony/outbound.ts` gave Twilio, with `clientId/agentId/patientId` in the query) | `app/api/telephony/incoming/route.ts` | `TWILIO_AUTH_TOKEN`, `VOXERA_PUBLIC_URL` | Bad signature → 403 |
| 2 | Tenant/agent resolved (query params, else `phone_numbers` row, else `DEFAULT_CLIENT_ID`/"demo") | same | Supabase | — |
| 3 | **Call slot**: `acquire_call_slot(CallSid)` — atomic, idempotent lease in `call_slots` | `lib/telephony/call-coordination.ts` → SQL in `sql/migration_v33.sql` | Supabase | DB unreachable → call let through, `call_capacity_unavailable` logged |
| 3a | No slot free → `enqueue_call` then `<Enqueue waitUrl=/queue-wait action=/dequeue>`; queue full → "all lines busy" + hang up | same | Supabase | — |
| 4 | `call_logs` row upserted (status active) | incoming route | Supabase | — |
| 5 | TwiML: `<Say>Please hold while we connect you.</Say><Connect><Stream url="wss://…/api/telephony/stream">` with `<Parameter>` callSid, clientId, agentId, patientId, caller | `lib/telephony/twilio.ts buildConnectTwiml` | — | — |
| 6 | Twilio opens the WebSocket; **signature checked** over the exact `wss://` URL (no params) before upgrading | `app/api/telephony/stream/route.ts`, `lib/telephony/webhook-auth.ts` | `TWILIO_AUTH_TOKEN` | Bad signature → 403 (switch: `TWILIO_VALIDATE_STREAM_SIGNATURE=false` = log only) |
| 7 | Route module loads with **no ML model imported**; models load lazily. The native `libonnxruntime.so.1.14.0` is shipped by `outputFileTracingIncludes` (`next.config.ts`) | route + `lib/warmup.ts` | — | Missing runtime can no longer stop the route loading |
| 8 | `upgradeWebSocket` → `TelephonyStreamHandler` | `lib/telephony/stream-handler.ts` | — | — |
| 9 | `init()`: Deepgram live STT connects (eager, so early audio isn't lost); warm-up of the embedder + text-emotion model starts once per instance | stream handler, `lib/deepgram/live.ts` | `DEEPGRAM_API_KEY` | STT failure → `onInitFailed`: call_logs `failed`, socket closed 1011 |
| 10 | `start` event: real CallSid / clientId / agentId / patientId from `start.customParameters`; `call_logs.sessionId = tel-…`; **slot lease confirmed and renewed every 45 s** | stream handler `holdCallSlot()` | Supabase | Renewal failure logged; lease expires after 120 s if the Function dies |
| 11 | Voice setup (Deepgram or Gnani by agent), greeting spoken | `setupVoiceForCall`, `speakGreeting`, `announceGreeting` | Deepgram / `GNANI_API_KEY` | Logged |
| 12 | `media`: μ-law → PCM (`decodeMulaw`) → STT; PCM kept per turn for voice features | stream handler | — | — |
| 13 | Transcripts: backchannel filter, barge-in from the caller's words (`clear` + mark tracking), end of turn (utterance end) | `onTranscript` | — | — |
| 14 | `handleTurn()` | `lib/agent/orchestrator.ts` | see below | Any failure → spoken fallback line |

### Inside `handleTurn()`

1. Input guard; STM push (`lib/memory/stm.ts`: in-process cache + `stm_sessions` table).
2. In parallel: agent/patient info, **text emotion** (`lib/emotion/detect.ts`: lexicon → local ONNX DistilRoBERTa within a latency budget → remote HF/XLM when configured), **query embedding** (`lib/util/embed.ts`, local ONNX bge-small, 384-d).
3. **Voice features** (`lib/audio/acoustic.ts`: pitch/energy/rate from the caller's last utterance) → audio emotion → **fusion** (words lead).
4. **Memory retrieval**: MTM / LTM_user / LTM_client via `vectorStore.search` → Supabase RPC `match_memories` (pgvector). Small knowledge bases are inlined in the prompt instead (`lib/knowledge/inline`).
   - If the embedding model is unavailable: `embedding_unavailable` is logged, retrieval runs **degraded** (no vector search, nothing written to the vector store; the inlined KB still works). Vectors from another model are never written.
5. Persona lock (`lib/emotion/persona-lock.ts`: per-call cache, written through to `session_state`).
6. Policy (`lib/agent/policy.ts`) → **LLM** (`lib/agent/llm.ts`: Groq → Groq #2 → ZenMux, streamed clause by clause) → **output guard** (`lib/agent/guard.ts`).
7. Session events logged durably to `session_logs` (`lib/logging/session-logger.ts`) and broadcast live (§4).

### Speaking the reply

Each clause → Deepgram Aura streaming TTS (or Gnani) → PCM → μ-law (`encodeMulaw`) → `media` frames + `mark` to Twilio. Marks track what has actually played (barge-in).

### End of call

- Twilio `stop` / socket close → `onCallEnded()`: slot released (`release_call_slot`, idempotent), STT/TTS closed, `call_logs` completed, recovery SMS check.
- Twilio status callback → `app/api/telephony/status/route.ts` (signature checked; only final statuses): slot released again (no-op if already), queue entry closed, `call_logs` updated, campaign roll-up, then the **post-call job**:
  `enqueue_job("post_call", "post_call:<CallSid>")` → run immediately inside `waitUntil` (`lib/telephony/post-call.ts`): summary → follow-up decision → appointment outcome → self-learning findings (`call_insights`). If that run doesn't finish, the cron retries it (lease 240 s, backoff, max 5 attempts).

## 3. Queued callers (when every slot is taken)

```
incoming → acquire_call_slot = no → enqueue_call (call_queue row) → <Enqueue waitUrl action>
Twilio ─(on join, then after every ~15 s hold message)─▶ /queue-wait → try_dispatch_queued_call
     not first / no capacity → hold message (Twilio polls again)
     first in line + slot free → slot claimed atomically → <Leave/>
Twilio ─▶ /dequeue (action URL, QueueResult=leave) → finish_queued_call(dispatched) → connect TwiML
Caller hangs up while waiting → /dequeue (QueueResult=hangup) or status callback → abandoned
```

No long-running process is involved: Twilio's own polls drive dispatch. Callers who stop polling for 90 s are abandoned; a claim that isn't completed within the lease goes back in line.

## 4. Live Calls dashboard

```
orchestrator / handler → emitSessionEvent() → broadcastSessionEvent()
   → POST {SUPABASE_URL}/realtime/v1/api/broadcast  (service-role key, private: true, per-session order kept)
Browser EventSource → /api/session/[id]/stream (SSE)
   → owner check (service client looks up call_logs; tenant session must match; "demo" calls public)
   → CallSid resolved to the tel-… session id (polls call_logs every 2 s until "start" records it)
   → subscribeSessionEvents(): server joins the PRIVATE channel with the service-role key
   → events forwarded to the browser; 15 s heartbeat
Reconnect → /api/session/[id]/replay reloads earlier turns from session_logs (Postgres)
```

The browser never talks to Supabase Realtime directly; private channels have no RLS policy for anon/authenticated users, so only the server (service role) can join them.

## 5. Scheduler and recovery (`/api/cron/dispatch`, every 15 min)

1. `recover_telephony_state()`: frees expired call-slot leases, abandons silent queue entries, re-queues stuck dispatches, clears expired rate-limit/session rows.
2. `claim_jobs(['post_call'])`: retries unfinished after-call jobs.
3. `runScheduledDispatch()`: due follow-up / reminder calls (`follow_up_tasks`, claimed atomically), stuck-call reconciliation.

On the Hobby plan Vercel may start the cron up to 15 minutes late, so a follow-up runs roughly 15–30 minutes after it's due; a "retry in 1 minute" is not honoured. The local `custom-server.ts` runs the same steps every 30–60 s.

## 6. Where state lives

| State | Store |
|---|---|
| Tenants, agents, patients, knowledge, memories (pgvector), call logs, session logs, insights, follow-ups | Supabase Postgres (existing tables) |
| Call capacity, slot leases, caller queue, after-call jobs, rate limits, persona lock, STM | Supabase Postgres (`sql/migration_v33.sql`) |
| Live call events | Supabase Realtime Broadcast (transient) |
| Circuit breaker for Supabase | Per Vercel instance (in memory, on purpose) |
| ONNX model files | `/tmp/xenova` on Vercel, `.cache/xenova` locally |
