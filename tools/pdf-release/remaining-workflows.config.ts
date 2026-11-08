import { defineConfig } from "@playwright/test";
import base from "./playwright.local-validation.config";

export default defineConfig({
  ...base,
  testMatch: /remaining-workflows\.spec\.ts/,
  timeout: 360_000,
  use: { ...base.use, actionTimeout: 20_000, navigationTimeout: 30_000 },
});
