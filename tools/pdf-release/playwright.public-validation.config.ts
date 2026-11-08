import { defineConfig } from "@playwright/test";
import base from "./playwright.local-validation.config";

/** Public smoke checks against a separately frozen, root-coordinated build. */
export default defineConfig({
  ...base,
  testDir: "../../e2e",
  testMatch: /pdf-public-release\.spec\.ts/,
  projects: base.projects?.filter((project) => project.name === "chromium"),
});
