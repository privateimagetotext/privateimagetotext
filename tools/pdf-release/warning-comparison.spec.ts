import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

type SourcePage = {
  id: string; sourceId: string; filename: string; bytes: number; sha256: string; page: number;
};
type BaselineEvidence = {
  id: string; method: string; browserProject: string; buildId: string;
  heldoutManifestSha256: string; servedHtmlSha256: string; warnings: string[];
  publicFixtureOutputCapture: { sourceSha256: string; outputSha256: string };
};
const root = path.resolve(import.meta.dirname, "../..");
const baselineRoot = path.join(root, "tmp/pdf-quality-20260906/heldout-results");
const baselineBuild = "a89004fda19e56fe0a333d9c1f965c214d859cf3c18b32d13e0ad1efe52ab0c1";
const baselineHtml = "5151236a95bb545315eb82cb4be366c3b93599c16f2c8ca50075ee0216fb33bd";
const lockedManifest = "3f500499da500a0893de80844d252d7ce3b03d6005c89d4b5f551fa0975a0385";
const warning = "Some extracted characters may not represent the original symbols. Compare symbols with the PDF and correct the text before use.";
const warnedCases = new Set(["heldout-nist-fips180-4-p11", "heldout-nist-fips180-4-p36"]);
const sourceBytes = readFileSync(path.join(import.meta.dirname, "heldout.json"));
const manifest = JSON.parse(sourceBytes.toString("utf8")) as { cases: SourcePage[]; sourceCorpusManifestSha256: string };
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

test.beforeAll(async () => {
  expect(sha256(sourceBytes), "held-out expectations remain unchanged").toBe(lockedManifest);
  expect(sha256(await readFile(path.join(import.meta.dirname, "corpus.json")))).toBe(manifest.sourceCorpusManifestSha256);
  expect(process.env.PDF_RELEASE_BUILD_ID, "record a new frozen build identity").toMatch(/^[a-f0-9]{64}$/u);
  expect(process.env.PDF_RELEASE_BUILD_ID).not.toBe(baselineBuild);
  expect(process.env.PDF_WARNING_EXPECTED_HTML_SHA256, "record the new served HTML identity").toMatch(/^[a-f0-9]{64}$/u);
});

for (const entry of manifest.cases) {
  test(`warning comparison ${entry.id}`, async ({ page, browser, baseURL }, info) => {
    const evidence: Record<string, unknown> = {
      id: entry.id, page: entry.page, sourceId: entry.sourceId,
      browserProject: info.project.name, browserVersion: browser.version(),
      buildId: process.env.PDF_RELEASE_BUILD_ID, baselineBuildId: baselineBuild,
      heldoutManifestSha256: lockedManifest, checkedAt: new Date().toISOString(),
      gitBaseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0,
      scope: "Additive-warning behavior and exact output preservation only. Original chart and mathematical-symbol quality findings remain unresolved.",
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
      const baselineDirectory = path.join(baselineRoot, `heldout-held-out-${entry.id}-${info.project.name}`);
      const baseline = JSON.parse(await readFile(path.join(baselineDirectory, "evidence.json"), "utf8")) as BaselineEvidence;
      const baselineOutput = await readFile(path.join(baselineDirectory, "public-fixture-output.txt"));
      expect(baseline.id).toBe(entry.id);
      expect(baseline.browserProject).toBe(info.project.name);
      expect(baseline.buildId).toBe(baselineBuild);
      expect(baseline.servedHtmlSha256).toBe(baselineHtml);
      expect(baseline.heldoutManifestSha256).toBe(lockedManifest);
      expect(baseline.publicFixtureOutputCapture.sourceSha256).toBe(entry.sha256);
      expect(sha256(baselineOutput)).toBe(baseline.publicFixtureOutputCapture.outputSha256);
      const expectedWarnings = warnedCases.has(entry.id) ? [...baseline.warnings, warning] : baseline.warnings;
      const pdf = await readFile(path.join(root, "tmp/pdf-release-corpus", entry.filename));
      expect(pdf.length).toBe(entry.bytes);
      expect(sha256(pdf)).toBe(entry.sha256);
      const response = await page.goto("/pdf-to-text");
      expect(response?.status()).toBe(200);
      const servedHtmlSha256 = sha256(await response!.body());
      evidence.servedHtmlSha256 = servedHtmlSha256;
      expect(servedHtmlSha256).toBe(process.env.PDF_WARNING_EXPECTED_HTML_SHA256);
      await expect(page.getByRole("heading", { level: 1, name: "Extract text from a PDF. Nothing uploaded." })).toBeVisible();
      await page.getByLabel("Choose one PDF").setInputFiles({ name: entry.filename, mimeType: "application/pdf", buffer: pdf });
      await expect(page.getByRole("heading", { level: 2, name: entry.filename })).toBeVisible({ timeout: 90_000 });
      await page.getByRole("radio", { name: "Page range", exact: true }).check();
      await page.getByLabel("Pages to process").fill(String(entry.page));
      await page.locator('input[name="pdf-extraction-method"][value="automatic"]').check();
      await page.getByRole("button", { name: "Process selected pages", exact: true }).click();
      await expect(page.locator(".pdf-results")).toBeVisible({ timeout: 240_000 });
      await expect(page.getByRole("button", { name: "Cancel processing", exact: true })).toHaveCount(0, { timeout: 240_000 });
      const editor = page.getByLabel(`Editable text for page ${entry.page}`, { exact: true });
      const completed = await editor.count() > 0;
      const text = completed ? await editor.inputValue() : "";
      const method = await page.locator(".pdf-method-badge").innerText();
      const warnings = await page.locator(".pdf-page-warnings li").allTextContents();
      const safeErrors = await page.locator(".pdf-page-editor .pdf-control-error").allTextContents();
      const outputSha256 = sha256(text);
      const matchesBaselineBytes = Buffer.from(text, "utf8").equals(baselineOutput);
      const outputFile = info.outputPath("public-fixture-output.txt");
      await writeFile(outputFile, text, "utf8");
      await info.attach("public-fixture-output", { path: outputFile, contentType: "text/plain; charset=utf-8" });
      Object.assign(evidence, {
        completed, method, baselineMethod: baseline.method, characters: text.length,
        outputSha256, baselineOutputSha256: baseline.publicFixtureOutputCapture.outputSha256,
        matchesBaselineBytes, warnings, expectedWarnings, baselineWarnings: baseline.warnings,
        expectsAddedWarning: warnedCases.has(entry.id), safeErrors,
        assessment: await page.locator(".pdf-page-editor .pdf-assessment").allTextContents(),
        publicFixtureOutputCapture: { sourceSha256: entry.sha256, attachmentPath: path.relative(root, outputFile) },
      });
      expect.soft(completed, "page completes").toBe(true);
      expect.soft(matchesBaselineBytes, "exact editable output bytes preserved").toBe(true);
      expect.soft(outputSha256, "editable output hash preserved").toBe(baseline.publicFixtureOutputCapture.outputSha256);
      expect.soft(method, "method preserved").toBe(baseline.method);
      expect.soft(warnings, "only the specified additive warning, all existing warnings retained").toEqual(expectedWarnings);
      expect.soft(requests.some((request) => request.startsWith("/ocr/")), "baseline extraction needs no OCR runtime").toBe(false);
      expect.soft(safeErrors).toEqual([]);
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
      await info.attach("warning-comparison-evidence", { path: filename, contentType: "application/json" });
    }
  });
}
