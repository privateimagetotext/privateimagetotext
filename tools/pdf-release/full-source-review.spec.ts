import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { root, sha256, type BuildManifest } from "./offline-helpers";

type CorpusPage = { number: number; expectedMethod: string; expectedTokens: string[]; minimumCharacters: number };
type CorpusCase = { id: string; kind: string; filename: string; bytes: number; sha256: string; pages: CorpusPage[] };
type Workers = { pdfCreated: number; pdfModuleWorkers: number; pdfMessages: number; ocrCreated: number; active: number; maximumActive: number };
const corpusBytes = readFileSync(path.join(import.meta.dirname, "corpus.json"));
const corpus = JSON.parse(corpusBytes.toString("utf8")) as { cases: CorpusCase[] };
if (sha256(corpusBytes) !== "fc702260a034ec5292507661446cb160be090802ce42ffa6faeb79759c91f78d") throw new Error("Original corpus changed.");
const selected = corpus.cases.filter(entry => entry.kind === "real-document" && !entry.id.startsWith("cfpb-"));
if (selected.length !== 16 || selected.some(entry => !/^(?:nist|irs)-/u.test(entry.id) || entry.pages.length !== 2)) throw new Error("Unexpected remaining source-review selection.");
const buildId = "bec522230289bdaa1ef063561690034147a1be0bcaafd13fc0f2b31cba2501e2";
const artifactManifestPath = path.join(root, "tmp/pdf-worksheet-review-20260906/private-build.json");
const artifactManifestBytes = readFileSync(artifactManifestPath);
const artifact = JSON.parse(artifactManifestBytes.toString("utf8")) as BuildManifest;
if (artifact.manifestSha256 !== buildId) throw new Error("Expected frozen private artifact changed.");
const htmlHash = artifact.files.find(file => file.path === "pdf-to-text.html")!.sha256;
const pending = new WeakMap<Page, Record<string, unknown>>();
const normalise = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();

test.afterEach(async ({ page }, info) => {
  const evidence = pending.get(page);
  if (!evidence) return;
  Object.assign(evidence, { status: info.status, assertionFailures: info.errors.length });
  const filename = info.outputPath("evidence.json");
  await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`);
  await info.attach("full-source-review-evidence", { path: filename, contentType: "application/json" });
  pending.delete(page);
});

for (const entry of selected) {
  test(`capture complete public source output ${entry.id}`, async ({ page, context, request, browser, baseURL }, info) => {
    const pages: Record<string, unknown>[] = [];
    const paths: string[] = [], outsideOrigins: string[] = [], unexpectedPaths: string[] = [], nonReadRequests: string[] = [], pageErrors: string[] = [];
    const evidence: Record<string, unknown> = {
      source: { id: entry.id, filename: entry.filename, bytes: entry.bytes, sha256: entry.sha256 },
      corpusManifestSha256: sha256(corpusBytes), artifactManifestFileSha256: sha256(artifactManifestBytes), buildId, htmlHash,
      browserProject: info.project.name, browserVersion: browser.version(), checkedAt: new Date().toISOString(),
      pages, paths, outsideOrigins, unexpectedPaths, nonReadRequests, pageErrors,
      scope: "Complete-output capture of the original 32 NIST/NBS and IRS selected public pages in Automatic mode. Native PDF/OCR pipeline, no injected outcomes; service workers blocked. Token/method checks do not certify full visual fidelity or owner usefulness acceptance.",
      independentSourceManifest: "tmp/pdf-full-source-review-20260906/source/manifest.json",
      workerObservationScope: "Main-thread native Worker construction/termination and PDF messages only; excludes worker-internal allocations and physical memory.",
    };
    pending.set(page, evidence);
    const stateResponse = await request.get(new URL("/__pdf-validation__/state", baseURL!).href);
    expect(stateResponse.ok()).toBe(true);
    const state = await stateResponse.json() as { buildId: string; buildManifest: BuildManifest; fault: unknown; networkDisabled: boolean };
    expect(state.buildId).toBe(buildId); expect(state.fault).toBeNull(); expect(state.networkDisabled).toBe(false);
    const origin = new URL(baseURL!).origin;
    const allowedPaths = new Set(state.buildManifest.files.map(file => `/${file.path}`));
    allowedPaths.add("/pdf-to-text");
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && (url.origin !== origin || !allowedPaths.has(url.pathname))) await route.abort("blockedbyclient");
      else await route.continue();
    });
    context.on("request", item => {
      const url = new URL(item.url());
      if (!["http:", "https:"].includes(url.protocol)) return;
      paths.push(url.pathname);
      if (url.origin !== origin) outsideOrigins.push(url.origin);
      if (!allowedPaths.has(url.pathname)) unexpectedPaths.push(url.pathname);
      if (!["GET", "HEAD"].includes(item.method())) nonReadRequests.push(item.method());
    });
    page.on("pageerror", error => pageErrors.push(error.name));
    await page.addInitScript(() => {
      const workers: Workers = { pdfCreated: 0, pdfModuleWorkers: 0, pdfMessages: 0, ocrCreated: 0, active: 0, maximumActive: 0 };
      (window as typeof window & { __fullSourceWorkers: Workers }).__fullSourceWorkers = workers;
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        private ended = false;
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          workers.active += 1; workers.maximumActive = Math.max(workers.maximumActive, workers.active);
          if (/\/pdf\.worker(?:\.min)?\.mjs$/u.test(new URL(String(url), location.href).pathname)) {
            workers.pdfCreated += 1;
            if (options?.type === "module") workers.pdfModuleWorkers += 1;
            this.addEventListener("message", () => { workers.pdfMessages += 1; });
          } else workers.ocrCreated += 1;
        }
        override terminate() {
          if (!this.ended) workers.active -= 1;
          this.ended = true; super.terminate();
        }
      };
    });
    try {
      const response = await page.goto("/pdf-to-text");
      expect(response?.status()).toBe(200); expect(sha256(await response!.body())).toBe(htmlHash);
      await expect(page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." })).toBeVisible();
      const pdf = await readFile(path.join(root, "tmp/pdf-release-corpus", entry.filename));
      expect(pdf.length).toBe(entry.bytes); expect(sha256(pdf)).toBe(entry.sha256);
      await page.getByLabel("Choose one PDF", { exact: true }).setInputFiles({ name: entry.filename, mimeType: "application/pdf", buffer: pdf });
      await expect(page.getByRole("heading", { level: 2, name: entry.filename, exact: true })).toBeVisible({ timeout: 45_000 });
      await page.getByRole("radio", { name: "Page range", exact: true }).check();
      await page.getByLabel("Pages to process", { exact: true }).fill(entry.pages.map(item => item.number).join(","));
      await page.locator('input[name="pdf-extraction-method"][value="automatic"]').check();
      await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
      await expect(page.locator(".pdf-results")).toBeVisible({ timeout: 150_000 });
      await expect(page.getByRole("button", { name: "Cancel processing", exact: true })).toHaveCount(0, { timeout: 150_000 });
      for (const expected of entry.pages) {
        const pageButton = page.locator(".pdf-page-list button").filter({ has: page.getByText(`Page ${expected.number}`, { exact: true }) });
        await pageButton.click();
        const status = await pageButton.locator("small").allTextContents();
        const editor = page.getByLabel(`Editable text for page ${expected.number}`, { exact: true });
        const hasEditableOutput = await editor.count() > 0;
        const text = hasEditableOutput ? await editor.inputValue() : "";
        const filename = info.outputPath(`page-${expected.number}-public-fixture-output.txt`);
        const encoded = Buffer.from(text, "utf8");
        await writeFile(filename, encoded);
        const persisted = await readFile(filename);
        expect(persisted.equals(encoded)).toBe(true);
        await info.attach(`public-fixture-page-${expected.number}`, { path: filename, contentType: "text/plain; charset=utf-8" });
        const method = await page.locator(".pdf-method-badge").innerText();
        const tokenChecks = expected.expectedTokens.map(token => ({ token, present: normalise(text).includes(normalise(token)) }));
        pages.push({
          page: expected.number, hasEditableOutput, statusLabels: status, charactersUtf16: text.length, charactersCodePoints: [...text].length,
          outputFileBytes: persisted.length, outputFileSha256: sha256(persisted), outputLogicalSha256: sha256(text),
          logicalHashDefinition: "SHA-256 of exact textarea Unicode string encoded UTF-8; no normalization or newline conversion",
          outputPath: path.relative(root, filename).replaceAll("\\", "/"), method, tokenChecks, originalExpectation: expected,
          warnings: await page.locator(".pdf-page-warnings li").allTextContents(),
          safeErrors: await page.locator(".pdf-page-editor .pdf-control-error").allTextContents(),
          manualSourceReview: "Pending separate complete visual comparison",
        });
        // Always persist both pages before a failed token/method contract ends
        // this case. Preserve the original known FIPS31 expectation failure.
        expect.soft(hasEditableOutput).toBe(true);
        expect.soft(method).toBe(expected.expectedMethod);
        expect.soft(text.length).toBeGreaterThanOrEqual(expected.minimumCharacters);
        for (const token of tokenChecks) expect.soft(token.present, token.token).toBe(true);
      }
      expect(outsideOrigins).toEqual([]); expect(unexpectedPaths).toEqual([]); expect(nonReadRequests).toEqual([]); expect(pageErrors).toEqual([]);
      evidence.workersBeforeClear = await page.evaluate(() => (window as typeof window & { __fullSourceWorkers: Workers }).__fullSourceWorkers);
      await page.getByRole("button", { name: "Clear PDF", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Clear this PDF and its results?" });
      if (await dialog.count()) await dialog.getByRole("button", { name: "Clear PDF", exact: true }).click();
      await expect(page.locator(".pdf-results")).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => (window as typeof window & { __fullSourceWorkers: Workers }).__fullSourceWorkers.active)).toBe(0);
    } finally {
      evidence.workersAtEnd = await page.evaluate(() => (window as typeof window & { __fullSourceWorkers: Workers }).__fullSourceWorkers).catch(() => null);
    }
  });
}
