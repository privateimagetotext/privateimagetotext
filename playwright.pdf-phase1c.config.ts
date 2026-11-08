import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const baseURL = "http://127.0.0.1:4173";
const nodeCommand = JSON.stringify(process.execPath);
const executablePath = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /pdf-(?:phase1c-preview|release-lifecycle)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 360_000,
  expect: { timeout: 60_000 },
  outputDir: "tmp/pdf-phase1c/test-results",
  reporter: [["list"]],
  use: {
    baseURL,
    bypassCSP: false,
    serviceWorkers: "allow",
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      grepInvert: /@phase1c-mobile/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      grep: /@phase1c-core/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      grep: /@phase1c-core/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chromium-emulation",
      grep: /@phase1c-mobile/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: `${nodeCommand} scripts/pdf-preview.mjs preview`,
    env: { ...process.env, PATH: executablePath },
    url: baseURL,
    reuseExistingServer: process.env.CI ? false : true,
    timeout: 180_000,
  },
});
