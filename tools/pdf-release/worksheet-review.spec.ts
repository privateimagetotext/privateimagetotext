import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { root, sha256, type BuildManifest } from "./offline-helpers";

type CorpusPage = { number: number; expectedMethod: string; expectedTokens: string[]; minimumCharacters: number };
type CorpusCase = { id: string; kind: string; filename: string; bytes: number; sha256: string; pages: CorpusPage[] };
const corpusBytes = readFileSync(path.join(import.meta.dirname, "corpus.json"));
const corpus = JSON.parse(corpusBytes.toString("utf8")) as { cases: CorpusCase[] };
if (sha256(corpusBytes) !== "fc702260a034ec5292507661446cb160be090802ce42ffa6faeb79759c91f78d") throw new Error("Original corpus changed.");
const selected = corpus.cases.filter((entry) => ["cfpb-savings", "cfpb-cashflow", "cfpb-spending", "cfpb-debt"].includes(entry.id));
if (selected.length !== 4 || selected.some((entry) => entry.kind !== "real-document" || entry.pages.length !== 2)) throw new Error("Unexpected worksheet selection.");
const buildId = "a270885f41a0401155c66f17331d525c3059009ba37d92777dc560cb457d0e40";
const htmlHash = "47a8b6a52ad4549a3d4a766e538e25e207ba4d34e28df8d7eb81e1e6370932d5";
const pending = new WeakMap<Page, Record<string, unknown>>();
const normalise = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();

test.afterEach(async ({ page }, info) => {
  const evidence = pending.get(page);
  if (!evidence) return;
  Object.assign(evidence, { status: info.status, assertionFailures: info.errors.length });
  const filename = info.outputPath("evidence.json");
  await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`);
  await info.attach("worksheet-review-evidence", { path: filename, contentType: "application/json" });
  pending.delete(page);
});

for (const entry of selected) {
  test(`capture complete worksheet output ${entry.id}`, async ({ page, context, request, browser, baseURL }, info) => {
    const pages: Record<string, unknown>[] = [];
    const paths: string[] = [];
    const outsideOrigins: string[] = [];
    const nonReadRequests: string[] = [];
    const pageErrors: string[] = [];
    const evidence: Record<string, unknown> = {
      source: { id: entry.id, filename: entry.filename, bytes: entry.bytes, sha256: entry.sha256 },
      corpusManifestSha256: sha256(corpusBytes), buildId, htmlHash,
      browserProject: info.project.name, browserVersion: browser.version(), checkedAt: new Date().toISOString(),
      pages, paths, outsideOrigins, nonReadRequests, pageErrors,
      scope: "New full-output capture for eight previously selected public worksheet pages; native PDF pipeline, no injected text, service workers blocked. Execution/token checks do not certify visual fidelity or owner usefulness acceptance.",
    };
    pending.set(page, evidence);
    const stateResponse = await request.get(new URL("/__pdf-validation__/state", baseURL!).href);
    expect(stateResponse.ok()).toBe(true);
    const state = await stateResponse.json() as { buildId: string; buildManifest: BuildManifest; fault: unknown; networkDisabled: boolean };
    expect(state.buildId).toBe(buildId); expect(state.fault).toBeNull(); expect(state.networkDisabled).toBe(false);
    const origin = new URL(baseURL!).origin;
    const allowedPaths = new Set(state.buildManifest.files.map((file) => `/${file.path}`));
    allowedPaths.add("/pdf-to-text");
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && (url.origin !== origin || !allowedPaths.has(url.pathname))) await route.abort("blockedbyclient");
      else await route.continue();
    });
    context.on("request", (item) => {
      const url = new URL(item.url());
      if (!["http:", "https:"].includes(url.protocol)) return;
      paths.push(url.pathname);
      if (url.origin !== origin) outsideOrigins.push(url.origin);
      if (!["GET", "HEAD"].includes(item.method())) nonReadRequests.push(item.method());
    });
    page.on("pageerror", (error) => pageErrors.push(error.name));
    const response = await page.goto("/pdf-to-text");
    expect(response?.status()).toBe(200); expect(sha256(await response!.body())).toBe(htmlHash);
    await expect(page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." })).toBeVisible();
    const pdf = await readFile(path.join(root, "tmp/pdf-release-corpus", entry.filename));
    expect(pdf.length).toBe(entry.bytes); expect(sha256(pdf)).toBe(entry.sha256);
    await page.getByLabel("Choose one PDF").setInputFiles({ name: entry.filename, mimeType: "application/pdf", buffer: pdf });
    await expect(page.getByRole("heading", { level: 2, name: entry.filename })).toBeVisible();
    await page.getByRole("radio", { name: "Page range", exact: true }).check();
    await page.getByLabel("Pages to process").fill(entry.pages.map((item) => item.number).join(","));
    await page.locator('input[name="pdf-extraction-method"][value="automatic"]').check();
    await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
    await expect(page.locator(".pdf-results")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel processing", exact: true })).toHaveCount(0);
    for (const expected of entry.pages) {
      await page.locator(".pdf-page-list button").filter({ has: page.getByText(`Page ${expected.number}`, { exact: true }) }).click();
      const editor = page.getByLabel(`Editable text for page ${expected.number}`, { exact: true });
      await expect(editor).toBeVisible();
      const text = await editor.inputValue();
      const filename = info.outputPath(`page-${expected.number}-public-fixture-output.txt`);
      await writeFile(filename, text);
      await info.attach(`public-fixture-page-${expected.number}`, { path: filename, contentType: "text/plain; charset=utf-8" });
      const method = await page.locator(".pdf-method-badge").innerText();
      const tokenChecks = expected.expectedTokens.map((token) => ({ token, present: normalise(text).includes(normalise(token)) }));
      pages.push({ page: expected.number, characters: text.length, outputSha256: sha256(text), outputPath: path.relative(root, filename), method, tokenChecks, warnings: await page.locator(".pdf-page-warnings li").allTextContents(), safeErrors: await page.locator(".pdf-page-editor .pdf-control-error").allTextContents(), manualSourceReview: "Pending separate full visual comparison" });
      expect.soft(method).toBe(expected.expectedMethod);
      expect.soft(text.length).toBeGreaterThanOrEqual(expected.minimumCharacters);
      for (const token of tokenChecks) expect.soft(token.present, token.token).toBe(true);
    }
    expect(outsideOrigins).toEqual([]); expect(nonReadRequests).toEqual([]); expect(pageErrors).toEqual([]);
    expect(paths.some((pathname) => pathname.startsWith("/ocr/"))).toBe(false);
    await page.getByRole("button", { name: "Clear PDF", exact: true }).click();
    await page.getByRole("dialog", { name: "Clear this PDF and its results?" }).getByRole("button", { name: "Clear PDF", exact: true }).click();
    await expect(page.locator(".pdf-results")).toHaveCount(0);
  });
}
