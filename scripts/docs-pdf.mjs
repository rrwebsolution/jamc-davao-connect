// Builds docs/JAMC-Davao-Connect-User-Manual.pdf from the Markdown manual and
// its screenshots:  npm run docs:pdf
//
// The Markdown is converted with `marked` (fetched by npx for this run only,
// not added to the project), styled for print, and printed to PDF by Microsoft
// Edge. The Markdown file stays the source; run this again after editing it.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE = "docs/JAMC-Davao-Connect-User-Manual.md";
const HTML = "docs/.manual-print.html"; // next to the screenshots, so their relative paths work
const PDF = "docs/JAMC-Davao-Connect-User-Manual.pdf";
const EDGE =
  process.env.EDGE_PATH ??
  ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!EDGE) throw new Error("Microsoft Edge was not found. Set EDGE_PATH.");

const body = execSync(`npx -y marked@15.0.12 --gfm -i "${SOURCE}"`, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  // GitHub-style callouts: > [!NOTE] → a labelled box.
  .replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING)\]\s*/g, (_, kind) => `<blockquote class="callout ${kind.toLowerCase()}"><p><strong>${kind}</strong><br>`);

writeFileSync(
  HTML,
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>JAMC Davao Connect — User Manual</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font: 10.5pt/1.55 "Segoe UI", Roboto, Arial, sans-serif; color: #1c1917; }
  h1 { font-size: 26pt; margin: 0 0 4pt; color: #14532d; }
  h2 { font-size: 16pt; margin: 22pt 0 8pt; padding-bottom: 4pt; border-bottom: 2px solid #d6d3d1; color: #14532d; break-after: avoid; }
  h1 + h2 { border: 0; font-size: 14pt; color: #44403c; }
  h3 { font-size: 12.5pt; margin: 16pt 0 6pt; break-after: avoid; }
  h2:not(:first-of-type) { break-before: page; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9.5pt; break-inside: avoid; }
  th, td { border: 1px solid #d6d3d1; padding: 4pt 6pt; vertical-align: top; text-align: left; }
  th { background: #f5f5f4; }
  /* Tables written with an empty header row (label | value lists): no grey empty row. */
  thead:has(th:empty + th:empty:last-child) { display: none; }
  img { max-width: 100%; max-height: 190mm; border: 1px solid #d6d3d1; border-radius: 6px; display: block; margin: 8pt auto 4pt; }
  td img { max-height: 120mm; }
  p > img + br { display: none; }
  pre { background: #f5f5f4; border-radius: 6px; padding: 8pt; white-space: pre-wrap; font-size: 9.5pt; break-inside: avoid; }
  code { font-family: Consolas, monospace; font-size: 9.5pt; }
  blockquote.callout { margin: 10pt 0; padding: 6pt 10pt; border-left: 4px solid #2563eb; background: #eff6ff; break-inside: avoid; }
  blockquote.important { border-color: #b45309; background: #fffbeb; }
  blockquote.warning { border-color: #dc2626; background: #fef2f2; }
  blockquote.tip { border-color: #15803d; background: #f0fdf4; }
  a { color: #15803d; text-decoration: none; }
  hr { display: none; }
</style></head><body>${body}</body></html>`,
);

const result = spawnSync(EDGE, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${resolve(PDF)}`, pathToFileURL(resolve(HTML)).href], {
  stdio: "ignore",
  timeout: 180_000,
});
// KEEP_HTML=1 keeps the print page, to look at the layout in a browser.
if (!process.env.KEEP_HTML) rmSync(HTML, { force: true });
if (result.status !== 0 || !existsSync(PDF)) throw new Error("Edge could not print the PDF.");
console.log(`Saved ${PDF} (${Math.round(readFileSync(PDF).length / 1024)} KB)`);
