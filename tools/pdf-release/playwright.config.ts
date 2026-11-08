import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const outputDir = process.env.PDF_RELEASE_RESULTS_DIRECTORY ?? "../../tmp/pdf-release-corpus/test-results";

// Deliberately does not start or rebuild the shared application server.
export default defineConfig({
  testDir: ".",
  testMatch: /corpus\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 360_000,
  expect: { timeout: 60_000 },
  outputDir,
  reporter: [["list"], ["json", { outputFile: path.resolve(import.meta.dirname, outputDir, "playwright-results.json") }]],
  use: {
    baseURL: process.env.PDF_RELEASE_BASE_URL ?? "http://127.0.0.1:4173",
    bypassCSP: false,
    serviceWorkers: "allow",
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
