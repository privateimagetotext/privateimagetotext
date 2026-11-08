import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compose,
  type AffineMatrix,
  type PixelPoint,
  type PixelRect,
} from "../src/features/image-editor/coordinates";
import {
  assertFiniteNonSingularMatrix,
  associateExactTokens,
  containsPoint,
  envelopeIntersectionOverUnion,
  matrixRoundTripError,
  normalisedCentreError,
  polygonCentre,
  readingOrderErrors,
  summariseGeometryValues,
  type GeometrySummary,
} from "../src/features/ocr/word-geometry-metrics";
import type {
  EnhancementPreset,
  ImageTransform,
  OcrContentMode,
  PreparationMetadata,
  RecognitionSummary,
} from "../src/features/ocr/types";
import type {
  GeometryHarnessFixture,
  HarnessWordGeometry,
  HarnessWordSection,
} from "./ocr-geometry-harness";

type GeometryAnchor = {
  id: string;
  expectedToken: string;
  critical: boolean;
  readingOrder: number;
  polygon: readonly PixelPoint[];
  envelope: PixelRect;
};

type GeometryFixture = GeometryHarnessFixture & {
  anchors: readonly GeometryAnchor[];
  coordinateSpace: "source-image";
  pixelEdgeConvention: string;
  categoryTags: readonly string[];
  fastSmoke: boolean;
  generator: {
    font: string;
    fontSize: number;
    renderTransform: AffineMatrix;
  };
  imageSha256: string;
};

type GeometryManifest = {
  schemaVersion: number;
  generatedBy: string;
  syntheticContentOnly: boolean;
  coordinateSpaces: readonly string[];
  calibrationHistory: readonly { revision: number; reason: string }[];
  fixtures: readonly GeometryFixture[];
};

type BrowserFixtureResult = {
  id: string;
  runtimeMs: number;
  preparation: PreparationMetadata;
  raw: string;
  runnerRotateRadians: number;
  recognition: RecognitionSummary;
  wordSections: readonly HarnessWordSection[];
  words: readonly HarnessWordGeometry[];
};

type FixtureMetricResult = {
  id: string;
  categories: readonly string[];
  contentMode: OcrContentMode;
  enhancementPreset: EnhancementPreset;
  manualRotation: ImageTransform["rotation"];
  requestedFineSkewDegrees: number;
  expectedTilingStrategy: GeometryFixture["expectedTilingStrategy"];
  sourceSize: GeometryFixture["sourceSize"];
  crop: GeometryFixture["crop"];
  runtimeMs: number;
  preparation: PreparationMetadata;
  recognition: RecognitionSummary;
  wordSections: readonly HarnessWordSection[];
  observedWordCount: number;
  observedWords: readonly HarnessWordGeometry[];
  returnedFineDeskewRadians: readonly number[];
  matrixRoundTripMaximum: number;
  centreErrorSourcePixels: GeometrySummary | null;
  centreErrorByExpectedHeight: GeometrySummary | null;
  envelopeIou: { mean: number; minimum: number } | null;
  criticalAnchors: { matched: number; total: number };
  matchedAnchors: readonly {
    id: string;
    expectedToken: string;
    observedText: string;
    centreErrorSourcePixels: number;
    centreErrorByExpectedHeight: number;
    envelopeIou: number;
    expectedCentreInsideObserved: boolean;
  }[];
  missingAnchors: readonly string[];
  duplicateAnchors: readonly {
    expectedAnchorId: string;
    observedText: string;
    sourceOrder: number;
  }[];
  orderErrors: ReturnType<typeof readingOrderErrors>;
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, "..");
const corpusDirectory = path.join(
  currentDirectory,
  "fixtures",
  "ocr-geometry",
);
const manifestPath = path.join(corpusDirectory, "manifest.json");
const manifestText = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestText) as GeometryManifest;
const benchmarkVariant = process.env.OCR_GEOMETRY_VARIANT ?? "current";
const smokeOnly = process.env.OCR_GEOMETRY_SMOKE === "1";
const reportDirectory = path.resolve(
  process.env.OCR_GEOMETRY_REPORT_DIR ??
    path.join(
      repositoryRoot,
      "tmp",
      "ocr-geometry-reports",
      benchmarkVariant,
    ),
);

// Selected from the untouched-production calibrated baseline before runner
// word plumbing changed. Baseline extrema were 0.67 source px, 0.014 expected
// word heights and 0.959 envelope IoU. These margins allow raster/version
// rounding without weakening the coordinate contract into a visual guess.
const geometryTolerances = {
  maximumCentreErrorSourcePixels: 2,
  maximumCentreErrorExpectedHeights: 0.05,
  minimumEnvelopeIou: 0.9,
  maximumMatrixRoundTripError: 1e-8,
} as const;
const baselineEvidence = {
  variant: "baseline-current",
  gitHead: "5490d1ac67e77d4ec96722ca02239b3f910348f0",
  manifestSha256: "2b2bfd89da4124f1864bc60f02173689f34c8f049f71c16afa963cd16fb9d7c3",
  maximumCentreErrorSourcePixels: 0.6651056471217983,
  maximumCentreErrorExpectedHeights: 0.0137033187239083,
  minimumEnvelopeIou: 0.958718670268336,
} as const;

const sourceModulePaths = [
  "src/features/image-editor/coordinates.ts",
  "src/features/image-editor/image.ts",
  "src/features/image-editor/preparation.ts",
  "src/features/ocr/recognition-runner.ts",
  "src/features/ocr/tesseract-adapter.ts",
  "src/features/ocr/tiling.ts",
  "src/features/ocr/types.ts",
  "src/features/ocr/word-geometry.ts",
  "src/features/ocr/word-geometry-metrics.ts",
  "src/pages/ToolPage.tsx",
  "src/pages/TechnicalHowItWorksPage.tsx",
  "package.json",
  "pnpm-lock.yaml",
  "playwright.config.ts",
  "vite.config.ts",
  "scripts/ocr-assets.manifest.json",
] as const;

const benchmarkSourcePaths = [
  "e2e/ocr-geometry.spec.ts",
  "e2e/ocr-geometry-harness.ts",
  "e2e/ocr-geometry-harness.html",
  "scripts/generate-ocr-geometry-corpus.mjs",
  "scripts/run-ocr-geometry.mjs",
] as const;

function sha256(content: string | Uint8Array) {
  return createHash("sha256").update(content).digest("hex");
}

async function fileHash(relativePath: string) {
  return sha256(await readFile(path.join(repositoryRoot, relativePath)));
}

async function hashPaths(paths: readonly string[]) {
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (relativePath) => [relativePath, await fileHash(relativePath)]),
    ),
  );
}

function safeSummary(values: readonly number[]) {
  return values.length === 0 ? null : summariseGeometryValues(values);
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sectionRoundTripError(
  recognition: RecognitionSummary,
  section: HarnessWordSection,
) {
  const sourceToEngine = compose(
    recognition.coordinates.sourceToOriented,
    section.orientedToPrepared,
    section.preparedToEngine,
  );
  const engineToSource = compose(
    section.engineToPrepared,
    section.preparedToOriented,
    recognition.coordinates.orientedToSource,
  );
  assertFiniteNonSingularMatrix(sourceToEngine);
  assertFiniteNonSingularMatrix(engineToSource);
  const crop = recognition.coordinates.sourceCrop;
  const points = [
    { x: crop.x, y: crop.y },
    { x: crop.x + crop.width, y: crop.y },
    { x: crop.x + crop.width, y: crop.y + crop.height },
    { x: crop.x, y: crop.y + crop.height },
    { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 },
  ];
  return matrixRoundTripError(sourceToEngine, engineToSource, points);
}

function measureFixture(
  fixture: GeometryFixture,
  browserResult: BrowserFixtureResult,
): FixtureMetricResult {
  const association = associateExactTokens(
    fixture.anchors,
    browserResult.words.map((word, sourceOrder) => ({
      text: word.text,
      polygon: word.sourceImage.polygon,
      sourceOrder,
    })),
  );
  const matchedAnchors = association.matches.map((match) => {
    const observedWord = browserResult.words[match.observed.sourceOrder];
    if (!observedWord) throw new Error(`Lost observed word for ${match.expected.id}.`);
    const centreErrorByExpectedHeight = normalisedCentreError(
      match.expected.polygon,
      match.observed.polygon,
    );
    const envelopeIou = envelopeIntersectionOverUnion(
      match.expected.polygon,
      match.observed.polygon,
    );
    return {
      id: match.expected.id,
      expectedToken: match.expected.expectedToken,
      observedText: match.observed.text,
      centreErrorSourcePixels: match.centreError,
      centreErrorByExpectedHeight,
      envelopeIou,
      expectedCentreInsideObserved: containsPoint(
        observedWord.sourceImage.polygon,
        polygonCentre(match.expected.polygon),
      ),
    };
  });
  const centreErrors = matchedAnchors.map(
    (match) => match.centreErrorSourcePixels,
  );
  const normalisedErrors = matchedAnchors.map(
    (match) => match.centreErrorByExpectedHeight,
  );
  const ious = matchedAnchors.map((match) => match.envelopeIou);
  const criticalTotal = fixture.anchors.filter((anchor) => anchor.critical).length;
  const criticalMatched = association.matches.filter(
    (match) => match.expected.critical,
  ).length;
  const roundTrips = browserResult.wordSections.map((section) =>
    sectionRoundTripError(browserResult.recognition, section),
  );

  return {
    id: fixture.id,
    categories: fixture.categoryTags,
    contentMode: fixture.contentMode,
    enhancementPreset: fixture.enhancementPreset,
    manualRotation: fixture.manualRotation,
    requestedFineSkewDegrees: fixture.fineSkewDegrees,
    expectedTilingStrategy: fixture.expectedTilingStrategy,
    sourceSize: fixture.sourceSize,
    crop: fixture.crop,
    runtimeMs: browserResult.runtimeMs,
    preparation: browserResult.preparation,
    recognition: browserResult.recognition,
    wordSections: browserResult.wordSections,
    observedWordCount: browserResult.words.length,
    observedWords: browserResult.words,
    returnedFineDeskewRadians: browserResult.wordSections.map(
      (section) => section.rotateRadians,
    ),
    matrixRoundTripMaximum: roundTrips.length ? Math.max(...roundTrips) : 0,
    centreErrorSourcePixels: safeSummary(centreErrors),
    centreErrorByExpectedHeight: safeSummary(normalisedErrors),
    envelopeIou:
      ious.length === 0 ? null : { mean: mean(ious), minimum: Math.min(...ious) },
    criticalAnchors: { matched: criticalMatched, total: criticalTotal },
    matchedAnchors,
    missingAnchors: association.missing.map((anchor) => anchor.id),
    duplicateAnchors: association.duplicates.map((duplicate) => ({
      expectedAnchorId: duplicate.expectedAnchorId,
      observedText: duplicate.observed.text,
      sourceOrder: duplicate.observed.sourceOrder,
    })),
    orderErrors: readingOrderErrors(association.matches),
  };
}

function aggregateByCategory(results: readonly FixtureMetricResult[]) {
  const categories = new Set(results.flatMap((result) => result.categories));
  return [...categories].sort().map((category) => {
    const categoryResults = results.filter((result) =>
      result.categories.includes(category),
    );
    const matches = categoryResults.flatMap((result) => result.matchedAnchors);
    return {
      category,
      fixtures: categoryResults.length,
      runtimeMs: categoryResults.reduce(
        (sum, result) => sum + result.runtimeMs,
        0,
      ),
      centreErrorSourcePixels: safeSummary(
        matches.map((match) => match.centreErrorSourcePixels),
      ),
      centreErrorByExpectedHeight: safeSummary(
        matches.map((match) => match.centreErrorByExpectedHeight),
      ),
      envelopeIou:
        matches.length === 0
          ? null
          : {
              mean: mean(matches.map((match) => match.envelopeIou)),
              minimum: Math.min(...matches.map((match) => match.envelopeIou)),
            },
      criticalAnchors: {
        matched: categoryResults.reduce(
          (sum, result) => sum + result.criticalAnchors.matched,
          0,
        ),
        total: categoryResults.reduce(
          (sum, result) => sum + result.criticalAnchors.total,
          0,
        ),
      },
      missingAnchors: categoryResults.flatMap((result) => result.missingAnchors),
      duplicateAnchors: categoryResults.flatMap(
        (result) => result.duplicateAnchors,
      ),
      orderErrors: categoryResults.flatMap((result) => result.orderErrors),
    };
  });
}

function formatNumber(value: number | undefined, digits = 2) {
  return value === undefined ? "n/a" : value.toFixed(digits);
}

function createMarkdownReport(report: {
  benchmarkVariant: string;
  generatedAt: string;
  gitHead: string;
  worktreeDirty: boolean;
  worktreeSourceFingerprint: string;
  browser: { name: string; version: string };
  manifestSha256: string;
  geometryTolerances: typeof geometryTolerances;
  baselineEvidence: typeof baselineEvidence;
  fixtures: readonly FixtureMetricResult[];
  categories: ReturnType<typeof aggregateByCategory>;
}) {
  const fixtureRows = report.fixtures.map(
    (result) =>
      `${result.id} | ${result.manualRotation} | ${result.requestedFineSkewDegrees} | ${result.recognition.strategy} | ${result.recognition.sectionCount} | ${result.criticalAnchors.matched}/${result.criticalAnchors.total} | ${result.missingAnchors.length} | ${result.duplicateAnchors.length} | ${result.orderErrors.length} | ${formatNumber(result.centreErrorSourcePixels?.mean)} | ${formatNumber(result.centreErrorSourcePixels?.median)} | ${formatNumber(result.centreErrorSourcePixels?.percentile95)} | ${formatNumber(result.centreErrorSourcePixels?.maximum)} | ${formatNumber(result.centreErrorByExpectedHeight?.percentile95, 3)} | ${formatNumber(result.envelopeIou?.mean, 3)} | ${formatNumber(result.envelopeIou?.minimum, 3)} | ${formatNumber(result.runtimeMs, 0)}`,
  );
  const categoryRows = report.categories.map(
    (category) =>
      `${category.category} | ${category.fixtures} | ${category.criticalAnchors.matched}/${category.criticalAnchors.total} | ${category.missingAnchors.length} | ${category.duplicateAnchors.length} | ${category.orderErrors.length} | ${formatNumber(category.centreErrorSourcePixels?.mean)} | ${formatNumber(category.centreErrorSourcePixels?.median)} | ${formatNumber(category.centreErrorSourcePixels?.percentile95)} | ${formatNumber(category.centreErrorSourcePixels?.maximum)} | ${formatNumber(category.envelopeIou?.mean, 3)} | ${formatNumber(category.envelopeIou?.minimum, 3)}`,
  );
  return `# OCR word geometry benchmark\n\nVariant: ${report.benchmarkVariant}\n\nGenerated: ${report.generatedAt}\n\nGit HEAD: \`${report.gitHead}\`\n\nWorktree dirty: ${report.worktreeDirty ? "yes" : "no"}\n\nWorktree/source fingerprint: \`${report.worktreeSourceFingerprint}\`\n\nBrowser: ${report.browser.name} ${report.browser.version}\n\nCorpus manifest SHA-256: \`${report.manifestSha256}\`\n\nBaseline evidence: max ${report.baselineEvidence.maximumCentreErrorSourcePixels.toFixed(3)} source px, max ${report.baselineEvidence.maximumCentreErrorExpectedHeights.toFixed(3)} expected heights, min IoU ${report.baselineEvidence.minimumEnvelopeIou.toFixed(3)}. Gates: max ${report.geometryTolerances.maximumCentreErrorSourcePixels.toFixed(2)} source px, max ${report.geometryTolerances.maximumCentreErrorExpectedHeights.toFixed(2)} expected heights, min IoU ${report.geometryTolerances.minimumEnvelopeIou.toFixed(2)}.\n\nCoordinates are floating-point pixel edges. Centre error is reported in original source-image pixels and normalised by the generated expected word height. IoU uses axis-aligned source-space envelopes because engine boxes and browser glyph rectangles are not expected to share exact typographic bounds.\n\n## Per fixture\n\nFixture | Rotation | Requested skew degrees | Strategy | Sections | Critical | Missing | Duplicates | Order errors | Mean centre px | Median centre px | P95 centre px | Max centre px | P95 / height | Mean IoU | Min IoU | Runtime ms\n--- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:\n${fixtureRows.join("\n")}\n\n## Per category\n\nCategory | Fixtures | Critical | Missing | Duplicates | Order errors | Mean centre px | Median centre px | P95 centre px | Max centre px | Mean IoU | Min IoU\n--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:\n${categoryRows.join("\n")}\n`;
}

async function runBrowserCorpus(
  page: Page,
  fixtures: readonly GeometryFixture[],
) {
  return page.evaluate(async (browserFixtures) => {
    const harnessPath = "/e2e/ocr-geometry-harness.ts";
    const harness = (await import(/* @vite-ignore */ harnessPath)) as {
      runGeometryFixtures: (
        input: readonly GeometryHarnessFixture[],
      ) => Promise<BrowserFixtureResult[]>;
    };
    return harness.runGeometryFixtures(browserFixtures);
  }, fixtures);
}

async function attachReports(
  page: Page,
  testInfo: TestInfo,
  fixtures: readonly GeometryFixture[],
  results: readonly FixtureMetricResult[],
) {
  const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const gitStatus = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: repositoryRoot },
  );
  const trackedWorktreeDiff = execFileSync(
    "git",
    ["diff", "--binary", "HEAD", "--", "."],
    { cwd: repositoryRoot },
  );
  const applicationSourceHashes = await hashPaths(sourceModulePaths);
  const benchmarkSourceHashes = await hashPaths(benchmarkSourcePaths);
  const fixtureHashes = await Promise.all(
    fixtures.map(async (fixture) => {
      const imageSha256 = await fileHash(
        path.join("e2e", "fixtures", "ocr-geometry", fixture.image),
      );
      expect(imageSha256, `${fixture.id} generated image hash`).toBe(
        fixture.imageSha256,
      );
      return {
        id: fixture.id,
        image: fixture.image,
        imageSha256,
        geometrySidecarSha256: sha256(JSON.stringify(fixture)),
      };
    }),
  );
  const ocrAssetManifest = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "scripts", "ocr-assets.manifest.json"),
      "utf8",
    ),
  ) as {
    assets: readonly { destination: string }[];
  };
  const ocrAssetHashes = Object.fromEntries(
    await Promise.all(
      ocrAssetManifest.assets.map(async ({ destination }) => [
        destination,
        await fileHash(destination),
      ]),
    ),
  );
  const worktreeSourceFingerprint = sha256(
    JSON.stringify({
      gitHead,
      statusSha256: sha256(gitStatus),
      trackedWorktreeDiffSha256: sha256(trackedWorktreeDiff),
      applicationSourceHashes,
      benchmarkSourceHashes,
      fixtureHashes,
      ocrAssetHashes,
    }),
  );
  const browser = page.context().browser();
  const report = {
    schemaVersion: 1,
    benchmarkVariant,
    smokeOnly,
    generatedAt: new Date().toISOString(),
    gitHead,
    worktreeDirty: gitStatus.length > 0,
    worktreeStatusSha256: sha256(gitStatus),
    trackedWorktreeDiffSha256: sha256(trackedWorktreeDiff),
    worktreeSourceFingerprint,
    browser: {
      name: browser?.browserType().name() ?? "unknown",
      version: browser?.version() ?? "unknown",
    },
    manifestSha256: sha256(manifestText),
    geometryTolerances,
    baselineEvidence,
    fixtureHashes,
    applicationSourceHashes,
    benchmarkSourceHashes,
    ocrAssetHashes,
    corpus: {
      schemaVersion: manifest.schemaVersion,
      generatedBy: manifest.generatedBy,
      syntheticContentOnly: manifest.syntheticContentOnly,
      coordinateSpaces: manifest.coordinateSpaces,
      calibrationHistory: manifest.calibrationHistory,
    },
    fixtures: results,
    categories: aggregateByCategory(results),
  };
  const markdown = createMarkdownReport(report);
  await mkdir(reportDirectory, { recursive: true });
  const jsonPath = path.join(reportDirectory, "report.json");
  const markdownPath = path.join(reportDirectory, "report.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  await testInfo.attach(`ocr-geometry-${benchmarkVariant}.json`, {
    path: jsonPath,
    contentType: "application/json",
  });
  await testInfo.attach(`ocr-geometry-${benchmarkVariant}.md`, {
    path: markdownPath,
    contentType: "text/markdown",
  });
}

test("real local OCR word geometry @ocr-geometry", async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);
  expect(manifest.syntheticContentOnly).toBe(true);
  expect(manifest.coordinateSpaces).toEqual([
    "source-image",
    "oriented-page",
    "prepared-section",
    "engine-section",
  ]);
  expect(manifest.fixtures).toHaveLength(10);
  const fixtures = smokeOnly
    ? manifest.fixtures.filter((fixture) => fixture.fastSmoke)
    : manifest.fixtures;
  expect(fixtures.length).toBeGreaterThan(0);

  const baseUrl = testInfo.project.use.baseURL;
  if (typeof baseUrl !== "string") throw new Error("Geometry base URL is missing.");
  const expectedOrigin = new URL(baseUrl).origin;
  const expectedHost = new URL(baseUrl).host;
  const externalRequests: string[] = [];
  page.on("websocket", (webSocket) => {
    const url = webSocket.url();
    if (new URL(url).host !== expectedHost) {
      externalRequests.push(`websocket:${url}`);
    }
  });
  await page.context().route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http") && new URL(url).origin !== expectedOrigin) {
      externalRequests.push(url);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await page.goto("/e2e/ocr-geometry-harness.html");
  const browserResults = await runBrowserCorpus(page, fixtures);
  const results = fixtures.map((fixture) => {
    const browserResult = browserResults.find((result) => result.id === fixture.id);
    if (!browserResult) throw new Error(`Missing browser result for ${fixture.id}.`);
    return measureFixture(fixture, browserResult);
  });
  await attachReports(page, testInfo, fixtures, results);

  expect(externalRequests).toEqual([]);
  for (const result of results) {
    expect(result.recognition.strategy, result.id).toBe(
      result.expectedTilingStrategy,
    );
    expect(result.observedWordCount, result.id).toBeGreaterThan(0);
    expect(result.recognition.coordinates.sourceCrop, result.id).toEqual(
      result.crop.sourcePixelEdges,
    );
    expect(result.matrixRoundTripMaximum, result.id).toBeLessThanOrEqual(
      geometryTolerances.maximumMatrixRoundTripError,
    );
    expect(result.criticalAnchors.matched, result.id).toBe(
      result.criticalAnchors.total,
    );
    expect(result.duplicateAnchors, result.id).toEqual([]);
    expect(result.orderErrors, result.id).toEqual([]);
    expect(result.centreErrorSourcePixels?.maximum, result.id).toBeLessThanOrEqual(
      geometryTolerances.maximumCentreErrorSourcePixels,
    );
    expect(
      result.centreErrorByExpectedHeight?.maximum,
      result.id,
    ).toBeLessThanOrEqual(
      geometryTolerances.maximumCentreErrorExpectedHeights,
    );
    expect(result.envelopeIou?.minimum, result.id).toBeGreaterThanOrEqual(
      geometryTolerances.minimumEnvelopeIou,
    );
    for (const word of result.observedWords) {
      expect(word.engineSection.space, result.id).toBe("engine-section");
      expect(word.preparedSection.space, result.id).toBe("prepared-section");
      expect(word.orientedPage.space, result.id).toBe("oriented-page");
      expect(word.sourceImage.space, result.id).toBe("source-image");
    }
  }
  const crop = results.find((result) => result.id === "odd-crop-rounded-preview");
  expect(crop?.preparation.scaleAction).toBe("reduced");
  expect(crop?.preparation.scaleX).not.toBe(crop?.preparation.scaleY);
  const enlarged = results.find((result) => result.id === "adaptive-enlargement");
  expect(enlarged?.preparation.scaleAction).toBe("enlarged");
  const tiled = results.find((result) => result.id === "native-tile-seams");
  expect(tiled?.recognition.sectionCount).toBeGreaterThan(1);
  for (let index = 1; index < (tiled?.recognition.sections.length ?? 0); index += 1) {
    const previous = tiled!.recognition.sections[index - 1].inputRect;
    const current = tiled!.recognition.sections[index].inputRect;
    expect(previous.y + previous.height - current.y).toBe(256);
  }
  const positiveSkew = results.find((result) => result.id === "positive-fine-skew");
  const negativeSkew = results.find((result) => result.id === "negative-fine-skew");
  expect(
    (positiveSkew?.returnedFineDeskewRadians[0] ?? 0) * (180 / Math.PI),
  ).toBeLessThanOrEqual(-2);
  expect(
    (positiveSkew?.returnedFineDeskewRadians[0] ?? 0) * (180 / Math.PI),
  ).toBeGreaterThanOrEqual(-4);
  expect(
    (negativeSkew?.returnedFineDeskewRadians[0] ?? 0) * (180 / Math.PI),
  ).toBeGreaterThanOrEqual(2);
  expect(
    (negativeSkew?.returnedFineDeskewRadians[0] ?? 0) * (180 / Math.PI),
  ).toBeLessThanOrEqual(4);
});
