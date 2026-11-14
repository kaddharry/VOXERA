import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * NOT "standalone": the Docker/local setup runs behind custom-server.ts
   * (a plain Node http.Server that accepts the Twilio Media Stream upgrade
   * itself), and standalone output's generated server.js doesn't know about
   * custom servers. On Vercel, custom-server.ts is not used at all: the
   * App Router route app/api/telephony/stream accepts the WebSocket through
   * @vercel/functions' upgradeWebSocket() (Fluid Compute, vercel.json).
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
   * @xenova/transformers (the local embedder and emotion models) runs on
   * onnxruntime-node, whose onnxruntime_binding.node loads the native
   * libonnxruntime.so.1.14.0 next to it. Vercel's file tracing follows the
   * JS require of the .node binding but not that native library load, so
   * deployed Functions shipped without it: importing the models failed with
   * "libonnxruntime.so.1.14.0: cannot open shared object file", which took
   * down every route that imports them at load time — including the Twilio
   * Media Stream WebSocket (/api/telephony/stream), so calls hung up right
   * after "Please hold" with Twilio error 31920. Ship the library with the
   * API routes explicitly (Linux x64 only, which is what Vercel runs; ~16MB).
   */
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime.so.1.14.0"],
  },
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
