import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  fixtureDirectory,
  harnessOrigin,
  observeRuntime,
  openHarness,
  runScenario,
} from "./helpers";

test.use({ serviceWorkers: "allow" });

const decoderFixtures = [
  "function_based_shading_cmyk.pdf",
  "jpx_smaskindata.pdf",
  "jbig2_file_header.pdf",
] as const;

test("explicit PDF cache preparation supports genuine decoder rendering offline", async ({
  page,
  context,
}) => {
  test.setTimeout(360_000);
  const evidence = await observeRuntime(page);
  await openHarness(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        }),
      );
    }
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await expect(page.evaluate(() => window.__PDF_PHASE0__.checkPdfCache())).resolves.toBe(
    false,
  );
  const prepared = await page.evaluate(() => window.__PDF_PHASE0__.preparePdfCache());
  const preparationFailure = await page.evaluate(
    () => window.__PDF_PHASE0__.pdfCacheFailure,
  );
  expect(prepared, JSON.stringify(preparationFailure)).toBe(true);
  await expect(page.evaluate(() => window.__PDF_PHASE0__.checkPdfCache())).resolves.toBe(
    true,
  );

  const online = [];
  for (const fixture of decoderFixtures) {
    online.push(await runScenario(page, fixture, "decoder"));
  }
  expect(online.every((result) => result.rendered === true)).toBe(true);

  const inMemoryFixtures = await Promise.all(
    decoderFixtures.map(async (fixture) => ({
      fixture,
      bytes: [...(await readFile(path.join(fixtureDirectory, fixture)))],
    })),
  );
  await page.evaluate(
    (fixtures) => window.__PDF_PHASE0__.stageDecoderBytes(fixtures),
    inMemoryFixtures.map((fixture) => fixture.bytes),
  );

  const usesBrowserOffline = test.info().project.name === "chromium";
  if (usesBrowserOffline) {
    await context.setOffline(true);
  } else {
    const blocked = await page.request.post(
      `${harnessOrigin}/__pdf-phase1a/network-block?enabled=1`,
    );
    expect(blocked.status()).toBe(204);
    const originProbe = await page.request.get(
      `${harnessOrigin}/pdf/6.2.108/not-allowlisted.bin`,
    );
    expect(originProbe.status()).toBe(503);
  }
  const offline = [];
  try {
    for (const [index] of inMemoryFixtures.entries()) {
      offline.push(
        await page.evaluate(
          (fixtureIndex) => window.__PDF_PHASE0__.runStagedDecoder(fixtureIndex),
          index,
        ),
      );
    }
  } catch (error) {
    if (usesBrowserOffline) await context.setOffline(false);
    else {
      await page.request.post(
        `${harnessOrigin}/__pdf-phase1a/network-block?enabled=0`,
      );
    }
    const diagnostics = await page.evaluate(() => ({
      lastError: window.__PDF_PHASE0__.lastError,
      workers: window.__PDF_PHASE0__.workerEvidence,
    }));
    throw new Error(
      `Offline decoder failed: ${JSON.stringify({
        diagnostics,
        requests: evidence.requests.slice(-20).map((request) => request.url),
        responses: evidence.responses.slice(-20),
        originalError: error instanceof Error ? error.message : "unknown",
      })}`,
    );
  }
  expect(offline.every((result) => result.rendered === true)).toBe(true);
  if (usesBrowserOffline) await context.setOffline(false);
  else {
    await page.request.post(
      `${harnessOrigin}/__pdf-phase1a/network-block?enabled=0`,
    );
  }
  await page.evaluate(() => window.__PDF_PHASE0__.clearStagedDecoderBytes());

  const state = await page.evaluate(async (forbidden) => {
    const cacheNames = await caches.keys();
    const pdfCache = await caches.open("localtext-pdf-v1-pdfjs-6.2.108");
    const keys = (await pdfCache.keys()).map((request) => request.url);
    const databases = "databases" in indexedDB ? await indexedDB.databases() : [];
    return {
      cacheNames,
      keys,
      forbiddenInKeys: forbidden.filter((value) =>
        JSON.stringify(keys).includes(value),
      ),
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      databases: databases.map((database) => database.name),
      cookie: document.cookie,
      href: location.href,
      workers: window.__PDF_PHASE0__.workerEvidence,
    };
  }, [...decoderFixtures, "phase0-only", "PASSWORD FIXTURE OPEN 424242"]);
  expect(state.cacheNames).toContain("localtext-pdf-v1-pdfjs-6.2.108");
  expect(state.cacheNames).not.toContain(
    "localtext-pdf-v1-pdfjs-6.2.108-staging",
  );
  // One reviewed sentinel entry accompanies every manifest asset so partial
  // preparation can never be reported as ready.
  expect(state.keys).toHaveLength(202);
  expect(state.forbiddenInKeys).toEqual([]);
  expect(state.localStorage).toEqual({});
  expect(state.sessionStorage).toEqual({});
  expect(state.databases).toEqual([]);
  expect(state.cookie).toBe("");
  expect(state.href).not.toContain(".pdf");
  expect(state.workers.active).toBe(0);
  expect(state.workers.constructed).toBe(state.workers.terminated);
  expect(evidence.externalRequests).toEqual([]);
  expect(evidence.pageErrors).toEqual([]);
  expect(
    evidence.consoleMessages.filter((message) =>
      /fake worker|content security policy|securitypolicyviolation|refused to/i.test(
        message,
      ),
    ),
  ).toEqual([]);
});
