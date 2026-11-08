import { defineConfig } from "@playwright/test";
import base from "./playwright.local-validation.config";

export default defineConfig({
  ...base,
  testMatch: /native-page-failure\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  use: { ...base.use, serviceWorkers: "block", actionTimeout: 20_000, navigationTimeout: 30_000 },
});
