# VOXERA deployment runbook

**For:** the person setting up the accounts by hand (Vercel, Supabase, Twilio and the AI providers).
**Applies to:** the Supabase-first version of VOXERA (no Redis/Upstash), from the pull request that adds `sql/migration_v33.sql`.
**Never paste real keys into this document, a chat, or a screenshot.**
**PDF version:** `docs/VOXERA_DEPLOYMENT_RUNBOOK.pdf`, built from this file with `node scripts/runbook-pdf/build.mjs`, so both always say the same thing.

---

## A. Architecture overview

| Service | What it does for VOXERA |
|---|---|
| **Vercel** | Hosts the whole app: dashboard, APIs, Twilio webhooks, the live phone-audio WebSocket, and the 15-minute cron that sends follow-ups and cleans up. |
| **Supabase** | The database (patients, agents, knowledge, memory with pgvector, call records) **and** the call coordination that Redis used to do: how many calls are live, who is waiting in the queue, after-call jobs. Also carries the Live Calls feed (Realtime). |
| **Twilio** | The phone number and the calls. Streams call audio to VOXERA over a secure WebSocket and plays VOXERA's replies. |
| **Deepgram** | Turns the caller's speech into text and the agent's replies into speech. |
| **Groq, then ZenMux** | The AI that writes the agent's replies. Groq first; ZenMux if Groq fails. |
| **Gnani** (optional) | Indian-language speech, for agents set to use it. |
| **Resend** (optional) | Email. |
| **Hugging Face** | Nothing to set up: the small emotion and memory models download from it automatically. |

```
 Patient's phone
      │
   Twilio ── webhooks (HTTPS) ──▶ Vercel /api/telephony/incoming, /status, /queue-wait, /dequeue
      │
      └═ call audio (WSS) ═▶ Vercel /api/telephony/stream ──▶ Deepgram (speech ↔ text)
                                     │                      ──▶ Groq / ZenMux (replies)
                                     ▼
                              Supabase Postgres  ◀── Vercel Cron (every 15 min): follow-ups, recovery
                                     │
                              Supabase Realtime ──▶ Vercel /api/session/…/stream ──▶ Live Calls page
```

**Limits on the free Vercel (Hobby) plan:** a call is cut at **5 minutes** (300 seconds); follow-ups go out **15–30 minutes** after they're due; the first call after a quiet period may reply a little slower while models load.

---

## B. Before you start

### Accounts and access you need

- [ ] **GitHub**: the `kaddharry/VOXERA` repository, with the new pull request merged into `main` (or ready to merge).
- [ ] **Vercel**: owner access to the VOXERA project (the free plan allows one member, so the account owner does the Vercel steps).
- [ ] **Supabase**: access to the project VOXERA already uses (Dashboard → your project).
- [ ] **Twilio**: the account that owns VOXERA's phone number.
- [ ] **Deepgram**, **Groq** and/or **ZenMux**: API keys (you probably already have them in `.env.local`).
- [ ] **Optional:** Gnani, Resend, ElevenLabs, Hugging Face, Stripe, Google Calendar keys, only for features you use.

### Database changes to review and apply, in this order

Run only the ones your database doesn't have yet. To see which are already applied, open **Supabase → SQL Editor → New query**, paste this and click **Run**. It only reads, it changes nothing:

```sql
SELECT
  to_regclass('public.call_insights')      IS NOT NULL AS v25,
  to_regclass('public.agent_suggestions')  IS NOT NULL AS v26,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'speech_provider') AS v27,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patients' AND column_name = 'riskLevel') AS v28,
  to_regclass('public.providers')          IS NOT NULL AS v29,
  to_regclass('public.appointments')       IS NOT NULL AS v30,
  to_regclass('public.appointment_waitlist') IS NOT NULL AS v31,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'streamSid') AS v32,
  to_regclass('public.call_slots')         IS NOT NULL AS v33;
```

Each `false` is a migration still to apply. Apply them **in increasing order**, using the files in the repository's `sql/` folder:

| File | What it adds |
|---|---|
| `migration_v25.sql` | Post-call findings (self-learning) |
| `migration_v26.sql` | Agent suggestions and agent versions |
| `migration_v27.sql` | Per-agent speech provider and language |
| `migration_v28.sql` | Patient condition and risk level |
| `migration_v29.sql` | Providers (clinicians) and per-agent tools |
| `migration_v30.sql` | Appointments |
| `migration_v31.sql` | Appointment reminders and waitlist |
| `migration_v32.sql` | Twilio stream diagnostics on call records |
| **`migration_v33.sql`** | **New:** call slots, caller queue, after-call jobs, rate limits, session state, short-term memory table. Replaces Redis. |

All of these only **add** tables, columns and functions. None of them deletes or changes existing data. (Older documents mentioned "v33/v34" migrations for MCP connections and custom tools: those files never existed in the repository. The real v33 is the one above.)

### Back up the database first

Do this before applying anything.

1. **If your Supabase plan has backups** (Pro and above): Supabase → **Database → Backups** → check there is a recent backup (or create one).
2. **On the free plan**, make your own copy:
   1. Supabase → click **Connect** (top of the project page) → **Session pooler** (or Direct connection) → copy the connection string. Keep it private: it contains the database password.
   2. On a computer with PostgreSQL tools installed, run:
      ```
      pg_dump "PASTE_CONNECTION_STRING_HERE" --schema=public -Fc -f voxera_backup_YYYY-MM-DD.dump
      ```
   3. Check the file was created and isn't empty. Keep it somewhere safe.

---

## C. Supabase setup

1. **Find the keys.** Supabase → **Project Settings → API Keys**.
   - **Project URL** (Project Settings → Data API or API) → this is `SUPABASE_URL`.
   - **anon / publishable key** → `SUPABASE_ANON_KEY`. Safe for the browser.
   - **service_role / secret key** → `SUPABASE_SERVICE_ROLE_KEY`. **Server only.** Never put it in browser code, screenshots or chat.
   - If the page shows both new keys and a **Legacy API keys** tab, use the same type of keys VOXERA uses today (most likely the legacy `anon` and `service_role` keys). Don't switch key types during this deployment.
2. **Apply the migrations** (after the backup):
   1. SQL Editor → **New query**.
   2. Open the migration file from GitHub (e.g. `sql/migration_v33.sql`) → **Raw** → select all → copy.
   3. Paste into the query → read it → **Run**. It should end with "Success. No rows returned".
   4. Repeat for each missing migration, in order.
3. **Check migration v33 worked.** Run this read-only query:
   ```sql
   SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('telephony_settings','call_slots','call_queue','background_jobs','rate_limits','session_state','stm_sessions')
    ORDER BY 1;
   ```
   You should see **7 rows**. Then:
   ```sql
   SELECT proname FROM pg_proc WHERE proname IN
     ('acquire_call_slot','renew_call_slot','release_call_slot','enqueue_call','try_dispatch_queued_call',
      'finish_queued_call','telephony_metrics','recover_telephony_state','enqueue_job','claim_jobs',
      'claim_job_by_key','complete_job','rate_limit_hit','queue_position','_expire_call_slots')
   ORDER BY 1;
   ```
   You should see **15 rows**. Finally, `SELECT * FROM public.telephony_settings;` should show one row: `max_concurrent_calls = 10`, `max_queue_length = 50`.
4. **Check the security (RLS) is on.** Supabase → **Database → Tables** → each of the 7 new tables should show **RLS enabled** with **no policies**. That is intended: only the server (service role) may use them.
5. **Realtime (Live Calls).** Supabase → **Realtime → Settings**:
   - Leave **"Allow public access"** as it is (VOXERA's channels are private and don't depend on it).
   - There is nothing to add under Realtime policies. VOXERA's channels are joined only by the server with the service-role key, and no policy lets browsers in.
6. **Change capacity later (optional).** To allow, say, 5 simultaneous calls: `UPDATE public.telephony_settings SET max_concurrent_calls = 5 WHERE id = 1;`

---

## D. Vercel setup

1. **Repository and branch.** Vercel → the VOXERA project → **Settings → Git**: Connected repository is **`kaddharry/VOXERA`**; **Production Branch** is **`main`**.
2. **Build settings.** **Settings → Build and Deployment**: Framework Preset **Next.js**; Build Command and Output Directory left at their defaults (`next build`); Install Command default. **Node.js Version: 22.x** (or 20.x).
3. **Functions.** **Settings → Functions**: **Fluid Compute: Enabled** (the repository's `vercel.json` also sets `"fluid": true`). The call route sets its own limit (`maxDuration = 300`, the most Hobby allows); nothing to change here.
4. **Cron.** **Settings → Cron Jobs** (may be listed as Schedules): you should see `/api/cron/dispatch` every 15 minutes, enabled. It comes from `vercel.json`.
5. **Environment variables.** **Settings → Environment Variables**. For each row below, click **Add New**, type the **exact name** (UPPER CASE, copied from this table), paste the value, tick **Production**, and **Save**.
   - **Preview** deployments: don't tick Preview for `VOXERA_PUBLIC_URL` (a preview must not point Twilio at production). For the others, tick Preview only if you test calls on previews.
   - **Development**: leave unticked. Local development uses `.env.local`.
   - Paste values without quotes and without spaces before or after.

| Exact name | Needed? | Secret | Where to get it | Vercel scope | What it's for |
|---|---|---|---|---|---|
| `SUPABASE_URL` | **Required** | No | Supabase → Project Settings → API → Project URL | Production | Database, auth, storage and Realtime. |
| `SUPABASE_ANON_KEY` | **Required** | No | Supabase → Project Settings → API Keys → anon / publishable key | Production | Signed-in users' requests (row-level security applies). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** | Yes | Supabase → Project Settings → API Keys → service_role / secret key | Production | Server-only: call coordination, jobs, Live Calls Realtime. Never expose to the browser. |
| `TWILIO_ACCOUNT_SID` | **Required** | No | Twilio Console → Account Info | Production | Placing outbound calls. |
| `TWILIO_AUTH_TOKEN` | **Required** | Yes | Twilio Console → Account Info | Production | Placing calls and verifying Twilio's request signatures. |
| `TWILIO_PHONE_NUMBER` | **Required** | No | Twilio Console → Phone Numbers → Active numbers (E.164, e.g. +15551234567) | Production | Caller ID for outbound calls. |
| `TWILIO_VALIDATE_STREAM_SIGNATURE` | Optional | No | Leave unset (= true) | Production, only if needed | Emergency switch: 'false' makes a bad Media Stream handshake signature log-only instead of refused. |
| `VOXERA_PUBLIC_URL` | **Required** | No | Vercel → Project → Domains (e.g. https://voxera-mu.vercel.app, no trailing slash) | Production | Twilio webhook/stream URLs, signature checks, scheduled calls. |
| `NEXT_PUBLIC_BASE_URL` | Optional | No | Same value as VOXERA_PUBLIC_URL | Production, only if needed | Older alias of VOXERA_PUBLIC_URL; only read when VOXERA_PUBLIC_URL is unset. |
| `VOICE_STREAM_URL` | Optional | No | Leave unset on Vercel | Production, only if needed | wss:// URL of a separate voice server, if the call stream ever moves off Vercel. |
| `NEXT_PUBLIC_REALTIME_WS_URL` | Optional | No | Leave unset on Vercel | Production, only if needed | Local development only: WebSocket URL for the Test Agent drawer. |
| `CRON_SECRET` | **Required** | Yes | Generate: openssl rand -hex 32 | Production | Authenticates Vercel Cron calls to /api/cron/dispatch (refused in Production without it). |
| `DEEPGRAM_API_KEY` | **Required** | Yes | Deepgram Console → API Keys | Production | Live speech-to-text and text-to-speech on every call. |
| `GNANI_API_KEY` | If you use the feature | Yes | Gnani / Vachana dashboard | Production | Indian-language speech, for agents whose speech provider is Gnani. |
| `GNANI_LLM_API_KEY` | If you use the feature | Yes | Gnani API dashboard (key with the LLM scope — early access) | Production | Optional Gnani Evon LLM, used as a fallback for Indian-language replies. |
| `ELEVENLABS_API_KEY` | If you use the feature | Yes | ElevenLabs → Profile → API key | Production | Custom voice cloning. |
| `GROQ_API_KEYS` | **Required: at least one of the two** | Yes | Groq Console → API Keys (comma-separated for rotation) | Production | Primary LLM provider. |
| `GROQ_API_KEYS_2` | Optional | Yes | Keys from a second Groq account | Production, only if needed | Second Groq quota, tried before ZenMux. |
| `GROQ_MODEL` | Optional | No | Groq model id | Production, only if needed | Overrides the default Groq model. |
| `CALL_LEARNING` | Optional | No | Set to "off" to disable | Production, only if needed | Turns off learning from calls (patient facts, agent and global lessons) when set to off. |
| `GNANI_STT_MIN_SILENCE_MS` | Optional | No | Milliseconds (100-2000) | Production, only if needed | How much silence Gnani speech recognition waits for before it closes a sentence. Lower = the agent answers sooner but a sentence may split at a pause. Default 300 (browser) / 400 (phone). |
| `ZENMUX_API_KEY` | **Required: at least one of the two** | Yes | ZenMux dashboard | Production | LLM fallback after Groq (an OpenAI-compatible gateway; no OpenAI key needed). |
| `ZENMUX_BASE_URL` | Optional | No | Default https://zenmux.ai/api/v1 | Production, only if needed | Overrides the ZenMux endpoint. |
| `ZENMUX_MODEL` | Optional | No | Default openai/gpt-4o-mini (a model name served by ZenMux) | Production, only if needed | Overrides the ZenMux model. |
| `HF_TOKEN` | If you use the feature | Yes | Hugging Face → Settings → Access Tokens | Production | Remote Hugging Face emotion models (multilingual XLM-EMO). |
| `HUGGINGFACE_API_KEY` | Optional | Yes | Same as HF_TOKEN | Production, only if needed | Older alias of HF_TOKEN. |
| `EMOTION_DIAGNOSTICS` | Optional | No | Leave unset | Production, only if needed | 'on' turns on per-turn emotion diagnostics. |
| `CREDENTIALS_ENCRYPTION_KEY` | If you use the feature | Yes | Generate: openssl rand -base64 32. If credentials were already saved without it, ask before setting it: changing the key makes them unreadable | Production | Encrypts tenants' stored integration credentials (falls back to a built-in key when unset, which is not secure). |
| `RESEND_API_KEY` | If you use the feature | Yes | Resend → API Keys | Production | Sending email. |
| `PLATFORM_ADMIN_EMAILS` | If you use the feature | No | Comma-separated emails | Production | Who may open /admin/tenants. |
| `DEFAULT_CLIENT_ID` | Optional | No | A tenant's user id | Production, only if needed | Tenant for inbound calls to a number not assigned in Settings → Phone Numbers (default 'demo'). |
| `FOLLOWUP_AMD` | Optional | No | Leave unset | Production, only if needed | 'off' turns off voicemail detection on follow-up calls (a paid Twilio feature). |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | If you use the feature | No | Google Cloud service account | Production | Google Calendar sync. |
| `GOOGLE_PRIVATE_KEY` | If you use the feature | Yes | Google Cloud service account key | Production | Google Calendar sync. |
| `GOOGLE_CALENDAR_ID` | If you use the feature | No | Google Calendar settings | Production | Google Calendar sync. |
| `STRIPE_SECRET_KEY` | If you use the feature | Yes | Stripe Dashboard → Developers → API keys | Production | Billing. |
| `STRIPE_WEBHOOK_SECRET` | If you use the feature | Yes | Stripe Dashboard → Webhooks | Production | Billing webhooks. |
| `STRIPE_PRICE_STARTER` | If you use the feature | No | Stripe price id | Production | Billing plans. |
| `STRIPE_PRICE_GROWTH` | If you use the feature | No | Stripe price id | Production | Billing plans. |
| `STRIPE_PRICE_ENTERPRISE` | If you use the feature | No | Stripe price id | Production | Billing plans. |

6. **Remove leftovers** after the deployment is confirmed working (section I). Don't remove them before: `REDIS_URL`, `redis_url`, `LIVE_EVENTS_TRANSPORT`, `OPENAI_API_KEY`. Variables the code never reads can be deleted at any time and change nothing: `DATABASE_URL`, `GEMINI_API_KEY`, `STT_PROVIDER`, `CAIRN_RUNTIME_PROVIDER`, `ANTHROPIC_API_KEY`.
7. **Deploy.** Merging the pull request into `main` deploys automatically. After changing variables, redeploy: **Deployments** → top deployment → **⋯ → Redeploy**. Wait for **Ready** (green).
8. **Check the logs.** **Deployments → (latest) → Build Logs** should end without errors. Then **Logs** (runtime): filter by `config_missing`. If anything appears, it lists exactly which variables are missing.

---

## E. Twilio setup

1. Twilio Console → **Phone Numbers → Manage → Active numbers** → click VOXERA's number.
2. **Voice Configuration**:
   - **A call comes in:** **Webhook**
   - **URL:** `https://<your-domain>/api/telephony/incoming` (e.g. `https://voxera-mu.vercel.app/api/telephony/incoming`). It must be the same domain as `VOXERA_PUBLIC_URL`.
   - **HTTP:** **HTTP POST**
   - **Call status changes:** `https://<your-domain>/api/telephony/status`, **HTTP POST**. Optional for inbound calls (outbound calls set it themselves) but recommended: it frees the call slot and starts the after-call summary.
3. **Save configuration.**
4. Nothing else to configure in Twilio. The stream URL (`wss://<your-domain>/api/telephony/stream`), the stream status callback, the voicemail-detection callback and the queue URLs are all sent by VOXERA inside each call's instructions.
5. **Trial accounts** can only call **Verified Caller IDs** (Phone Numbers → Verified Caller IDs). Add your test phone there.
6. **Signatures.** VOXERA checks Twilio's signature on every webhook and on the audio WebSocket. It works as long as the URL configured above matches `VOXERA_PUBLIC_URL` exactly (same `https://`, same domain, no trailing slash). If calls fail with **403** in Vercel logs (`twilio_signature_invalid` or `stream_signature_invalid`), check those two match. As a temporary emergency measure for the WebSocket only, `TWILIO_VALIDATE_STREAM_SIGNATURE=false` makes that check log-only. Remove it once fixed.

---

## F. Other provider accounts

| Provider | Needed when | Setting |
|---|---|---|
| **Deepgram** | Always | Console → API Keys → create a key with Member role → `DEEPGRAM_API_KEY`. Make sure the project has credit. |
| **Groq** | Always (or ZenMux) | console.groq.com → API Keys → `GROQ_API_KEYS` (comma-separate several). A second account's keys can go in `GROQ_API_KEYS_2`. |
| **ZenMux** | Always (or Groq); recommended as backup | ZenMux dashboard → API key → `ZENMUX_API_KEY`. Its default model name `openai/gpt-4o-mini` is served by ZenMux; no OpenAI account is involved. |
| **Gnani** | Agents with speech provider "Gnani" (Indian languages) | `GNANI_API_KEY` |
| **Resend** | Email features | Resend → API Keys → `RESEND_API_KEY` |
| **ElevenLabs** | Voice cloning | `ELEVENLABS_API_KEY` |
| **Hugging Face** | Multilingual remote emotion model (optional) | Settings → Access Tokens (read) → `HF_TOKEN` |

**Not used** (don't set up): Redis, Upstash, OpenAI, Anthropic, Gemini.

---

## G. Final verification checklist

Do these in order. "Logs" means **Vercel → Project → Logs**. Search for the quoted text.

| # | Test | What to do | Success looks like |
|---|---|---|---|
| 1 | Database connectivity | Supabase SQL Editor: `SELECT public.telephony_metrics();` | A result like `{"active_calls":0,"max_concurrent_calls":10,"queue_length":0,…}` |
| 2 | App deployment | Open `https://<your-domain>` and log in | Dashboard loads; Logs show **no** `config_missing` |
| 3 | Twilio webhook | Twilio → Monitor → Logs → Calls, after test 4 → open the call → Request Inspector | `POST …/api/telephony/incoming` → **200** |
| 4 | Inbound test call | Call the Twilio number from your (verified) phone | You hear "Please hold while we connect you", then **the agent's greeting** (no hang-up) |
| 5 | WebSocket handshake | Logs for that time | `twiml_stream_configured`, then `websocket_handshake_succeeded`; **no** `libonnxruntime`, no Twilio error **31920** |
| 6 | Speech recognition | Say a sentence | Logs: `STT ready for session: tel-…` and your words in turn logs |
| 7 | LLM reply | Ask something simple | A sensible spoken answer; Logs: `[LLM] Success via provider: groq` (or `zenmux`), **not** `No keys found` |
| 8 | Speech playback and barge-in | Let it answer, then say "wait, stop" while it talks | Clear audio; it stops when you interrupt (Logs: `Barge-in: cleared TTS playback`) |
| 9 | Live Calls | During a call, open **Live Calls** in the dashboard | Transcript and emotion update live. If not, look for `subscribe_failed` or `broadcast_failed` in Logs |
| 10 | Call record and summary | Hang up; wait about 1 minute; open the call in the dashboard | Supabase `call_logs` row: `sessionId` starts with `tel-`, `status = completed`, `streamStatus` not `stream-error`; summary/insights appear. Logs: `job_succeeded` for `post_call` |
| 11 | Slot release | After hanging up: `SELECT public.telephony_metrics();` | `active_calls` back to **0**; Logs: `call_slot_released` |
| 12 | Follow-up scheduling | Schedule a follow-up 5 minutes ahead for your patient record | The call arrives within about **15–30 minutes**; Logs: `cron_dispatch_done` |
| 13 | Repeat calls and recovery | Make 3 calls back to back; then one call longer than 5 minutes | All connect; the long call is cut at ~5 minutes (Hobby limit). Within about 2 minutes, or at the next cron, `active_calls` returns to 0 (`expired_slots` in the cron log) |

If all 13 pass, the deployment works. Tell the team which ones you ran.

---

## H. Troubleshooting

| Symptom | Most likely cause | Where to look / what to do |
|---|---|---|
| Call hangs up right after "Please hold" | The audio WebSocket isn't accepted | Logs on `/api/telephony/stream`: see the next three rows. Also confirm the deployment with this PR is **Ready** |
| Twilio error 31920 (WebSocket handshake) | Route crashed (e.g. `libonnxruntime … cannot open`), or a **403** from the signature check | ONNX: make sure the deployed build includes this PR. 403: make the Twilio webhook domain match `VOXERA_PUBLIC_URL` exactly |
| Call connects, then drops at once | Deepgram failed (`Initialisation failed`, close code 1011) | Check `DEEPGRAM_API_KEY` name and value, and Deepgram credit |
| "All lines are currently busy" | Every slot taken and the queue full, or old slots not yet expired | `SELECT * FROM public.call_slots WHERE released_at IS NULL;` Leases expire 2 minutes after a call dies; the cron also frees them. Raise capacity in `telephony_settings` if needed |
| Deepgram initialisation failure | Missing or wrong key | `config_missing` in Logs lists missing names |
| `embedding_unavailable` / `model_warmup_failed` | The memory model couldn't load on that instance | Calls still work (memory search degraded). Redeploy; if it persists, send the log line to the team |
| Live Calls not updating | Realtime not reaching the server | Logs: `broadcast_failed` / `subscribe_failed`. Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; Supabase → Realtime is enabled for the project |
| Supabase "permission denied" / RLS errors on the new tables | The app is using the anon key where the service key is needed | `SUPABASE_SERVICE_ROLE_KEY` must be the **service_role/secret** key, not the anon key |
| A slot looks stuck | A Function died mid-call | It frees itself within 2 minutes (lease expiry) or at the next cron. To free one by hand: `SELECT public.release_call_slot('CA…', 'manual');` |
| Queued caller never connected | Twilio isn't reaching `/api/telephony/queue-wait` | Logs: `queue_poll` lines every ~15 s for that call. If missing, check the domain and signatures (403) |
| Follow-up is late | Normal on Hobby (15–30 min) | Logs: `cron_dispatch_done`. A **503** on `/api/cron/dispatch` means `CRON_SECRET` is missing |
| Variable "set" but the app says it's missing | Wrong name or case (e.g. `redis_url`, `Supabase_Url`), wrong scope (not Production), or not redeployed | Copy names exactly from section D, tick **Production**, then **Redeploy** |

---

## I. Removed services

The new version **does not use Redis or Upstash at all**: call capacity, the caller queue, after-call jobs and rate limits are in Supabase, and Live Calls uses Supabase Realtime. It also doesn't use OpenAI.

**When to remove the old pieces:** only **after** this version is deployed to Production and checklist G passes (at least tests 1–11). Then:
1. Vercel → Settings → Environment Variables → delete `REDIS_URL` (and any `redis_url`, `LIVE_EVENTS_TRANSPORT`, `OPENAI_API_KEY`) → Redeploy.
2. Upstash console → the VOXERA Redis database → **Settings → Delete database**.

Until then, leave them in place. They are harmless to the new code, and keeping them lets you roll back to the previous deployment (Vercel → Deployments → previous → **Promote to Production**) if anything goes wrong.
