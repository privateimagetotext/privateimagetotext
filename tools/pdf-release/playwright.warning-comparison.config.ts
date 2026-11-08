import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const requested = process.env.PDF_WARNING_RESULTS_DIRECTORY;
if (!requested) throw new Error("Set a new PDF_WARNING_RESULTS_DIRECTORY for this bounded comparison.");
const outputDir = path.resolve(requested);
const temporaryRoot = path.resolve(import.meta.dirname, "../../tmp");
const relativeOutput = path.relative(temporaryRoot, outputDir);
if (relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)
  || !relativeOutput.split(path.sep).some((segment) => segment.includes("warning"))) {
  throw new Error("Warning comparison output must be in a separate warning-named path below repo tmp.");
}

export default defineConfig({
  testDir: ".",
  testMatch: /warning-comparison\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 360_000,
  expect: { timeout: 60_000 },
  outputDir,
  reporter: [["list"], ["json", { outputFile: path.join(outputDir, "playwright-results.json") }]],
  use: {
    baseURL: process.env.PDF_RELEASE_BASE_URL,
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
  // The coordinating reviewer owns the frozen build and server.
});
