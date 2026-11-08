import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  matchCriticalTokens,
  measureOcrAccuracy,
} from "../src/features/ocr/metrics";
import { FILE_LIMITS } from "../src/config/product";
import { MAX_NATIVE_RECOGNITION_TILE_PIXELS } from "../src/features/ocr/tiling";
import {
  tesseractOptionsForRequest,
  tesseractParametersForRequest,
} from "../src/features/ocr/tesseract-adapter";
import type {
  EnhancementPreset,
  OcrContentMode,
} from "../src/features/ocr/types";

type CorpusFixture = {
  id: string;
  image: string;
  groundTruth: string;
  contentMode: OcrContentMode;
  baselineContentMode?: OcrContentMode;
  enhancementPreset: EnhancementPreset;
  baselineEnhancementPreset: EnhancementPreset;
  categories: string[];
  criticalTokens: string[];
  fastSmoke: boolean;
};

type CorpusManifest = {
  version: number;
  fixtures: CorpusFixture[];
};

type FixtureResult = {
  id: string;
  categories: string[];
  contentMode: OcrContentMode;
  enhancementPreset: EnhancementPreset;
  appliedEnhancementPreset: EnhancementPreset;
  primaryMetric: "raw" | "cleaned";
  groundTruthSha256: string;
  imageSha256: string;
  runtimeMs: number;
  detectedDeskewDegrees: number;
  autoDeskewRequested: boolean;
  thresholdingMethod: 0 | 1 | 2;
  workingImage: string;
  preparation: {
    profile: string | null;
    scale: number | null;
    scaleAction: string | null;
    thresholdingMethod: number | null;
    polarityInverted: boolean | null;
  };
  recognition: {
    strategy: string | null;
    sectionCount: number | null;
    totalPreparedPixels: number | null;
    peakPreparedWidth: number | null;
    peakPreparedHeight: number | null;
    sectionDeskewRadians: number[];
    inputRects: Array<{ x: number; y: number; width: number; height: number }>;
    coreRects: Array<{ x: number; y: number; width: number; height: number }>;
  };
  raw: ReturnType<typeof measureOcrAccuracy>;
  cleaned: ReturnType<typeof measureOcrAccuracy>;
  observedRaw: string;
  observedCleaned: string;
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, "..");
const corpusDirectory = path.join(currentDirectory, "fixtures", "ocr-corpus");
const manifestText = await readFile(
  path.join(corpusDirectory, "manifest.json"),
  "utf8",
);
const manifest = JSON.parse(manifestText) as CorpusManifest;
const benchmarkVariant = process.env.OCR_BENCHMARK_VARIANT ?? "current";
const sourceDescription =
  process.env.OCR_BENCHMARK_SOURCE_DESCRIPTION ?? "working tree build";
const adaptiveThresholdingMethod = Number(
  process.env.OCR_BENCHMARK_ADAPTIVE_THRESHOLD ?? "2",
) as 0 | 1 | 2;
const deskewPolicy =
  process.env.OCR_BENCHMARK_DESKEW_POLICY ??
  (benchmarkVariant === "baseline-head"
    ? "disabled in HEAD"
    : "Adaptive document except Single line");

function appliedPreset(fixture: CorpusFixture): EnhancementPreset {
  if (benchmarkVariant === "baseline-head") {
    return fixture.baselineEnhancementPreset;
  }
  return fixture.enhancementPreset;
}

function appliedContentMode(fixture: CorpusFixture): OcrContentMode {
  if (
    benchmarkVariant === "baseline-head" ||
    benchmarkVariant === "layout-baseline"
  ) {
    return fixture.baselineContentMode ?? fixture.contentMode;
  }
  return fixture.contentMode;
}

function autoDeskewExpected(
  fixture: CorpusFixture,
  enhancementPreset: EnhancementPreset,
  contentMode = appliedContentMode(fixture),
) {
  return (
    !deskewPolicy.toLowerCase().startsWith("disabled") &&
    enhancementPreset === "adaptive-document" &&
    contentMode !== "single-line"
  );
}

async function enforceBenchmarkNetworkBoundary(page: Page, baseURL: string) {
  const benchmarkOrigin = new URL(baseURL).origin;
  const blockedExternalRequests: string[] = [];
  const blockedWebSockets: string[] = [];
  await page.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    if (
      requestUrl.startsWith("http") &&
      new URL(requestUrl).origin !== benchmarkOrigin
    ) {
      blockedExternalRequests.push(requestUrl);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await page.routeWebSocket(/.*/, (webSocket) => {
    // Not connecting the routed socket prevents any message from leaving the
    // page. Production preview does not require WebSockets, same-origin or not.
    blockedWebSockets.push(webSocket.url());
  });
  return { blockedExternalRequests, blockedWebSockets };
}

async function extractPreparedText(page: Page) {
  const started = performance.now();
  await page.getByRole("button", { name: "Re-run OCR" }).click();
  const cleanedResult = page.getByLabel("Tidied");
  await expect(cleanedResult).toBeVisible({ timeout: 120_000 });
  const cleaned = await cleanedResult.inputValue();
  const runtimeMs = performance.now() - started;
  const recognition = await page
    .locator("[data-result-recognition-strategy]")
    .evaluate((element) => {
      const numberAttribute = (name: string) => {
        const value = element.getAttribute(name);
        if (value === null) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const jsonAttribute = <T,>(name: string, fallback: T): T => {
        const value = element.getAttribute(name);
        if (value === null) return fallback;
        try {
          return JSON.parse(value) as T;
        } catch {
          return fallback;
        }
      };
      return {
        strategy: element.getAttribute("data-result-recognition-strategy"),
        sectionCount: numberAttribute("data-result-recognition-sections"),
        totalPreparedPixels: numberAttribute("data-result-total-prepared-pixels"),
        peakPreparedWidth: numberAttribute("data-result-peak-prepared-width"),
        peakPreparedHeight: numberAttribute("data-result-peak-prepared-height"),
        sectionDeskewRadians: jsonAttribute<number[]>(
          "data-result-section-deskew-radians",
          [],
        ),
        inputRects: jsonAttribute<
          Array<{ x: number; y: number; width: number; height: number }>
        >("data-result-section-input-rects", []),
        coreRects: jsonAttribute<
          Array<{ x: number; y: number; width: number; height: number }>
        >("data-result-section-core-rects", []),
      };
    });
  const deskewDegrees = Math.max(
    0,
    ...recognition.sectionDeskewRadians.map(
      (radians) => Math.abs((radians * 180) / Math.PI),
    ),
  );

  await page.getByRole("button", { name: "Original OCR" }).click();
  const rawResult = page.getByLabel("Original OCR");
  await expect(rawResult).toBeVisible();
  return {
    raw: await rawResult.inputValue(),
    cleaned,
    runtimeMs,
    deskewDegrees,
    recognition,
  };
}

async function rerunPreparedText(page: Page, contentMode: OcrContentMode) {
  await page.getByLabel("Content type").selectOption(contentMode);
  await expect(page.getByRole("button", { name: "Re-run OCR" })).toBeEnabled();
  return { ...(await extractPreparedText(page)), contentMode };
}

async function runFixture(page: Page, fixture: CorpusFixture) {
  const enhancementPreset = appliedPreset(fixture);
  const contentMode = appliedContentMode(fixture);
  await page.goto("/");
  await page
    .getByLabel("Choose image file", { exact: true })
    .setInputFiles(path.join(corpusDirectory, fixture.image));
  const largeImageDialog = page.getByRole("dialog", {
    name: "Prepare a reduced preview?",
  });
  await expect(
    page.getByText(fixture.image, { exact: true }).or(largeImageDialog),
  ).toBeVisible();
  if (await largeImageDialog.isVisible()) {
    await largeImageDialog
      .getByRole("button", { name: "Use reduced preview" })
      .click();
  }
  await expect(page.getByText(fixture.image, { exact: true })).toBeVisible();
  await page.getByLabel("Enhancement").selectOption(enhancementPreset);
  await page.getByLabel("Content type").selectOption(contentMode);
  await expect(page.getByRole("button", { name: "Re-run OCR" })).toBeEnabled();
  const workingDetails = page
    .locator("dt", { hasText: /^Preview$/ })
    .locator("..")
    .locator("dd");
  const workingImage = await workingDetails.innerText();
  const preparation = await workingDetails.evaluate((element) => {
    const numberAttribute = (name: string) => {
      const value = element.getAttribute(name);
      if (value === null) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const polarity = element.getAttribute("data-polarity-inverted");
    return {
      profile: element.getAttribute("data-preparation-profile"),
      scale: numberAttribute("data-preparation-scale"),
      scaleAction: element.getAttribute("data-scale-action"),
      thresholdingMethod: numberAttribute("data-thresholding-method"),
      polarityInverted: polarity === null ? null : polarity === "true",
    };
  });

  const recognised = await extractPreparedText(page);
  return {
    ...recognised,
    enhancementPreset,
    contentMode,
    workingImage,
    preparation,
  };
}

async function fingerprintApplication(page: Page) {
  const assetUrls = await page
    .locator('script[src], link[rel="stylesheet"][href]')
    .evaluateAll((elements) =>
      elements
        .map((element) =>
          element instanceof HTMLScriptElement
            ? element.src
            : element instanceof HTMLLinkElement
              ? element.href
              : "",
        )
        .filter(Boolean),
    );
  return Promise.all(
    [...new Set(assetUrls)].sort().map(async (url) => {
      const response = await page.request.get(url);
      expect(response.ok(), `benchmark application asset ${url}`).toBe(true);
      return {
        path: new URL(url).pathname,
        sha256: createHash("sha256")
          .update(await response.body())
          .digest("hex"),
      };
    }),
  );
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function exactOccurrenceCount(value: string, token: string) {
  const normalised = value.normalize("NFC");
  const expected = token.normalize("NFC");
  let count = 0;
  let offset = 0;
  while (expected && offset <= normalised.length - expected.length) {
    const found = normalised.indexOf(expected, offset);
    if (found < 0) break;
    count += 1;
    offset = found + expected.length;
  }
  return count;
}

function expectTokensOnceInOrder(result: FixtureResult, fixture: CorpusFixture) {
  let previous = -1;
  for (const token of fixture.criticalTokens) {
    expect(
      exactOccurrenceCount(result.observedCleaned, token),
      `${result.id} should contain ${token} exactly once`,
    ).toBe(1);
    const position = result.observedCleaned.indexOf(token);
    expect(position, `${result.id} should keep ${token} in page order`).toBeGreaterThan(
      previous,
    );
    previous = position;
  }
}

function aggregateByCategory(results: FixtureResult[]) {
  const categories = new Map<string, FixtureResult[]>();
  for (const result of results) {
    for (const category of result.categories) {
      categories.set(category, [...(categories.get(category) ?? []), result]);
    }
  }

  return [...categories.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, entries]) => ({
      category,
      fixtureCount: entries.length,
      meanRuntimeMs: average(entries.map((entry) => entry.runtimeMs)),
      raw: {
        meanStrictCer: average(entries.map((entry) => entry.raw.strictCer)),
        meanWhitespaceNormalisedCer: average(
          entries.map((entry) => entry.raw.whitespaceNormalisedCer),
        ),
        meanWer: average(entries.map((entry) => entry.raw.wer)),
        criticalTokensMatched: entries.reduce(
          (total, entry) => total + entry.raw.criticalTokens.matched,
          0,
        ),
        criticalTokensTotal: entries.reduce(
          (total, entry) => total + entry.raw.criticalTokens.total,
          0,
        ),
      },
      cleaned: {
        meanStrictCer: average(entries.map((entry) => entry.cleaned.strictCer)),
        meanWhitespaceNormalisedCer: average(
          entries.map((entry) => entry.cleaned.whitespaceNormalisedCer),
        ),
        meanWer: average(entries.map((entry) => entry.cleaned.wer)),
        criticalTokensMatched: entries.reduce(
          (total, entry) => total + entry.cleaned.criticalTokens.matched,
          0,
        ),
        criticalTokensTotal: entries.reduce(
          (total, entry) => total + entry.cleaned.criticalTokens.total,
          0,
        ),
      },
    }));
}

function percentage(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function createMarkdownReport(report: {
  benchmarkVariant: string;
  sourceDescription: string;
  manifestSha256: string;
  browser: { name: string; version: string };
  adaptiveThresholdingMethod: number;
  deskewPolicy: string;
  applicationAssets: { path: string; sha256: string }[];
  generatedAt: string;
  gitHead: string;
  fixtures: FixtureResult[];
  aggregates: ReturnType<typeof aggregateByCategory>;
}) {
  const fixtureRows = report.fixtures.map((fixture) =>
    [
      fixture.id,
      fixture.primaryMetric,
      fixture.contentMode,
      fixture.appliedEnhancementPreset,
      fixture.thresholdingMethod,
      fixture.autoDeskewRequested ? "on" : "off",
      fixture.recognition.strategy ?? "unknown",
      fixture.recognition.sectionCount ?? "unknown",
      fixture.runtimeMs.toFixed(0),
      percentage(fixture.raw.strictCer),
      percentage(fixture.raw.whitespaceNormalisedCer),
      percentage(fixture.raw.wer),
      `${fixture.raw.criticalTokens.matched}/${fixture.raw.criticalTokens.total}`,
      percentage(fixture.cleaned.strictCer),
      percentage(fixture.cleaned.whitespaceNormalisedCer),
      percentage(fixture.cleaned.wer),
      `${fixture.cleaned.criticalTokens.matched}/${fixture.cleaned.criticalTokens.total}`,
    ].join(" | "),
  );
  const aggregateRows = report.aggregates.map((aggregate) =>
    [
      aggregate.category,
      aggregate.fixtureCount,
      aggregate.meanRuntimeMs.toFixed(0),
      percentage(aggregate.raw.meanStrictCer),
      percentage(aggregate.raw.meanWhitespaceNormalisedCer),
      percentage(aggregate.raw.meanWer),
      `${aggregate.raw.criticalTokensMatched}/${aggregate.raw.criticalTokensTotal}`,
      percentage(aggregate.cleaned.meanStrictCer),
      percentage(aggregate.cleaned.meanWhitespaceNormalisedCer),
      percentage(aggregate.cleaned.meanWer),
      `${aggregate.cleaned.criticalTokensMatched}/${aggregate.cleaned.criticalTokensTotal}`,
    ].join(" | "),
  );

  const assetLines = report.applicationAssets.map(
    (asset) => `- \`${asset.path}\`: \`${asset.sha256}\``,
  );
  return `# OCR accuracy benchmark report\n\nVariant: ${report.benchmarkVariant}\n\nSource: ${report.sourceDescription}\n\nGenerated: ${report.generatedAt}\n\nGit HEAD: \`${report.gitHead}\`\n\nCorpus manifest SHA-256: \`${report.manifestSha256}\`\n\nBrowser: ${report.browser.name} ${report.browser.version}\n\nAdaptive thresholding method: ${report.adaptiveThresholdingMethod}\n\nDeskew policy: ${report.deskewPolicy}\n\nApplication assets:\n${assetLines.join("\n")}\n\nRates are exact, case-sensitive edit distances divided by the Unicode code-point ground-truth length. Aggregate rates are unweighted fixture means. Code fixtures use raw OCR as their primary metric. Baseline variants use each fixture's declared pre-slice content mode, while baseline-head also uses its legacy preset.\n\n## Per fixture\n\nFixture | Primary | Applied mode | Applied preset | Threshold | Deskew | Recognition | Sections | Runtime ms | Raw strict CER | Raw whitespace CER | Raw WER | Raw tokens | Cleaned strict CER | Cleaned whitespace CER | Cleaned WER | Cleaned tokens\n--- | --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:\n${fixtureRows.join("\n")}\n\n## Per category\n\nCategory | Fixtures | Mean runtime ms | Raw strict CER | Raw whitespace CER | Raw WER | Raw tokens | Cleaned strict CER | Cleaned whitespace CER | Cleaned WER | Cleaned tokens\n--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:\n${aggregateRows.join("\n")}\n`;
}

async function attachReports(
  page: Page,
  testInfo: TestInfo,
  fixtures: FixtureResult[],
) {
  const browser = page.context().browser();
  const report = {
    schemaVersion: 1,
    benchmarkVariant,
    sourceDescription,
    generatedAt: new Date().toISOString(),
    gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim(),
    manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
    browser: {
      name: browser?.browserType().name() ?? "unknown",
      version: browser?.version() ?? "unknown",
    },
    adaptiveThresholdingMethod,
    deskewPolicy,
    applicationAssets: await fingerprintApplication(page),
    corpusVersion: manifest.version,
    fixtureCount: fixtures.length,
    fixtures,
    aggregates: aggregateByCategory(fixtures),
  };
  const markdown = createMarkdownReport(report);
  const reportDirectory = path.join(
    repositoryRoot,
    "tmp",
    "ocr-benchmark-reports",
    benchmarkVariant,
  );
  await mkdir(reportDirectory, { recursive: true });
  const jsonPath = path.join(reportDirectory, "report.json");
  const markdownPath = path.join(reportDirectory, "report.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  await testInfo.attach(`ocr-accuracy-${benchmarkVariant}.json`, {
    path: jsonPath,
    contentType: "application/json",
  });
  await testInfo.attach(`ocr-accuracy-${benchmarkVariant}.md`, {
    path: markdownPath,
    contentType: "text/markdown",
  });
}

test("clean and degraded corpus fixtures remain in normal OCR smoke coverage", async ({
  page,
}) => {
  test.slow();
  const smokeFixtures = manifest.fixtures.filter((fixture) => fixture.fastSmoke);
  expect(smokeFixtures.map((fixture) => fixture.id)).toEqual([
    "clean-screenshot",
    "uneven-lighting",
  ]);

  for (const fixture of smokeFixtures) {
    const result = await runFixture(page, fixture);
    expect(
      matchCriticalTokens([fixture.criticalTokens[0]], result.cleaned).matched,
      `${fixture.id} should retain its primary critical token`,
    ).toBe(1);
  }
});

test("every critical token occurs exactly in its synthetic ground truth", async () => {
  for (const fixture of manifest.fixtures) {
    const groundTruth = await readFile(
      path.join(corpusDirectory, fixture.groundTruth),
      "utf8",
    );
    expect(
      matchCriticalTokens(fixture.criticalTokens, groundTruth),
      fixture.id,
    ).toMatchObject({
      matched: fixture.criticalTokens.length,
      total: fixture.criticalTokens.length,
      missing: [],
    });
    for (const token of fixture.criticalTokens) {
      expect(exactOccurrenceCount(groundTruth, token), fixture.id).toBe(1);
    }
  }
});

test("synthetic long fixtures exercise tiling within existing input safeguards", async () => {
  for (const id of ["long-receipt", "long-printed-page"]) {
    const fixture = manifest.fixtures.find((entry) => entry.id === id);
    expect(fixture, id).toBeDefined();
    if (!fixture) continue;
    const image = await readFile(path.join(corpusDirectory, fixture.image));
    expect(image.subarray(1, 4).toString("ascii"), id).toBe("PNG");
    const width = image.readUInt32BE(16);
    const height = image.readUInt32BE(20);
    expect(Math.max(width, height), id).toBeGreaterThan(
      FILE_LIMITS.maxWorkingSide,
    );
    expect(width * height, id).toBeLessThanOrEqual(
      FILE_LIMITS.maxDecodedPixels,
    );
    expect(image.byteLength, id).toBeLessThanOrEqual(FILE_LIMITS.maxBytes);
  }
});

test("full current-production corpus @ocr-benchmark", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(600_000);
  expect(manifest.fixtures).toHaveLength(13);
  const networkBoundary = await enforceBenchmarkNetworkBoundary(page, baseURL!);

  const results: FixtureResult[] = [];
  for (const fixture of manifest.fixtures) {
    const groundTruth = await readFile(
      path.join(corpusDirectory, fixture.groundTruth),
      "utf8",
    );
    const recognised = await runFixture(page, fixture);
    results.push({
      id: fixture.id,
      categories: fixture.categories,
      contentMode: recognised.contentMode,
      enhancementPreset: fixture.enhancementPreset,
      appliedEnhancementPreset: recognised.enhancementPreset,
      primaryMetric: recognised.contentMode === "code" ? "raw" : "cleaned",
      groundTruthSha256: createHash("sha256").update(groundTruth).digest("hex"),
      imageSha256: createHash("sha256")
        .update(await readFile(path.join(corpusDirectory, fixture.image)))
        .digest("hex"),
      runtimeMs: recognised.runtimeMs,
      detectedDeskewDegrees: recognised.deskewDegrees,
      autoDeskewRequested: autoDeskewExpected(
        fixture,
        recognised.enhancementPreset,
        recognised.contentMode,
      ),
      thresholdingMethod:
        recognised.preparation.thresholdingMethod === 0 ||
        recognised.preparation.thresholdingMethod === 1 ||
        recognised.preparation.thresholdingMethod === 2
          ? recognised.preparation.thresholdingMethod
          : recognised.enhancementPreset === "adaptive-document"
            ? adaptiveThresholdingMethod
            : 0,
      workingImage: recognised.workingImage,
      preparation: recognised.preparation,
      recognition: recognised.recognition,
      raw: measureOcrAccuracy(
        groundTruth,
        recognised.raw,
        fixture.criticalTokens,
      ),
      cleaned: measureOcrAccuracy(
        groundTruth,
        recognised.cleaned,
        fixture.criticalTokens,
      ),
      observedRaw: recognised.raw,
      observedCleaned: recognised.cleaned,
    });
  }

  await attachReports(page, testInfo, results);
  expect(networkBoundary.blockedExternalRequests).toEqual([]);
  expect(networkBoundary.blockedWebSockets).toEqual([]);

  if (benchmarkVariant === "current") {
    const clean = results.find((result) => result.id === "clean-screenshot");
    const skew = results.find((result) => result.id === "skew-three-degrees");
    const dark = results.find((result) => result.id === "dark-background");
    const receipt = results.find((result) => result.id === "receipt");
    const uneven = results.find((result) => result.id === "uneven-lighting");
    const longReceipt = results.find((result) => result.id === "long-receipt");
    const longPage = results.find(
      (result) => result.id === "long-printed-page",
    );
    const adaptive = aggregateByCategory(results).find(
      (entry) => entry.category === "adaptive-degraded",
    );
    const columnLayouts = results.filter((result) =>
      result.categories.includes("two-column-document"),
    );

    expect(clean?.cleaned.whitespaceNormalisedCer).toBeLessThanOrEqual(0.005);
    expect(clean?.cleaned.criticalTokens.matched).toBe(
      clean?.cleaned.criticalTokens.total,
    );
    expect(adaptive?.cleaned.meanWhitespaceNormalisedCer).toBeLessThan(
      0.00584,
    );
    expect(adaptive?.cleaned.meanWer).toBeLessThan(0.0411);
    expect(adaptive?.cleaned.criticalTokensMatched).toBe(
      adaptive?.cleaned.criticalTokensTotal,
    );
    expect(skew?.cleaned.whitespaceNormalisedCer).toBeLessThan(0.00649);
    expect(skew?.detectedDeskewDegrees).toBeGreaterThanOrEqual(1);
    expect(dark?.preparation.polarityInverted).toBe(true);
    expect(uneven?.preparation.polarityInverted).toBe(false);
    expect(receipt?.cleaned.strictCer).toBeLessThanOrEqual(0.34147);
    expect(dark?.cleaned.strictCer).toBeLessThanOrEqual(0.04706);
    expect(skew?.cleaned.strictCer).toBeLessThanOrEqual(0.03226);
    expect(receipt?.observedRaw).toMatch(/TOTAL \$38\.45\n\nPayment:/);
    expect(receipt?.observedCleaned).not.toMatch(
      /TOTAL \$38\.45\n\nPayment:/,
    );
    expect(dark?.observedCleaned).not.toContain("\n\n");
    expect(skew?.observedCleaned).not.toMatch(/without\n\nchanging/);

    expect(columnLayouts).toHaveLength(3);
    for (const result of columnLayouts) {
      expect(result.contentMode, result.id).toBe("columns");
      expect(result.recognition.strategy, result.id).toBe("single-canvas");
      expect(result.recognition.sectionCount, result.id).toBe(1);
      expect(result.raw.whitespaceNormalisedCer, result.id).toBeLessThanOrEqual(
        0.005,
      );
      expect(result.raw.wer, result.id).toBeLessThanOrEqual(0.01);
      expect(
        result.cleaned.whitespaceNormalisedCer,
        result.id,
      ).toBeLessThanOrEqual(0.005);
      expect(result.cleaned.wer, result.id).toBeLessThanOrEqual(0.01);
      expect(result.cleaned.criticalTokens.matched, result.id).toBe(
        result.cleaned.criticalTokens.total,
      );
      const fixture = manifest.fixtures.find((entry) => entry.id === result.id);
      expect(fixture, result.id).toBeDefined();
      if (fixture) expectTokensOnceInOrder(result, fixture);
    }

    for (const result of [longReceipt, longPage]) {
      expect(result, "long fixture result").toBeDefined();
      if (!result) continue;
      expect(result.recognition.strategy, result.id).toBe("vertical-tiles");
      expect(result.recognition.sectionCount, result.id).toBeGreaterThan(1);
      expect(result.recognition.peakPreparedWidth, result.id).toBeLessThanOrEqual(
        FILE_LIMITS.maxWorkingSide,
      );
      expect(
        result.recognition.peakPreparedHeight,
        result.id,
      ).toBeLessThanOrEqual(FILE_LIMITS.maxWorkingSide);
      expect(
        (result.recognition.peakPreparedWidth ?? Infinity) *
          (result.recognition.peakPreparedHeight ?? Infinity),
        result.id,
      ).toBeLessThanOrEqual(MAX_NATIVE_RECOGNITION_TILE_PIXELS);
      const cores = result.recognition.coreRects;
      expect(cores[0]?.y, result.id).toBe(0);
      for (let index = 1; index < cores.length; index += 1) {
        expect(cores[index].y, result.id).toBe(
          cores[index - 1].y + cores[index - 1].height,
        );
      }
      const inputs = result.recognition.inputRects;
      for (let index = 1; index < inputs.length; index += 1) {
        expect(
          inputs[index - 1].y +
            inputs[index - 1].height -
            inputs[index].y,
          result.id,
        ).toBe(256);
      }
    }
    expect(longReceipt?.cleaned.whitespaceNormalisedCer).toBeLessThan(0.0136);
    expect(longReceipt?.cleaned.wer).toBeLessThan(0.0477);
    expect(longPage?.cleaned.whitespaceNormalisedCer).toBeLessThan(0.00323);
    expect(longPage?.cleaned.wer).toBeLessThan(0.00792);
    const longReceiptFixture = manifest.fixtures.find(
      (fixture) => fixture.id === "long-receipt",
    );
    const longPageFixture = manifest.fixtures.find(
      (fixture) => fixture.id === "long-printed-page",
    );
    if (longReceipt && longReceiptFixture) {
      expectTokensOnceInOrder(longReceipt, longReceiptFixture);
    }
    if (longPage && longPageFixture) {
      expectTokensOnceInOrder(longPage, longPageFixture);
    }
    for (const fixture of results.filter(
      (result) => result.enhancementPreset === "adaptive-document",
    )) {
      expect(fixture.thresholdingMethod, fixture.id).toBe(2);
    }
  }
});

test("column layout mode preserves column-major reading order @ocr-benchmark", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(300_000);
  test.skip(
    benchmarkVariant === "baseline-head",
    "The baseline application predates the Columns content mode.",
  );
  const layoutFixtures = manifest.fixtures.filter((fixture) =>
    fixture.categories.includes("two-column-document"),
  );
  expect(layoutFixtures).toHaveLength(3);
  const networkBoundary = await enforceBenchmarkNetworkBoundary(page, baseURL!);

  const results = [];
  for (const fixture of layoutFixtures) {
    const groundTruth = await readFile(
      path.join(corpusDirectory, fixture.groundTruth),
      "utf8",
    );
    const imageSha256 = createHash("sha256")
      .update(await readFile(path.join(corpusDirectory, fixture.image)))
      .digest("hex");
    for (const contentMode of ["document", "columns"] as const) {
      const recognitionRequest = {
        contentMode,
        autoDeskew: false,
        thresholdingMethod: 0 as const,
        includeWords: false,
        includeLines: false,
      };
      const adapterParameters =
        tesseractParametersForRequest(recognitionRequest);
      const recognised = await runFixture(page, {
        ...fixture,
        contentMode,
        baselineContentMode: undefined,
      });
      results.push({
        fixtureId: fixture.id,
        contentMode,
        imageSha256,
        groundTruthSha256: createHash("sha256")
          .update(groundTruth)
          .digest("hex"),
        appliedEnhancementPreset: recognised.enhancementPreset,
        runtimeMs: recognised.runtimeMs,
        workingImage: recognised.workingImage,
        preparation: recognised.preparation,
        recognition: recognised.recognition,
        benchmarkRequest: recognitionRequest,
        adapterParameters,
        pageSegmentationJavaScriptType:
          typeof adapterParameters.tessedit_pageseg_mode,
        recognizeOptions: tesseractOptionsForRequest(recognitionRequest),
        raw: measureOcrAccuracy(
          groundTruth,
          recognised.raw,
          fixture.criticalTokens,
        ),
        cleaned: measureOcrAccuracy(
          groundTruth,
          recognised.cleaned,
          fixture.criticalTokens,
        ),
        observedRaw: recognised.raw,
        observedCleaned: recognised.cleaned,
      });
    }
  }

  for (const fixture of layoutFixtures) {
    const control = results.find(
      (result) =>
        result.fixtureId === fixture.id && result.contentMode === "document",
    );
    const columns = results.find(
      (result) =>
        result.fixtureId === fixture.id && result.contentMode === "columns",
    );
    expect(control, `${fixture.id} Document control`).toBeDefined();
    expect(columns, `${fixture.id} Columns result`).toBeDefined();
    if (!control || !columns) continue;
    expect(columns.preparation, `${fixture.id} identical preparation`).toEqual(
      control.preparation,
    );
    expect(columns.workingImage, `${fixture.id} identical prepared size`).toBe(
      control.workingImage,
    );
    expect(control.recognition.strategy, fixture.id).toBe("single-canvas");
    expect(columns.recognition.strategy, fixture.id).toBe("single-canvas");
    expect(control.recognition.sectionCount, fixture.id).toBe(1);
    expect(columns.recognition.sectionCount, fixture.id).toBe(1);
    expect(columns.raw.whitespaceNormalisedCer, fixture.id).toBeLessThanOrEqual(
      0.005,
    );
    expect(columns.raw.wer, fixture.id).toBeLessThanOrEqual(0.01);
    expect(columns.cleaned.whitespaceNormalisedCer, fixture.id).toBeLessThanOrEqual(
      0.005,
    );
    expect(columns.cleaned.wer, fixture.id).toBeLessThanOrEqual(0.01);
    expect(columns.cleaned.criticalTokens.matched, fixture.id).toBe(
      columns.cleaned.criticalTokens.total,
    );
    expectTokensOnceInOrder(
      {
        ...columns,
        id: fixture.id,
        categories: fixture.categories,
        contentMode: "columns",
        enhancementPreset: fixture.enhancementPreset,
        appliedEnhancementPreset: columns.appliedEnhancementPreset,
        primaryMetric: "cleaned",
        detectedDeskewDegrees: 0,
        autoDeskewRequested: false,
        thresholdingMethod: 0,
      },
      fixture,
    );
  }

  const transitionFixture = layoutFixtures[0];
  const transitionGroundTruth = await readFile(
    path.join(corpusDirectory, transitionFixture.groundTruth),
    "utf8",
  );
  const initialDocument = await runFixture(page, {
    ...transitionFixture,
    contentMode: "document",
    baselineContentMode: undefined,
  });
  const reusedColumns = await rerunPreparedText(page, "columns");
  const restoredDocument = await rerunPreparedText(page, "document");
  const transitionEntry = (
    step: string,
    contentMode: "document" | "columns",
    recognised: Awaited<ReturnType<typeof extractPreparedText>>,
  ) => {
    const benchmarkRequest = {
      contentMode,
      autoDeskew: false,
      thresholdingMethod: 0 as const,
      includeWords: false,
      includeLines: false,
    };
    const adapterParameters =
      tesseractParametersForRequest(benchmarkRequest);
    return {
      step,
      contentMode,
      runtimeMs: recognised.runtimeMs,
      benchmarkRequest,
      adapterParameters,
      pageSegmentationJavaScriptType:
        typeof adapterParameters.tessedit_pageseg_mode,
      recognizeOptions: tesseractOptionsForRequest(benchmarkRequest),
      raw: measureOcrAccuracy(
        transitionGroundTruth,
        recognised.raw,
        transitionFixture.criticalTokens,
      ),
      cleaned: measureOcrAccuracy(
        transitionGroundTruth,
        recognised.cleaned,
        transitionFixture.criticalTokens,
      ),
      observedRaw: recognised.raw,
      observedCleaned: recognised.cleaned,
    };
  };
  const transitionSequence = [
    transitionEntry("fresh-document", "document", initialDocument),
    transitionEntry("same-worker-columns", "columns", reusedColumns),
    transitionEntry("restored-document", "document", restoredDocument),
  ];
  expect(restoredDocument.raw).toBe(initialDocument.raw);
  expect(restoredDocument.cleaned).toBe(initialDocument.cleaned);
  expect(
    transitionSequence[1].raw.whitespaceNormalisedCer,
    "same-worker Columns accuracy",
  ).toBeLessThanOrEqual(0.005);
  expect(transitionSequence[1].raw.wer, "same-worker Columns order").toBeLessThanOrEqual(
    0.01,
  );
  expect(networkBoundary.blockedExternalRequests).toEqual([]);
  expect(networkBoundary.blockedWebSockets).toEqual([]);

  const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const gitStatus = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: repositoryRoot },
  );
  const trackedDiff = execFileSync(
    "git",
    ["diff", "--binary", "HEAD", "--", "."],
    { cwd: repositoryRoot },
  );
  const browser = page.context().browser();
  const report = {
    schemaVersion: 1,
    benchmarkVariant,
    sourceDescription,
    generatedAt: new Date().toISOString(),
    gitHead,
    worktreeDirty: gitStatus.length > 0,
    worktreeSourceFingerprint: createHash("sha256")
      .update(gitHead)
      .update(gitStatus)
      .update(trackedDiff)
      .update(manifestText)
      .digest("hex"),
    browser: {
      name: browser?.browserType().name() ?? "unknown",
      version: browser?.version() ?? "unknown",
    },
    manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
    applicationAssets: await fingerprintApplication(page),
    networkBoundary,
    fixtureCount: layoutFixtures.length,
    recognitionCalls: results.length + transitionSequence.length,
    results,
    transitionFixtureId: transitionFixture.id,
    transitionSequence,
  };
  const markdownRows = results.map((result) =>
    [
      result.fixtureId,
      result.contentMode,
      `${JSON.stringify(result.adapterParameters.tessedit_pageseg_mode)} (${result.pageSegmentationJavaScriptType})`,
      result.recognition.strategy ?? "unknown",
      result.recognition.sectionCount ?? "unknown",
      result.runtimeMs.toFixed(0),
      percentage(result.raw.whitespaceNormalisedCer),
      percentage(result.raw.wer),
      `${result.raw.criticalTokens.matched}/${result.raw.criticalTokens.total}`,
      percentage(result.cleaned.whitespaceNormalisedCer),
      percentage(result.cleaned.wer),
      `${result.cleaned.criticalTokens.matched}/${result.cleaned.criticalTokens.total}`,
    ].join(" | "),
  );
  const transitionRows = transitionSequence.map((result) =>
    [
      result.step,
      result.contentMode,
      `${JSON.stringify(result.adapterParameters.tessedit_pageseg_mode)} (${result.pageSegmentationJavaScriptType})`,
      result.runtimeMs.toFixed(0),
      percentage(result.raw.whitespaceNormalisedCer),
      percentage(result.raw.wer),
      percentage(result.cleaned.whitespaceNormalisedCer),
      percentage(result.cleaned.wer),
    ].join(" | "),
  );
  const markdown = `# Multi-column OCR layout A/B\n\nVariant: ${benchmarkVariant}\n\nSource: ${sourceDescription}\n\nGit HEAD: \`${gitHead}\`\n\nWorktree/source fingerprint: \`${report.worktreeSourceFingerprint}\`\n\nBoth arms use the same checked-in synthetic source, Original preparation, thresholding method 0 and one bounded recognition section. The controlled difference is Tesseract page segmentation value and JavaScript type. Parameters and recognition options are derived from the same production helpers used by the adapter.\n\nFixture | Mode | PSM value (JS type) | Strategy | Sections | Runtime ms | Raw whitespace CER | Raw WER | Raw tokens | Tidied whitespace CER | Tidied WER | Tidied tokens\n--- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:\n${markdownRows.join("\n")}\n\n## Reused-worker transition\n\nThe same page, selected image, prepared canvas and adapter run Document, Columns, then Document. The final Document text must exactly match the initial Document text, proving that typed layout state does not leak across modes.\n\nStep | Mode | PSM value (JS type) | Runtime ms | Raw whitespace CER | Raw WER | Tidied whitespace CER | Tidied WER\n--- | --- | --- | ---: | ---: | ---: | ---: | ---:\n${transitionRows.join("\n")}\n`;
  const reportDirectory = path.join(
    repositoryRoot,
    "tmp",
    "ocr-benchmark-reports",
    benchmarkVariant,
  );
  await mkdir(reportDirectory, { recursive: true });
  const jsonPath = path.join(reportDirectory, "layout-matrix.json");
  const markdownPath = path.join(reportDirectory, "layout-matrix.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  await testInfo.attach(`ocr-layout-${benchmarkVariant}.json`, {
    path: jsonPath,
    contentType: "application/json",
  });
  await testInfo.attach(`ocr-layout-${benchmarkVariant}.md`, {
    path: markdownPath,
    contentType: "text/markdown",
  });
});

test("fine deskew content-mode matrix @ocr-benchmark", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(300_000);
  const networkBoundary = await enforceBenchmarkNetworkBoundary(page, baseURL!);
  const sourceFixture = manifest.fixtures.find(
    (fixture) => fixture.id === "skew-three-degrees",
  );
  expect(sourceFixture).toBeDefined();
  if (!sourceFixture) return;
  const groundTruth = await readFile(
    path.join(corpusDirectory, sourceFixture.groundTruth),
    "utf8",
  );
  const modes: OcrContentMode[] = [
    "document",
    "columns",
    "screenshot",
    "code",
    "sparse",
    "single-line",
  ];
  const results = [];

  for (const contentMode of modes) {
    const recognised = await runFixture(page, {
      ...sourceFixture,
      contentMode,
      enhancementPreset: "adaptive-document",
    });
    results.push({
      contentMode,
      appliedEnhancementPreset: recognised.enhancementPreset,
      autoDeskewRequested: autoDeskewExpected(
        { ...sourceFixture, contentMode },
        recognised.enhancementPreset,
        recognised.contentMode,
      ),
      thresholdingMethod:
        recognised.preparation.thresholdingMethod === 0 ||
        recognised.preparation.thresholdingMethod === 1 ||
        recognised.preparation.thresholdingMethod === 2
          ? recognised.preparation.thresholdingMethod
          : recognised.enhancementPreset === "adaptive-document"
            ? adaptiveThresholdingMethod
            : 0,
      runtimeMs: recognised.runtimeMs,
      detectedDegrees: recognised.deskewDegrees,
      workingImage: recognised.workingImage,
      preparation: recognised.preparation,
      recognition: recognised.recognition,
      raw: measureOcrAccuracy(
        groundTruth,
        recognised.raw,
        sourceFixture.criticalTokens,
      ),
      cleaned: measureOcrAccuracy(
        groundTruth,
        recognised.cleaned,
        sourceFixture.criticalTokens,
      ),
    });
  }
  expect(networkBoundary.blockedExternalRequests).toEqual([]);
  expect(networkBoundary.blockedWebSockets).toEqual([]);

  const report = {
    schemaVersion: 1,
    benchmarkVariant,
    sourceDescription,
    generatedAt: new Date().toISOString(),
    gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim(),
    manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
    adaptiveThresholdingMethod,
    deskewPolicy,
    applicationAssets: await fingerprintApplication(page),
    fixtureId: sourceFixture.id,
    results,
  };
  const markdown = `# Fine deskew by content mode\n\nVariant: ${benchmarkVariant}\n\nSource: ${sourceDescription}\n\nAdaptive thresholding method: ${adaptiveThresholdingMethod}\n\nDeskew policy: ${deskewPolicy}\n\nMode | Deskew | Runtime ms | Detected angle | Raw whitespace CER | Raw WER | Raw tokens | Cleaned whitespace CER | Cleaned WER | Cleaned tokens\n--- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:\n${results
    .map(
      (result) =>
        `${result.contentMode} | ${result.autoDeskewRequested ? "on" : "off"} | ${result.runtimeMs.toFixed(0)} | ${result.detectedDegrees.toFixed(1)}° | ${percentage(result.raw.whitespaceNormalisedCer)} | ${percentage(result.raw.wer)} | ${result.raw.criticalTokens.matched}/${result.raw.criticalTokens.total} | ${percentage(result.cleaned.whitespaceNormalisedCer)} | ${percentage(result.cleaned.wer)} | ${result.cleaned.criticalTokens.matched}/${result.cleaned.criticalTokens.total}`,
    )
    .join("\n")}\n`;
  const reportDirectory = path.join(
    repositoryRoot,
    "tmp",
    "ocr-benchmark-reports",
    benchmarkVariant,
  );
  await mkdir(reportDirectory, { recursive: true });
  const jsonPath = path.join(reportDirectory, "deskew-matrix.json");
  const markdownPath = path.join(reportDirectory, "deskew-matrix.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  await testInfo.attach(`ocr-deskew-${benchmarkVariant}.json`, {
    path: jsonPath,
    contentType: "application/json",
  });
  await testInfo.attach(`ocr-deskew-${benchmarkVariant}.md`, {
    path: markdownPath,
    contentType: "text/markdown",
  });
});
