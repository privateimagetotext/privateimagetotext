import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

type HeldoutCase = {
  id: string; sourceId: string; filename: string; bytes: number; sha256: string;
  page: number; expectedMethod: string; expectedTokens: string[]; minimumCharacters: number;
};
const root = path.resolve(import.meta.dirname, "../..");
const bytes = readFileSync(path.join(import.meta.dirname, "heldout.json"));
const manifest = JSON.parse(bytes.toString("utf8")) as {
  expectationsLockedAt: string; sourceCorpusManifestSha256: string; cases: HeldoutCase[];
};
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const normalise = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();

test.beforeAll(async () => {
  const sourceBytes = await readFile(path.join(import.meta.dirname, "corpus.json"));
  expect(sha256(sourceBytes), "original corpus expectations must remain unchanged").toBe(manifest.sourceCorpusManifestSha256);
  const original = JSON.parse(sourceBytes.toString("utf8")) as { cases: { id: string; pages: { number: number }[] }[] };
  for (const entry of manifest.cases) {
    const source = original.cases.find((candidate) => candidate.id === entry.sourceId)!;
    expect(source.pages.some((page) => page.number === entry.page), `${entry.id} was not in original acceptance`).toBe(false);
  }
});

for (const entry of manifest.cases) {
  test(`held-out ${entry.id}`, async ({ page, browser, baseURL }, info) => {
    const evidence: Record<string, unknown> = {
      id: entry.id, sourceId: entry.sourceId, page: entry.page,
      expectedMethod: entry.expectedMethod,
      browserProject: info.project.name, browserVersion: browser.version(),
      checkedAt: new Date().toISOString(), expectationsLockedAt: manifest.expectationsLockedAt,
      heldoutManifestSha256: sha256(bytes),
      buildId: process.env.PDF_RELEASE_BUILD_ID ?? "NOT_RECORDED",
      gitBaseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0,
      manualUsefulnessReview: "OPEN - source-based tokens do not certify complete output",
    };
    const requests: string[] = [];
    const outsideOrigins: string[] = [];
    const uncaughtErrorNames: string[] = [];
    const origin = new URL(baseURL!).origin;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (!["https:", "http:"].includes(url.protocol)) return;
      requests.push(url.pathname);
      if (url.origin !== origin) outsideOrigins.push(url.origin);
    });
    page.on("pageerror", (error) => uncaughtErrorNames.push(error.name));
    try {
      const response = await page.goto("/pdf-to-text");
      expect(response?.status()).toBe(200);
      evidence.servedHtmlSha256 = sha256(await response!.body());
      await expect(page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." })).toBeVisible();
      const pdf = await readFile(path.join(root, "tmp/pdf-release-corpus", entry.filename));
      expect(pdf.length).toBe(entry.bytes);
      expect(sha256(pdf)).toBe(entry.sha256);
      await page.getByLabel("Choose one PDF").setInputFiles({ name: entry.filename, mimeType: "application/pdf", buffer: pdf });
      await expect(page.getByRole("heading", { level: 2, name: entry.filename })).toBeVisible({ timeout: 90_000 });
      await page.getByRole("radio", { name: "Page range", exact: true }).check();
      await page.getByLabel("Pages to process").fill(String(entry.page));
      await page.locator('input[name="pdf-extraction-method"][value="automatic"]').check();
      const started = Date.now();
      await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
      await expect(page.locator(".pdf-results")).toBeVisible({ timeout: 240_000 });
      await expect(page.getByRole("button", { name: "Cancel processing", exact: true })).toHaveCount(0, { timeout: 240_000 });
      evidence.elapsedMs = Date.now() - started;
      const editor = page.getByLabel(`Editable text for page ${entry.page}`, { exact: true });
      const completed = await editor.count() > 0;
      const text = completed ? await editor.inputValue() : "";
      const method = await page.locator(".pdf-method-badge").innerText();
      const tokens = entry.expectedTokens.map((token) => ({ token, present: normalise(text).includes(normalise(token)) }));
      // Only reached after the exact allowlisted public PDF size/hash checks.
      // This local test attachment is deliberately separate from JSON diagnostics.
      const outputFilename = info.outputPath("public-fixture-output.txt");
      await writeFile(outputFilename, text, "utf8");
      await info.attach("public-fixture-output", { path: outputFilename, contentType: "text/plain; charset=utf-8" });
      Object.assign(evidence, {
        completed, method, characters: text.length, tokenChecks: tokens,
        publicFixtureOutputCapture: {
          sourceSha256: entry.sha256,
          outputSha256: sha256(text),
          attachmentPath: path.relative(root, outputFilename),
          scope: "Exact output from this hash-allowlisted public fixture page only; local test evidence, not production telemetry",
        },
        assessment: await page.locator(".pdf-page-editor .pdf-assessment").allTextContents(),
        warnings: await page.locator(".pdf-page-warnings li").allTextContents(),
        safeErrors: await page.locator(".pdf-page-editor .pdf-control-error").allTextContents(),
      });
      expect.soft(completed, `${entry.id} completes`).toBe(true);
      expect.soft(method, `${entry.id} source-based method preference`).toBe(entry.expectedMethod);
      expect.soft(text.length, `${entry.id} useful minimum length`).toBeGreaterThanOrEqual(entry.minimumCharacters);
      for (const token of tokens) expect.soft(token.present, `${entry.id}: ${token.token}`).toBe(true);
      if (entry.expectedMethod === "PDF text") {
        expect.soft(requests.some((request) => request.startsWith("/ocr/")), "selectable page needs no OCR runtime").toBe(false);
      }
      expect.soft(outsideOrigins).toEqual([]);
      expect.soft(uncaughtErrorNames).toEqual([]);
    } catch (error) {
      evidence.hardFailureObserved = true;
      evidence.hardFailureName = error instanceof Error ? error.name : "ThrownValue";
      throw error;
    } finally {
      Object.assign(evidence, {
        requests, outsideOrigins, uncaughtErrorNames,
        recordedSoftAssertionFailures: info.errors.length,
        assertionFailures: info.errors.length + (evidence.hardFailureObserved ? 1 : 0),
      });
      const filename = info.outputPath("evidence.json");
      await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`);
      await info.attach("heldout-evidence", { path: filename, contentType: "application/json" });
    }
  });
}
