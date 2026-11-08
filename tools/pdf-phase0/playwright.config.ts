import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4180";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 360_000,
  expect: { timeout: 30_000 },
  outputDir: "../../tmp/pdf-phase0/test-results",
  reporter: [["list"]],
  use: {
    baseURL,
    bypassCSP: false,
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      testMatch: /(core|decoder|pdf-cache|phase1b)\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testMatch: /(core|decoder|pdf-cache|phase1b)\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chromium-emulation",
      testMatch: /(core|phase1b)\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "pnpm run serve:pdf-phase0",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
