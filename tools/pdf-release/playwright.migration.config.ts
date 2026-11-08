import { defineConfig } from "@playwright/test";
import base from "./playwright.local-validation.config";

export default defineConfig(base, { testMatch: /migration\.spec\.ts/ });
