import { WebSocketServer, WebSocket } from "ws";
import { DEMO } from "./lib/bootstrap";
import { config } from "dotenv";
import { warmupModels } from "./lib/warmup";
import { TestAgentStreamHandler } from "./lib/testagent/stream-handler";

// Belt-and-suspenders env loading: `npm run server` passes `--env-file=.env.local`
// to tsx/node directly, which is what actually matters — ES module imports are
// hoisted and run before any top-level statement in this file, so module-level
// singletons that read process.env at import time (e.g. lib/util/keys.ts's
// KeyRotator, imported transitively via TestAgentStreamHandler below) would
// otherwise permanently capture an empty env var if dotenv only loaded here.
config({ path: ".env.local" });

// See lib/warmup.ts — avoids paying ONNX model cold-load cost on whichever
// turn happens to be first.
void warmupModels();

const PORT = process.env.REALTIME_SERVER_PORT ? Number(process.env.REALTIME_SERVER_PORT) : 3001;
const wss = new WebSocketServer({ port: PORT });

console.log(`\n🚀 VOXERA Real-Time Audio Server starting on ws://localhost:${PORT}`);

/**
 * Local-dev-only entrypoint for the "Live Test Call" admin feature
 * (app/_components/TestAgentDrawer.tsx) — a standalone `ws` WebSocketServer
 * on its own port, started via `npm run server` / `npm run dev:full`. The
 * deployed app instead serves this over app/api/test-agent/stream/route.ts
 * (a Vercel Function using `upgradeWebSocket`), since Vercel never runs
 * this file. Both hosts delegate the actual per-connection logic to
 * lib/testagent/stream-handler.ts's TestAgentStreamHandler, so there's
 * exactly one implementation of the STT/TTS/emotion/barge-in pipeline.
 */
wss.on("connection", (ws: WebSocket, request) => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  new TestAgentStreamHandler({
    ws,
    agentId: requestUrl.searchParams.get("agentId") || undefined,
    clientId: requestUrl.searchParams.get("clientId") || DEMO.clientId,
    patientId: requestUrl.searchParams.get("patientId") || undefined,
  });
});
