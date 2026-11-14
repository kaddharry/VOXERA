# VOXERA production deployment

The step-by-step setup guide is **[VOXERA_DEPLOYMENT_RUNBOOK.md](VOXERA_DEPLOYMENT_RUNBOOK.md)** (also as a PDF). The detailed request and call flow is **[voxera_data_flow.md](voxera_data_flow.md)**. This page summarises the architecture, its limits and what is still unverified.

## Architecture

| Service | Role |
|---|---|
| **Vercel** (Fluid Compute, Node.js runtime) | The web app, all HTTP APIs, Twilio webhooks, the Twilio Media Stream WebSocket (`/api/telephony/stream`, via `@vercel/functions` `upgradeWebSocket()`), and Vercel Cron (`/api/cron/dispatch`, every 15 min). |
| **Supabase Postgres** | The only state store: tenant and patient data, knowledge and memory (pgvector), call logs, session logs, insights, follow-ups — and, since `sql/migration_v33.sql`, call-slot leases, the caller queue, after-call jobs, rate limits and per-call state. Concurrency-sensitive operations are Postgres functions. |
| **Supabase Realtime** | Live Call events only (transcript, emotion, …) on private Broadcast channels, sent and received by the server with the service-role key. Not a history store: the dashboard reloads history from Postgres. |
| **Twilio** | Phone numbers, calls, Media Streams (bidirectional audio), native caller queue. |
| **Deepgram** | Live speech-to-text and text-to-speech. |
| **Groq → ZenMux** | LLM, through their OpenAI-compatible APIs. No OpenAI key is used. |
| **Gnani** (optional) | Indian-language speech for agents set to use it. |
| **Local ONNX models** | Text emotion (DistilRoBERTa), embeddings (bge-small, 384-d), voice emotion (wav2vec2, diagnostics). Downloaded from Hugging Face on first use per instance into `/tmp/xenova`. |

Removed: **Redis / Upstash** (every responsibility moved to Postgres or Realtime), the direct **OpenAI** LLM provider and embedding fallback, and the hash-embedding fallback.

## Limits of the current deployment (Vercel Hobby)

- **Calls are cut at 300 seconds.** Every Vercel Function, including the call WebSocket, stops at `maxDuration` (300 s on Hobby). The slot lease then expires on its own within two minutes, and Twilio's status callback still records the call. Longer calls need the Pro plan (`maxDuration` up to 800 s), or moving `/api/telephony/stream` to a persistent Node host (set `VOICE_STREAM_URL` to its `wss://` URL; the rest stays on Vercel).
- **Scheduled calls are approximate.** The cron runs every 15 minutes and Hobby may start it up to 15 minutes late, so a follow-up or retry goes out roughly 15–30 minutes after it's due.
- **Cold starts.** A new Vercel instance downloads the ONNX models on first use (~33 MB embedder, larger emotion models). A call warms the embedder and text-emotion model as soon as it connects, so this mostly overlaps the greeting; the first reply on a cold instance can still be slower.
- **Hobby is for non-commercial use** under Vercel's terms.

## Failure behaviour

| Failure | Effect |
|---|---|
| ONNX native runtime missing | Calls still connect. Emotion falls back to the lexicon; embeddings report `embedding_unavailable` and retrieval runs degraded (no vector memory, inlined knowledge base still works). Nothing is written to pgvector. |
| Supabase unreachable | Call capacity can't be checked: the call is let through and `call_capacity_unavailable` is logged. Rate limits likewise let requests through. Memory and logging degrade as before. |
| Function killed mid-call | The call's slot lease expires (120 s); the after-call job, if started, is retried by the cron. |
| Deepgram key missing or STT fails | The call is ended right after connecting (`Initialisation failed`, socket close 1011, call_logs `failed`). |
| Required variable missing | `config_missing` is logged on the first call/cron with the variable names. A missing Supabase URL/service key in Production is a clear `MissingEnvError`, never a placeholder. |

## Security

- Twilio signatures are verified on `/incoming`, `/status`, `/stream-status`, `/amd`, `/queue-wait`, `/dequeue` and on the **Media Stream WebSocket handshake** (exact `wss://` URL, no params).
- `/api/cron/dispatch` requires `CRON_SECRET` in Production.
- New tables have RLS on with no policies; their functions are executable only by `service_role`.
- Live Calls channels are private; the SSE route checks call ownership with the server client before subscribing. Demo calls (`clientId = "demo"`) remain public by design.
- The service-role key is only read on the server.

## Not yet verified on real infrastructure

Automated tests cover the SQL (against real Postgres via PGlite), the routes and the call pipeline with mocks. These still need a real deployment and real calls (see the runbook's final checklist):

1. A full phone conversation on Vercel after migration v33 (handshake, greeting, turns, barge-in, hang-up).
2. Twilio's stream-handshake signature matching the `wss://` URL on the deployed domain.
3. Private Realtime channels with the project's service-role key (sending and receiving).
4. Model downloads and `/tmp` cache on Vercel.
5. The queue path with more simultaneous calls than `max_concurrent_calls`.
6. Calls longer than 300 s (expected to be cut; slot must come back).
