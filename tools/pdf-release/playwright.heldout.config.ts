import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const outputDir = process.env.PDF_HELDOUT_RESULTS_DIRECTORY
  ?? path.resolve(import.meta.dirname, "../../tmp/pdf-release-corpus/heldout-results");

export default defineConfig({
  testDir: ".",
  testMatch: /heldout\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  timeout: 360_000,
  expect: { timeout: 60_000 },
  outputDir,
  reporter: [["list"], ["json", { outputFile: path.join(outputDir, "playwright-results.json") }]],
  use: {
    baseURL: process.env.PDF_RELEASE_BASE_URL ?? "http://127.0.0.1:4173",
    bypassCSP: false,
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  // No shared dist writes, build command or server launcher.
});
