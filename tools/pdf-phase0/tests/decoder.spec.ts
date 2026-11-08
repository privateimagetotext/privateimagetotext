import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertPrivateRuntime,
  harnessOrigin,
  observeRuntime,
  openHarness,
  repositoryRoot,
  runScenario,
} from "./helpers";

const fixtures = [
  {
    fixture: "function_based_shading_cmyk.pdf",
    assets: [
      "/pdf/6.2.108/wasm/qcms_bg.wasm",
      "/pdf/6.2.108/iccs/CGATS001Compat-v2-micro.icc",
    ],
  },
  {
    fixture: "jpx_smaskindata.pdf",
    assets: ["/pdf/6.2.108/wasm/openjpeg.wasm"],
  },
  {
    fixture: "jbig2_file_header.pdf",
    assets: ["/pdf/6.2.108/wasm/jbig2.wasm"],
  },
] as const;

for (const fixture of fixtures) {
  test(`production adapter genuinely renders ${fixture.fixture}`, async ({ page }) => {
    const evidence = await observeRuntime(page);
    await openHarness(page);
    const result = await runScenario(page, fixture.fixture, "decoder");
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.rendered).toBe(true);
    expect(result.nonWhitePixels).toBeGreaterThan(0);
    expect(Number(result.width)).toBeLessThanOrEqual(4_096);
    expect(Number(result.height)).toBeLessThanOrEqual(4_096);

    const requestedPaths = evidence.requests.map(
      (request) => new URL(request.url).pathname,
    );
    expect(requestedPaths).toContain(
      "/pdf/6.2.108/worker/pdf.worker.min.mjs",
    );
    for (const asset of fixture.assets) {
      expect(requestedPaths).toContain(asset);
      const response = evidence.responses.find(
        (candidate) => new URL(candidate.url).pathname === asset,
      );
      expect(response?.status).toBe(200);
      expect(response?.contentType).not.toContain("text/html");
      expect(new URL(response!.url).origin).toBe(harnessOrigin);
    }
    if (test.info().project.name === "webkit" && fixture.fixture === "jpx_smaskindata.pdf") {
      expect(requestedPaths).toContain(
        "/pdf/6.2.108/wasm/openjpeg_nowasm_fallback.js",
      );
    } else {
      expect(requestedPaths).not.toContain(
        "/pdf/6.2.108/wasm/openjpeg_nowasm_fallback.js",
      );
    }
    expect(requestedPaths).not.toContain(
      "/pdf/6.2.108/wasm/jbig2_nowasm_fallback.js",
    );
    const workerState = await page.evaluate(
      () => window.__PDF_PHASE0__.workerEvidence,
    );
    expect(workerState.active).toBe(0);
    expect(workerState.constructed).toBe(workerState.terminated);
    await assertPrivateRuntime(page, evidence, [fixture.fixture]);
    const evidenceDirectory = path.join(
      repositoryRoot,
      "tmp",
      "pdf-phase0",
      "decoder-evidence",
    );
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      path.join(
        evidenceDirectory,
        `${test.info().project.name}-${fixture.fixture}.json`,
      ),
      `${JSON.stringify(
        {
          result,
          requests: evidence.requests.map((request) => request.url),
          responses: evidence.responses,
          consoleMessages: evidence.consoleMessages,
          pageErrors: evidence.pageErrors,
          workerUrls: evidence.workerUrls,
        },
        null,
        2,
      )}\n`,
    );
  });
}
