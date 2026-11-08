import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.local-validation.config";

export default defineConfig({
  ...base,
  testMatch: /full-source-review\.spec\.ts/,
  timeout: 240_000,
  use: { ...base.use, serviceWorkers: "block", actionTimeout: 20_000, navigationTimeout: 30_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
