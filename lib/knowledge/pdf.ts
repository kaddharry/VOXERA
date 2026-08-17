import { CONFIG } from "../config";

/**
 * All PDF handling (plain text extraction AND OCR rendering) lives in this
 * one file, sharing a single pdfjs-dist import.
 *
 * This used to be split across pdf-parse (text extraction) and a separate
 * direct pdfjs-dist import (OCR rendering) — but pdf-parse depends on its
 * own bundled, different-versioned pdfjs-dist copy
 * (node_modules/pdf-parse/node_modules/pdfjs-dist), and having BOTH
 * versions loaded in the same process broke pdfjs-dist's worker-thread
 * version check ("API version does not match the Worker version"), live-
 * verified reproducible regardless of workerSrc pinning via require.resolve
 * or import.meta.resolve — Node's module resolution for the two coexisting
 * copies was not reliably picking the same one the API module itself came
 * from. Dropping pdf-parse and doing text extraction via pdfjs-dist's own
 * `getTextContent()` API removes the second copy entirely, which is the
 * only thing that actually fixed it (verified live, not assumed).
 */

let workerConfigured = false;

async function getPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!workerConfigured) {
    // pdfjs-dist's fake-worker setup (the path it always takes server-side
    // in Node — there's no window/DOM to spin up a same-origin Worker())
    // internally does `await import(this.workerSrc)` with `/*webpackIgnore:
    // true*/`/`/*@vite-ignore*/` pragmas telling those bundlers to leave it
    // alone — but Turbopack (Next.js's default dev server since v15)
    // doesn't recognize either pragma and rewrites that dynamic import
    // through its own "[project]" virtual module graph regardless of what
    // string value it's actually passed, throwing "Cannot find package
    // '[project]' imported from .../pdf.mjs". Live-verified reproducible
    // only through the real running dev server hitting POST
    // /api/knowledge/upload — every tsx-based standalone test of this exact
    // code passed, since tsx has no bundler in the loop, and no combination
    // of workerSrc value (require.resolve, import.meta.resolve, a plain
    // process.cwd()-built path, a file:// URL via pathToFileURL) changed
    // the outcome, confirming the interception isn't about the runtime
    // string value at all — Turbopack instruments the `import()` CALL SITE
    // inside pdf.mjs itself.
    //
    // The actual fix: skip that dynamic import entirely. pdfjs-dist's
    // fake-worker loader checks `globalThis.pdfjsWorker?.WorkerMessageHandler`
    // FIRST and only falls through to `import(this.workerSrc)` if that's
    // unset — this is pdfjs-dist's own documented mechanism for exactly
    // this situation (a bundler that can't handle its dynamic worker
    // import). Statically importing the worker module ourselves (a normal
    // top-level import Turbopack handles fine, since pdfjs-dist is listed
    // in next.config.ts's serverExternalPackages) and pre-populating that
    // global means the problematic dynamic import is never reached at all.
    const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as unknown as { pdfjsWorker?: { WorkerMessageHandler: unknown } }).pdfjsWorker = {
      WorkerMessageHandler: workerModule.WorkerMessageHandler,
    };
    workerConfigured = true;
  }
  return pdfjs;
}

/**
 * True if `text` looks like genuine extracted content rather than an empty
 * or near-empty result.
 */
function looksLikeRealText(text: string): boolean {
  return text.trim().length >= CONFIG.knowledge.minRealTextChars;
}

/**
 * Extracts plain text from a PDF's real text layer (page.getTextContent()).
 * Returns "" (not an error) when a page has no text items — the caller
 * decides whether that's grounds for an OCR fallback.
 */
async function extractTextLayer(content: Buffer | Uint8Array): Promise<string> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(content);
  const doc = await pdfjs.getDocument({ data }).promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pageTexts.push(pageText);
  }
  return pageTexts.join("\n\n");
}

/**
 * OCR fallback for PDFs with no real text layer — live-verified necessary:
 * a real graphic-design menu PDF (all "text" rendered as vector paths /
 * outlined fonts, no selectable text content at all, the kind design tools
 * like Canva commonly export) has zero text items via getTextContent() on
 * every page. Renders each page to a bitmap via pdfjs-dist + @napi-rs/canvas
 * (no native toolchain required, unlike node-canvas — that needs Cairo/
 * pkg-config via a system package manager, confirmed unavailable in this
 * environment), then runs tesseract.js against each page image.
 *
 * Ingest-time only — this is genuinely slow (multiple seconds per page,
 * confirmed live) and never runs on the live-call turn path, only when a
 * document is first uploaded.
 */
async function ocrPdf(content: Buffer | Uint8Array): Promise<string> {
  const pdfjs = await getPdfjs();
  const { createCanvas } = await import("@napi-rs/canvas");
  const { createWorker } = await import("tesseract.js");

  const data = new Uint8Array(content);
  const doc = await pdfjs.getDocument({ data }).promise;
  const pageCount = Math.min(doc.numPages, CONFIG.knowledge.ocrMaxPages);

  const worker = await createWorker("eng");
  try {
    const pageTexts: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      // 2.5x scale: verified live as a good accuracy/speed tradeoff for
      // typical menu/flyer-style PDFs — noticeably worse OCR accuracy at
      // 1x (native PDF point resolution is too low-res for small text).
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
        canvas: canvas as unknown as HTMLCanvasElement,
      }).promise;
      const png = canvas.toBuffer("image/png");
      const { data: ocrResult } = await worker.recognize(png);
      pageTexts.push(ocrResult.text);
    }
    return pageTexts.join("\n\n");
  } finally {
    await worker.terminate();
  }
}

/**
 * Full PDF text extraction: tries the real text layer first (fast, exact),
 * falls back to OCR when the document has no usable text layer at all.
 */
export async function extractPdfText(content: Buffer | Uint8Array): Promise<string> {
  const textLayerResult = await extractTextLayer(content);
  if (looksLikeRealText(textLayerResult)) return textLayerResult;

  console.warn("[PDF] No real text layer found — falling back to OCR");
  return ocrPdf(content);
}
