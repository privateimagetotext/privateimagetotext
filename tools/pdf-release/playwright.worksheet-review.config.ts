import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.local-validation.config";

export default defineConfig({
  ...base,
  testMatch: /worksheet-review\.spec\.ts/,
  use: { ...base.use, serviceWorkers: "block" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
