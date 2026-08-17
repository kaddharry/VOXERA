import { createServer, type IncomingMessage } from "http";
import { parse } from "url";
import type { Socket } from "net";
import next from "next";
import { WebSocketServer } from "ws";
import { TelephonyStreamHandler } from "./lib/telephony/stream-handler";

/**
 * Local dev MUST run this via `npm run dev:full`, which passes
 * `--env-file=.env.local` to node directly. ES module imports (above) are
 * hoisted and evaluated before any other statement in this file runs, so a
 * `dotenv.config()` call here would execute too late to help — the
 * KeyRotator/Deepgram client/etc. imported transitively above already read
 * process.env at import time. This bit us once already: GROQ_API_KEYS came
 * back empty ("[KeyRotator] No keys found") when this file was briefly run
 * as plain `tsx custom-server.ts`, which silently broke every LLM call on
 * real phone calls placed against that instance. Production doesn't need
 * this — ECS injects env vars into the process before Node even starts.
 */

/**
 * Production entrypoint for the Next.js app, replacing `next start`.
 *
 * Why this exists: Twilio's <Connect><Stream> opens a raw WebSocket to
 * /api/telephony/stream to send/receive call audio. App Router route
 * handlers only ever see complete HTTP request/response cycles — Node's
 * 'upgrade' event (which is how WebSocket handshakes work) never reaches
 * them, regardless of any (req as any).socket tricks inside the handler.
 * Verified live: the old route-handler-based upgrade attempt returned a
 * 500/502 for every WS handshake against the deployed app, meaning every
 * real phone call connected via TwiML but then got silent dead air —
 * audio, transcript, and emotion data never flowed, so nothing ever
 * appeared live in the dashboard or sessions pages.
 *
 * The fix is the standard Next.js custom-server pattern: a plain Node
 * http.Server delegates normal requests to Next's handler, and separately
 * listens for 'upgrade' events to perform the WebSocket handshake itself
 * for the one path that needs it.
 */

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const telephonyWss = new WebSocketServer({ noServer: true });

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const { pathname, query } = parse(req.url || "/", true);

    if (pathname === "/api/telephony/stream") {
      telephonyWss.handleUpgrade(req, socket, head, (ws) => {
        const callSid = String(query.callSid || "unknown");
        const clientId = String(query.clientId || "demo");
        const callerNumber = String(query.caller || "unknown");
        const agentId = query.agentId ? String(query.agentId) : undefined;
        console.log(`[TelephonyStream] New connection: callSid=${callSid}${agentId ? ` agentId=${agentId}` : ""}`);
        new TelephonyStreamHandler({ ws, callSid, clientId, callerNumber, agentId });
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(port, () => {
    console.log(`> VOXERA ready on http://${hostname}:${port} (${dev ? "development" : "production"})`);
  });
});
