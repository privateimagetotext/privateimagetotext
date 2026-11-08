import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpusDirectory = path.join(repositoryRoot, "e2e", "fixtures", "ocr-corpus");
const manifest = JSON.parse(
  await readFile(path.join(corpusDirectory, "manifest.json"), "utf8"),
);

const layouts = {
  "clean-screenshot": { width: 1200, height: 560, className: "screenshot" },
  "uneven-lighting": { width: 1100, height: 1450, className: "uneven" },
  receipt: { width: 720, height: 1220, className: "receipt" },
  "small-font": { width: 620, height: 380, className: "small" },
  "skew-three-degrees": { width: 1100, height: 760, className: "skew" },
  "punctuation-ambiguous": { width: 1200, height: 560, className: "ambiguous" },
  "code-terminal": { width: 1200, height: 760, className: "code" },
  "dark-background": { width: 1100, height: 620, className: "dark" },
  "two-column-document": { width: 1400, height: 980, className: "columns" },
  "two-column-no-divider": {
    width: 1500,
    height: 1080,
    className: "columns columns-plain",
  },
  "two-column-spanning-heading": {
    width: 1500,
    height: 1120,
    className: "columns-heading",
  },
  "long-receipt": { width: 900, height: 8000, className: "long-receipt" },
  "long-printed-page": { width: 1600, height: 7200, className: "long-page" },
};

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function contentMarkup(id, groundTruth) {
  const escaped = escapeHtml(groundTruth.trimEnd());
  if (id === "two-column-document" || id === "two-column-no-divider") {
    const lines = groundTruth.trimEnd().split("\n");
    const splitAt = id === "two-column-document" ? 4 : 5;
    return `<div class="column"><pre>${escapeHtml(lines.slice(0, splitAt).join("\n"))}</pre></div>
      <div class="column"><pre>${escapeHtml(lines.slice(splitAt).join("\n"))}</pre></div>`;
  }
  if (id === "two-column-spanning-heading") {
    const lines = groundTruth.trimEnd().split("\n");
    return `<header><pre>${escapeHtml(lines.slice(0, 2).join("\n"))}</pre></header>
      <div class="heading-columns">
        <div class="column"><pre>${escapeHtml(lines.slice(2, 6).join("\n"))}</pre></div>
        <div class="column"><pre>${escapeHtml(lines.slice(6).join("\n"))}</pre></div>
      </div>`;
  }
  if (id === "uneven-lighting") {
    return `<div class="paper"><pre>${escaped}</pre><div class="cast-shadow"></div></div>`;
  }
  if (id === "skew-three-degrees") {
    return `<div class="rotated-paper"><pre>${escaped}</pre></div>`;
  }
  if (id === "long-receipt" || id === "long-printed-page") {
    return `<div class="long-lines">${groundTruth
      .trimEnd()
      .split("\n")
      .map((line) => `<div>${escapeHtml(line)}</div>`)
      .join("")}</div>`;
  }
  return `<pre>${escaped}</pre>`;
}

const sharedCss = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; }
  #fixture { overflow: hidden; position: relative; }
  pre { margin: 0; white-space: pre-wrap; font-family: Arial, sans-serif; }
  .screenshot {
    padding: 72px 84px; color: #172033; background: #eef3f8;
    border: 12px solid #1c8a78; box-shadow: inset 0 72px #d7e5e2;
  }
  .screenshot pre { padding: 50px; font-size: 42px; line-height: 1.55; background: white; border-radius: 18px; }
  .uneven { padding: 70px; background: #b9b3a7; }
  .uneven .paper { position: relative; width: 100%; height: 100%; padding: 120px 100px; background: linear-gradient(118deg, #f8f4e9 8%, #e8dfca 48%, #fffdf5 100%); }
  .uneven pre { position: relative; z-index: 1; color: #28241f; font-family: Georgia, serif; font-size: 37px; line-height: 1.75; }
  .uneven pre::first-line { font-size: 54px; font-weight: 700; }
  .cast-shadow { position: absolute; z-index: 2; inset: 0; pointer-events: none; background: linear-gradient(103deg, transparent 4%, rgba(44, 31, 20, .30) 42%, rgba(44, 31, 20, .05) 64%, transparent 78%); mix-blend-mode: multiply; }
  .receipt { padding: 70px 58px; color: #191919; background: #fdfcf7; border: 1px solid #ddd5c5; }
  .receipt pre { font-family: "Courier New", monospace; font-size: 28px; line-height: 2.1; }
  .small { padding: 44px 38px; color: #1b2430; background: white; }
  .small pre { font-family: Georgia, serif; font-size: 17px; line-height: 1.6; }
  .skew { padding: 70px; background: #d9d4ca; }
  .rotated-paper { width: 940px; height: 610px; padding: 80px 70px; color: #171717; background: white; transform: rotate(3deg); transform-origin: center; box-shadow: 0 8px 24px rgba(0,0,0,.22); }
  .skew pre { font-family: Georgia, serif; font-size: 37px; line-height: 1.7; }
  .ambiguous { padding: 68px; color: #111827; background: white; border: 10px solid #dce2e8; }
  .ambiguous pre { font-family: "Courier New", monospace; font-size: 43px; line-height: 1.65; }
  .code { padding: 74px; color: #d7f7e8; background: #101722; border-top: 58px solid #253044; }
  .code pre { font-family: "Courier New", monospace; font-size: 34px; line-height: 1.55; }
  .dark { padding: 78px 84px; color: #f5f7fa; background: #111827; border: 8px solid #374151; }
  .dark pre { font-family: Arial, sans-serif; font-size: 43px; line-height: 1.7; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 70px; padding: 92px 84px; color: #202020; background: #fffef9; }
  .columns .column + .column { border-left: 3px solid #c8c4b8; padding-left: 68px; }
  .columns pre { font-family: Georgia, serif; font-size: 31px; line-height: 1.75; }
  .columns-plain { gap: 132px; padding: 105px 96px; background: #fff; }
  .columns-plain .column + .column { border-left: 0; padding-left: 0; }
  .columns-heading { padding: 78px 92px 96px; color: #202020; background: #fffef9; }
  .columns-heading header { padding-bottom: 48px; border-bottom: 3px solid #b8b3a5; text-align: center; }
  .columns-heading header pre { font: 700 39px/1.45 Georgia, serif; }
  .heading-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 126px; padding-top: 55px; }
  .heading-columns pre { font: 31px/1.75 Georgia, serif; }
  .long-lines { height: 100%; display: flex; flex-direction: column; justify-content: space-between; }
  .long-receipt { padding: 90px 68px; color: #171717; background: #fffdf7; border: 2px solid #d6cfbf; }
  .long-receipt .long-lines { font: 24px/1.25 "Courier New", monospace; }
  .long-page { padding: 110px 130px; color: #20201d; background: linear-gradient(110deg, #fffef8, #eee9dc 48%, #fffdf7); }
  .long-page .long-lines { font: 28px/1.35 Georgia, serif; }
`;

const requestedFixtureIds = new Set(process.argv.slice(2));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const fixture of manifest.fixtures) {
    if (requestedFixtureIds.size > 0 && !requestedFixtureIds.has(fixture.id)) {
      continue;
    }
    const layout = layouts[fixture.id];
    if (!layout) throw new Error(`Missing layout for ${fixture.id}`);
    const groundTruth = await readFile(
      path.join(corpusDirectory, fixture.groundTruth),
      "utf8",
    );
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.setContent(`<!doctype html><html><head><style>${sharedCss}</style></head><body>
      <div id="fixture" class="${layout.className}" style="width:${layout.width}px;height:${layout.height}px">
        ${contentMarkup(fixture.id, groundTruth)}
      </div></body></html>`);
    await page.locator("#fixture").screenshot({
      path: path.join(corpusDirectory, fixture.image),
      animations: "disabled",
    });
  }
} finally {
  await browser.close();
}
