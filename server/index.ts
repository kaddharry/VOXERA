// Keep first — loads .env.local before any lib/* module reads process.env.
import "./env";

import { createServer } from "node:http";
import { parse } from "node:url";
import path from "node:path";
import next from "next";
import { WebSocketServer } from "ws";
import { TelephonyStreamHandler } from "../lib/telephony/stream-handler";

const dir = path.resolve(__dirname, "..");
const port = parseInt(process.env.PORT ?? "3000", 10);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

const app = next({ dev: false, dir, hostname, port });
const handle = app.getRequestHandler();

// noServer: this process owns the HTTP listener; we drive the handshake.
// A route handler can never do this — NextRequest carries no Node socket.
const wss = new WebSocketServer({ noServer: true });

async function main() {
  await app.prepare();

  const server = createServer((req, res) => {
    handle(req, res, parse(req.url ?? "/", true)).catch((err) => {
      console.error("[server] request error:", err);
      res.statusCode = 500;
      res.end("internal error");
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname, query } = parse(req.url ?? "", true);

    if (pathname !== "/api/telephony/stream") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const callSid = (query.callSid as string) || "unknown";
      const clientId = (query.clientId as string) || "demo";
      const callerNumber = (query.caller as string) || "unknown";

      console.log(`[TelephonyStream] upgrade accepted: callSid=${callSid}`);

      // TelephonyStreamHandler takes over from here — full audio loop
      new TelephonyStreamHandler({ ws, callSid, clientId, callerNumber });
    });
  });

  server.listen(port, hostname, () => {
    console.log(`▶ VOXERA ready on http://${hostname}:${port}  (ws: /api/telephony/stream)`);
  });
}

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
