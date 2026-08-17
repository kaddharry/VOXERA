# Testing real phone calls — local (ngrok) and production (AWS)

The `/demo` page's **Phone Call** mode, the admin **Try a Call** / **Bulk Calls** pages, and
real inbound calls to a registered Twilio number all need a public URL Twilio can reach. This
doc covers both environments: local development via ngrok, and the deployed AWS/ECS instance.

**Important — run `custom-server.ts`, not plain `next dev`.** The Twilio Media Stream
WebSocket (`/api/telephony/stream`) needs the raw Node `'upgrade'` event, which only
`custom-server.ts` handles — App Router route handlers and `next dev`'s default server both
return a 502/500 on the handshake (see the 2026-08-17 "real phone calls never streamed audio"
entry in `VOXERA_IMPLEMENTATION.md` for the full story). Locally, run:

```bash
npm run dev:full
```

not `npm run dev`. The `.claude/launch.json` dev preview config already points at
`dev:full` for this reason.

## 1. Required environment variables

Copy `.env.local.example` to `.env.local` and fill in (see that file for the full list):

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — from the [Twilio console](https://console.twilio.com). `TWILIO_PHONE_NUMBER` must be a real number on the account, not the placeholder value — outbound calls throw immediately otherwise.
- `DEEPGRAM_API_KEY` — for STT/TTS during the call.
- `GROQ_API_KEYS` / `ZENMUX_API_KEY` — for the LLM reply.
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — `call_logs` rows are written here.
- `DEFAULT_CLIENT_ID` — the Supabase user ID (auth UID) that owns calls to numbers not registered in `phone_numbers` (Settings → Phone Numbers & Inbound Routing). Registering the number there is the real fix — `DEFAULT_CLIENT_ID` is only the fallback.
- `NEXT_PUBLIC_BASE_URL` — the public URL Twilio can reach. **This is the one setting that differs between local and production** — see the two sections below.

## 2. Local development (ngrok)

```bash
ngrok http 3000
```

Copy the `https://<subdomain>.ngrok-free.dev` URL it prints, then:

1. Set `NEXT_PUBLIC_BASE_URL=https://<subdomain>.ngrok-free.dev` in `.env.local`.
2. Restart the dev server (`npm run dev:full`) — env vars are only read at process startup.
3. Point the Twilio number's Voice webhook at `https://<subdomain>.ngrok-free.dev/api/telephony/incoming` (Twilio console → Phone Numbers → your number → Voice Configuration → **A call comes in**).
4. Register the number in the app itself too: Settings → Phone Numbers & Inbound Routing → add it, optionally assign a specific agent.

**ngrok's free tier assigns a new random URL every time it restarts.** If you stop and restart
ngrok, repeat steps 1–3 with the new URL — the old webhook URL and `NEXT_PUBLIC_BASE_URL` value
both go stale. A paid ngrok static domain avoids this churn.

### Verifying it's actually working, not just "no errors"

A silent failure here looks identical to success until a real call comes in — the app will
answer, then go dead air. Two independent checks catch this before you ever dial a real
number:

```bash
# 1. The media-stream WebSocket must return 101, not 502/500.
node -e '
const WebSocket = require("ws");
const ws = new WebSocket("wss://<subdomain>.ngrok-free.dev/api/telephony/stream?callSid=t&clientId=x&caller=%2B1555");
ws.on("open", () => console.log("OK"));
ws.on("unexpected-response", (r,res) => console.log("FAIL", res.statusCode));
'

# 2. A correctly-signed webhook POST should return 200 + TwiML with a wss:// Stream URL —
# this exercises signature validation, the phone_numbers lookup, and TwiML generation
# without needing a real Twilio account to send the request.
```

**If check 1 times out**: that's exactly Twilio's own error 31901 ("Stream - WebSocket - Connection
Timeout") — the call will connect, play the greeting, then go dead the instant `<Connect><Stream>`
fires, no matter what's downstream. It means whatever's on port 3000 isn't actually running
`custom-server.ts` (plain `next dev`/`next-server` doesn't support the WS upgrade at all — see the top
of this doc). `lsof -ti:3000 | xargs kill -9` and restart with `npm run dev:full` if this happens; it
can silently regress if something else gets started on the same port later in a session.

**If the call connects and plays the greeting, but goes silent or drops the moment you speak**: check
the dev server's boot log for `[KeyRotator] No keys found in process.env.GROQ_API_KEYS`. `dev:full`
must load `.env.local` *before* its own imports run — `custom-server.ts` transitively imports the LLM
client at module scope, and ES imports are hoisted ahead of any in-file `dotenv.config()` call, so the
only thing that actually works is the `--env-file=.env.local` flag already baked into the `dev:full`
script. If you see that log line, something invoked `tsx custom-server.ts` directly instead of through
`npm run dev:full`.

## 3. Production (AWS / ECS)

The app is deployed at `https://vo-2882c61ad83f44399c60d35c29921a12.ecs.ap-south-1.on.aws`
already — **no ngrok involved here**. Set on the ECS task definition (not in any local file):

```
NEXT_PUBLIC_BASE_URL=https://vo-2882c61ad83f44399c60d35c29921a12.ecs.ap-south-1.on.aws
```

Point the Twilio number's Voice webhook at
`https://vo-2882c61ad83f44399c60d35c29921a12.ecs.ap-south-1.on.aws/api/telephony/incoming`
the same way as step 3 above.
Because the container runs `custom-server.ts` (see the Dockerfile), the WebSocket path works
the same way it does locally with `dev:full` — no extra configuration needed there.

**One Twilio number, one active webhook.** A given Twilio number can only point at one Voice
webhook at a time — if you're actively testing locally via ngrok, real inbound calls will hit
your laptop, not the deployed app, until you switch the webhook back. Buying a second Twilio
number for local testing avoids this back-and-forth entirely.

## 4. Test it

1. Start the server (`npm run dev:full` locally, or the deployed container in prod).
2. Open `/demo`, switch to **Phone Call** mode, enter your own number, click **Call Me** — or
   place an inbound call to the Twilio number directly.
3. Answer and speak — the transcript and live emotion metrics should appear within a couple
   seconds of each turn, and (if logged into `/admin`) the Dashboard's Live Call Monitor and
   Session History should reflect the call in real time / afterward.

## Notes

- `/api/telephony/outbound` is public and unauthenticated (by design, so anonymous `/demo`
  visitors can use it) but rate-limited to 1 call per 10 minutes per IP
  (`lib/telephony/rate-limit.ts`). Bulk campaigns (`/admin/campaigns`) go through the same
  underlying `placeOutboundCall` helper but aren't subject to that per-IP limit — they're
  behind admin auth instead, with their own concurrency cap (`lib/telephony/campaign-dispatcher.ts`).
- The live view does **not** show the per-engine (HuggingFace / Lexicon / Local ONNX)
  breakdown that the Text Demo shows — that's a deliberate choice, not a bug. Enabling full
  diagnostics on every phone call would add a real HuggingFace API call and local ONNX
  inference to every production call's latency and cost, not just demo ones. Phone calls
  show the same final emotion/VAD/CAI score the agent actually reasons from.
