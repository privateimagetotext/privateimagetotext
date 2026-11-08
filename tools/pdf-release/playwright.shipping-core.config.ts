import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const requested = process.env.PDF_SHIPPING_RESULTS_DIRECTORY;
const baseURL = process.env.PDF_SHIPPING_BASE_URL;
const identityPath = process.env.PDF_SHIPPING_IDENTITY;
if (!requested || !identityPath || !baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseURL)) {
  throw new Error("Set a loopback PDF_SHIPPING_BASE_URL, recorded PDF_SHIPPING_IDENTITY, and new PDF_SHIPPING_RESULTS_DIRECTORY.");
}
const outputDir = path.resolve(requested);
const temporaryRoot = path.resolve(import.meta.dirname, "../../tmp");
const relative = path.relative(temporaryRoot, outputDir);
const relativeIdentity = path.relative(temporaryRoot, path.resolve(identityPath));
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)
  || !relativeIdentity || relativeIdentity.startsWith("..") || path.isAbsolute(relativeIdentity)
  || (existsSync(outputDir) && process.env.PDF_SHIPPING_ACTIVE_OUTPUT !== outputDir)) {
  throw new Error("Shipping evidence must use a new results directory and identity below repo tmp.");
}
// The coordinator validates a fresh directory before Playwright creates it;
// worker re-imports inherit this marker. A new invocation cannot reuse evidence.
process.env.PDF_SHIPPING_ACTIVE_OUTPUT = outputDir;
const identity = JSON.parse(readFileSync(identityPath, "utf8"));
if (identity.baseURL !== baseURL || identity.buildId !== process.env.PDF_RELEASE_BUILD_ID
  || !identity.browsers?.every((browser: { channel: string; version: string }) =>
    ["chrome", "msedge"].includes(browser.channel) && /^\d+\.\d+\.\d+\.\d+$/u.test(browser.version))
  || identity.browsers.length !== 2) {
  throw new Error("Recorded shipping identity does not match this invocation.");
}

export default defineConfig({
  testDir: "../../e2e",
  testMatch: /pdf-phase1c-preview\.spec\.ts/,
  grep: /@phase1c-core/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 360_000,
  expect: { timeout: 60_000 },
  outputDir,
  metadata: { shippingIdentity: identity },
  reporter: [["list"], ["json", { outputFile: path.join(outputDir, "playwright-results.json") }]],
  use: {
    baseURL,
    headless: true,
    bypassCSP: false,
    serviceWorkers: "allow",
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "shipping-chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "shipping-edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
  ],
  // This deliberately reuses the six existing tests without building or serving.
});
