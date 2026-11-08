import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { chooseCarrier, explicitDownload, generatePng, revealFile } from "../../e2e/steganography-helpers";
import { fixtureIdentity, root, sha256, select, process as processPdf } from "./offline-helpers";
import path from "node:path";

type FaultState = { enabled: boolean; pdfAttempts: number; otherWorkers: number };
type Observation = {
  paths: string[]; outsideOrigins: string[]; writeRequests: string[];
  leakedMarkers: string[]; pageErrors: string[]; results: Record<string, unknown>;
};
const rawError = "PDF_CAPABILITY_RAW_FAILURE_672153";
const secret = "CAPABILITY ROUNDTRIP 419507";
const observations = new WeakMap<Page, Observation>();
test.use({ serviceWorkers: "block", actionTimeout: 30_000, navigationTimeout: 30_000 });
test.setTimeout(180_000);

async function pdfInput() {
  const buffer = await readFile(path.join(root, "tmp/pdf-phase0/fixtures/selectable.pdf"));
  expect(buffer.length).toBe(fixtureIdentity["selectable.pdf"].bytes);
  expect(sha256(buffer)).toBe(fixtureIdentity["selectable.pdf"].sha256);
  return { name: "CAPABILITY-PUBLIC-selectable.pdf", mimeType: "application/pdf", buffer };
}

async function openPdf(page: Page) {
  const response = await page.goto("/pdf-to-text");
  expect(response?.status()).toBe(200);
  expect(sha256(await response!.body())).toBe(process.env.PDF_CAPABILITY_HTML_SHA256);
  await expect(page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." })).toBeVisible();
}

async function expectStartupFailure(page: Page) {
  await page.getByLabel("Choose one PDF", { exact: true }).setInputFiles(await pdfInput());
  const error = page.locator("#pdf-file-error");
  await expect(error).toContainText("Local PDF processing could not start.");
  await expect(page.getByRole("button", { name: "Choose PDF", exact: true })).toBeEnabled();
  await expect(page.locator(".pdf-results")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(rawError);
  observations.get(page)!.results.failureMessage = await error.innerText();
  // Continue the isolation/recovery work even if the baseline lacks useful
  // startup guidance. A soft failure remains a failed test in the evidence.
  await expect.soft(error, "startup error provides a practical reload/browser recovery step")
    .toContainText(/reload|another browser/i, { timeout: 1_000 });
}

async function otherToolsWork(page: Page) {
  const observation = observations.get(page)!;
  const start = observation.paths.length;
  await page.goto("/");
  const image = await readFile(path.join(root, "e2e/fixtures/localtext-ocr.png"));
  expect(sha256(image)).toBe("57793f32230825b2884003f1172148d6266ab8bbed11b1d5626bea2b01597f60");
  await page.getByLabel("Choose image file", { exact: true }).setInputFiles({ name: "CAPABILITY-PUBLIC-image.png", mimeType: "image/png", buffer: image });
  await page.getByRole("button", { name: "Extract text", exact: true }).click();
  const text = page.locator(".result-editor textarea");
  await expect(text).toHaveValue(/LOCALTEXT\s+OFFLINE\s+OCR\s+TEST\s+7429/i, { timeout: 90_000 });
  const ocrText = await text.inputValue();
  observation.results.imageOcr = { characters: ocrText.length, sha256: sha256(ocrText) };
  await page.goto("/hide-message");
  await chooseCarrier(page, "CAPABILITY-PUBLIC-carrier.png");
  await generatePng(page, secret);
  const download = await explicitDownload(page);
  const outputPath = await download.path();
  expect(outputPath).not.toBeNull();
  const png = await readFile(outputPath!);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await page.getByRole("button", { name: "Clear", exact: true }).last().click();
  const revealed = await revealFile(page, outputPath!);
  await expect(revealed).toHaveValue(secret);
  observation.results.steganography = { pngBytes: png.length, pngSha256: sha256(png), exactRoundtrip: true };
  expect(observation.paths.slice(start).filter((p) => p.startsWith("/pdf/")), "other tools do not attempt PDF runtime loading").toEqual([]);
}

async function recoveredPdf(page: Page) {
  await select(page, "selectable.pdf");
  await processPdf(page, "embedded-text-only");
  const editor = page.getByLabel("Editable text for page 1", { exact: true });
  await expect(editor).toHaveValue(/PDF PHASE ZERO SELECTABLE 271828/);
  const text = await editor.inputValue();
  observations.get(page)!.results.recoveredPdf = { characters: text.length, sha256: sha256(text), method: await page.locator(".pdf-method-badge").innerText() };
}

test.beforeEach(async ({ page, baseURL, request }) => {
  const observation: Observation = { paths: [], outsideOrigins: [], writeRequests: [], leakedMarkers: [], pageErrors: [], results: {} };
  observations.set(page, observation);
  const origin = new URL(baseURL!).origin;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["http:", "https:"].includes(url.protocol)) return;
    observation.paths.push(url.pathname);
    if (url.origin !== origin) observation.outsideOrigins.push(url.origin);
    if (!["GET", "HEAD"].includes(request.method())) observation.writeRequests.push(url.pathname);
    if ([rawError, secret, "CAPABILITY-PUBLIC-"].some((marker) => `${request.url()}\n${request.postData() ?? ""}`.includes(marker))) observation.leakedMarkers.push(url.pathname);
  });
  page.on("pageerror", (error) => observation.pageErrors.push(error.name));
  const response = await request.get(`${baseURL}/__pdf-validation__/state`);
  expect(response.ok()).toBe(true);
  const state = await response.json() as { buildId: string };
  expect(state.buildId).toBe(process.env.PDF_RELEASE_BUILD_ID);
  observation.results.buildId = state.buildId;
});

test.afterEach(async ({ page, browser }, info: TestInfo) => {
  const observation = observations.get(page)!;
  const evidence = { ...observation, scenario: info.title, browser: info.project.name, browserVersion: browser.version(), status: info.status, assertionFailures: info.errors.length, scope: "Two injected PDF-only support failures, native recovery and real image OCR/PNG hide-reveal. Service workers blocked. No shipping-browser/device or general storage proof." };
  const filename = info.outputPath("capability-evidence.json");
  await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`);
  await info.attach("pdf-capability-evidence", { path: filename, contentType: "application/json" });
  expect(observation.outsideOrigins).toEqual([]);
  expect(observation.writeRequests).toEqual([]);
  expect(observation.leakedMarkers).toEqual([]);
  expect(observation.pageErrors).toEqual([]);
});

test("failed PDF module loading gives recovery guidance while other tools remain useful", async ({ page }) => {
  await page.route("**/pdf/6.2.108/api/pdf.mjs", (route) => route.abort("failed"));
  await openPdf(page);
  await expectStartupFailure(page);
  await otherToolsWork(page);
  await page.unroute("**/pdf/6.2.108/api/pdf.mjs");
  // Dynamic-import rejection may remain cached by the browser's module map.
  // A new document models the reload advised in the startup error.
  await openPdf(page);
  await recoveredPdf(page);
});

test("unavailable PDF module-worker construction stays isolated and recovers", async ({ page }) => {
  await page.addInitScript((sentinel) => {
    const state: FaultState = { enabled: true, pdfAttempts: 0, otherWorkers: 0 };
    (window as typeof window & { __pdfCapabilityFault: FaultState }).__pdfCapabilityFault = state;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        const isPdf = new URL(String(url), location.href).pathname === "/pdf/6.2.108/worker/pdf.worker.min.mjs";
        if (isPdf) {
          state.pdfAttempts += 1;
          if (state.enabled) throw new Error(sentinel);
        } else state.otherWorkers += 1;
        super(url, options);
      }
    };
  }, rawError);
  await openPdf(page);
  await expectStartupFailure(page);
  expect(await page.evaluate(() => (window as typeof window & { __pdfCapabilityFault: FaultState }).__pdfCapabilityFault.pdfAttempts)).toBe(1);
  await otherToolsWork(page);
  await openPdf(page);
  await page.evaluate(() => { (window as typeof window & { __pdfCapabilityFault: FaultState }).__pdfCapabilityFault.enabled = false; });
  await recoveredPdf(page);
});
