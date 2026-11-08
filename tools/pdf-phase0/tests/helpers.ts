import { expect, type Page, type TestInfo } from "@playwright/test";
import path from "node:path";

export const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
export const fixtureDirectory = path.join(repositoryRoot, "tmp", "pdf-phase0", "fixtures");
export const harnessOrigin = "http://127.0.0.1:4180";

export type RequestEvidence = {
  method: string;
  resourceType: string;
  url: string;
  headers: Record<string, string>;
  postData: string | null;
};

export type RuntimeEvidence = {
  requests: RequestEvidence[];
  responses: Array<{
    url: string;
    status: number;
    contentType: string;
    fromServiceWorker: boolean;
  }>;
  externalRequests: string[];
  consoleMessages: string[];
  pageErrors: string[];
  workerUrls: string[];
};

export async function observeRuntime(page: Page) {
  const evidence: RuntimeEvidence = {
    requests: [],
    responses: [],
    externalRequests: [],
    consoleMessages: [],
    pageErrors: [],
    workerUrls: [],
  };

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== harnessOrigin) {
      evidence.externalRequests.push(request.url());
      await route.abort("blockedbyclient");
      return;
    }
    evidence.requests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
      headers: await request.allHeaders(),
      postData: request.postData(),
    });
    await route.continue();
  });
  page.on("console", (message) => evidence.consoleMessages.push(message.text()));
  page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
  page.on("worker", (worker) => evidence.workerUrls.push(worker.url()));
  page.on("response", async (response) => {
    evidence.responses.push({
      url: response.url(),
      status: response.status(),
      contentType: (await response.allHeaders())["content-type"] ?? "",
      fromServiceWorker: response.fromServiceWorker(),
    });
  });
  return evidence;
}

export async function openHarness(page: Page) {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("worker-src 'self' blob:");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toContain("'unsafe-inline'");
}

export async function runScenario(
  page: Page,
  fixture: string,
  scenario: string,
  options: { cancelAfterOne?: boolean } = {},
) {
  await page.locator("#pdf-file").setInputFiles(path.join(fixtureDirectory, fixture));
  await page.locator("#scenario").selectOption(scenario);
  await page.locator("#cancel-after-one").setChecked(options.cancelAfterOne === true);
  await page.locator("#run").click();
  await page.waitForFunction(
    () =>
      window.__PDF_PHASE0__.lastResult !== null ||
      window.__PDF_PHASE0__.lastError !== null,
    undefined,
    { timeout: 60_000 },
  );
  const state = await page.evaluate(() => window.__PDF_PHASE0__);
  expect(state.lastError).toBeNull();
  return state.lastResult as Record<string, unknown>;
}

export async function assertPrivateRuntime(
  page: Page,
  evidence: RuntimeEvidence,
  secrets: readonly string[],
) {
  expect(evidence.externalRequests).toEqual([]);
  expect(evidence.pageErrors).toEqual([]);
  const unsafeConsole = evidence.consoleMessages.filter((message) =>
    /fake worker|content security policy|securitypolicyviolation|refused to/i.test(message),
  );
  expect(unsafeConsole).toEqual([]);
  const networkText = JSON.stringify(evidence.requests);
  for (const secret of secrets) expect(networkText).not.toContain(secret);

  const storage = await page.evaluate(async (forbiddenValues) => {
    async function inspectDatabase(databaseName: string) {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const stores = [];
        for (const storeName of Array.from(database.objectStoreNames)) {
          const transaction = database.transaction(storeName, "readonly");
          const store = transaction.objectStore(storeName);
          const [keys, values] = await Promise.all([
            new Promise<IDBValidKey[]>((resolve, reject) => {
              const request = store.getAllKeys();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            }),
            new Promise<unknown[]>((resolve, reject) => {
              const request = store.getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            }),
          ]);
          const text = await Promise.all(
            values.map(async (value) => {
              if (typeof value === "string") return value;
              if (value instanceof Blob) return value.text();
              if (value instanceof ArrayBuffer) {
                return new TextDecoder().decode(new Uint8Array(value));
              }
              if (ArrayBuffer.isView(value)) {
                return new TextDecoder().decode(
                  new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
                );
              }
              try {
                return JSON.stringify(value);
              } catch {
                return "";
              }
            }),
          );
          const searchable = `${JSON.stringify(keys)}\n${text.join("\n")}`;
          stores.push({
            name: storeName,
            recordCount: values.length,
            forbiddenMatches: forbiddenValues.filter((value) => searchable.includes(value)),
          });
        }
        return { name: databaseName, stores };
      } finally {
        database.close();
      }
    }

    const databases =
      "databases" in indexedDB ? await indexedDB.databases() : [];
    return {
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      indexedDb: await Promise.all(
        databases.flatMap((database) =>
          database.name ? [inspectDatabase(database.name)] : [],
        ),
      ),
      caches: "caches" in window ? await caches.keys() : [],
      cookie: document.cookie,
      href: location.href,
    };
  }, [...secrets]);
  expect(storage.localStorage).toEqual({});
  expect(storage.sessionStorage).toEqual({});
  expect(
    storage.indexedDb.flatMap((database) =>
      database.stores.flatMap((store) => store.forbiddenMatches),
    ),
  ).toEqual([]);
  expect(storage.caches).toEqual([]);
  expect(storage.cookie).toBe("");
  for (const secret of secrets) expect(JSON.stringify(storage)).not.toContain(secret);
}

export function annotateEnvironment(testInfo: TestInfo) {
  return {
    project: testInfo.project.name,
    browserName: testInfo.project.use.browserName,
    viewport: testInfo.project.use.viewport,
    deviceEmulation: testInfo.project.name === "mobile-chromium-emulation",
  };
}
