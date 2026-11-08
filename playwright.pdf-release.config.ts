import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const baseURL = "http://127.0.0.1:4173";
const nodeCommand = JSON.stringify(process.execPath);
const executablePath = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /pdf-public-release\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  outputDir: "tmp/pdf-public-release/test-results",
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${nodeCommand} scripts/pdf-preview.mjs preview-public`,
    env: { ...process.env, PATH: executablePath },
    url: baseURL,
    // The suite must fail if another build is listening on this port.
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
