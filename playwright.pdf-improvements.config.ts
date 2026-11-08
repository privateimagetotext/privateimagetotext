import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PDF_TEST_BASE_URL ?? "http://127.0.0.1:4187";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /pdf-(?:improvements|release-lifecycle|public-release)\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  outputDir: "tmp/pdf-improvements/test-results",
  reporter: [["list"]],
  use: {
    baseURL,
    actionTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
    acceptDownloads: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PDF_TEST_EXTERNAL_SERVER === "1" ? undefined : {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4187 --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
