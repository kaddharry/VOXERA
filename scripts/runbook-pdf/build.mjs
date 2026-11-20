/**
 * Rebuilds docs/VOXERA_DEPLOYMENT_RUNBOOK.pdf from the Markdown source, so the
 * two always carry the same instructions.
 *   node scripts/runbook-pdf/build.mjs
 * Needs pandoc and Playwright with Chromium (npx playwright install chromium).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Playwright isn't a project dependency; it's resolved from wherever it's
// installed (global install / NODE_PATH), which only require() honours.
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const md = path.join(root, "docs/VOXERA_DEPLOYMENT_RUNBOOK.md");
const out = path.join(root, "docs/VOXERA_DEPLOYMENT_RUNBOOK.pdf");
const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");

const body = execFileSync("pandoc", [md, "-f", "gfm", "-t", "html5", "--no-highlight"], { encoding: "utf8" });
const html = `<!doctype html><html><head><meta charset="utf-8"><title>VOXERA deployment runbook</title><style>${css}</style></head><body>${body}</body></html>`;
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "runbook-")), "runbook.html");
fs.writeFileSync(tmp, html);

{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${tmp}`, { waitUntil: "load" });
  await page.pdf({
    path: out,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: '<div style="font-size:7pt;width:100%;text-align:center;color:#777">VOXERA deployment runbook · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
  });
  await browser.close();
  console.log(`Wrote ${path.relative(root, out)}`);
}
