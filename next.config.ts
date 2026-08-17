import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * NOT "standalone" — the app now runs behind custom-server.ts (a plain
   * Node http.Server) instead of `next start`, so it can handle the raw
   * WebSocket 'upgrade' event for Twilio's Media Stream connection at
   * /api/telephony/stream. That event never reaches App Router route
   * handlers (verified: the old route-handler-based upgrade attempt
   * returned 500/502 on every real handshake), so a custom server is the
   * only reliable way to accept it. Standalone output's auto-generated
   * server.js doesn't know about custom servers, so it's dropped in favor
   * of a full build + full node_modules at runtime (see Dockerfile).
   */
  /**
   * pdfjs-dist dynamically resolves its own worker script (pdf.worker.mjs)
   * relative to a real node_modules path at runtime (lib/knowledge/pdf.ts
   * pins it explicitly via import.meta.resolve()). When Next.js bundles it
   * into a hashed .next/dev/server/chunks/ path instead, that resolution
   * breaks — "Setting up fake worker failed: Cannot find module
   * '.../.next/dev/server/chunks/pdf.worker.mjs'" on every PDF knowledge-
   * base upload. Marking it external skips bundling for server code, so
   * Node's normal require/import resolves it from its real location in
   * node_modules instead. tesseract.js and @napi-rs/canvas (OCR fallback
   * for PDFs with no real text layer, see pdf.ts) have the same kind of
   * runtime asset/worker resolution and need the same treatment. (pdf-parse
   * was removed — it depended on its own separate, differently-versioned
   * pdfjs-dist copy, which broke pdfjs-dist's worker version check when
   * both were loaded in the same process; text extraction now goes through
   * pdfjs-dist directly instead.)
   */
  serverExternalPackages: ["pdfjs-dist", "tesseract.js", "@napi-rs/canvas"],
  /**
   * Next.js blocks cross-origin dev requests (including the HMR websocket
   * at /_next/webpack-hmr) unless the requesting origin is explicitly
   * allowlisted. Without this, opening the dev server via a LAN IP
   * (e.g. http://172.17.12.139:3000) instead of localhost loads the page
   * but silently breaks hot-reload — the exact "WebSocket connection to
   * '.../_next/webpack-hmr' failed" loop.
   *
   * Add your machine's LAN IP here (or a teammate's, when sharing your
   * dev server) if you need cross-device dev access. This only affects
   * `next dev` — it has no effect on production.
   */
  allowedDevOrigins: ["172.17.12.139"],
};

export default nextConfig;
