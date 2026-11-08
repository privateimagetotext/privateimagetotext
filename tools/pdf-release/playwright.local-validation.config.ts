import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { existsSync } from "node:fs";

const requested=process.env.PDF_VALIDATION_RESULTS_DIRECTORY;
const baseURL=process.env.PDF_VALIDATION_BASE_URL;
if (!requested || !baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseURL)) throw new Error("Set a loopback PDF_VALIDATION_BASE_URL and new results directory.");
const outputDir=path.resolve(requested);
const temporaryRoot=path.resolve(import.meta.dirname,"../../tmp");
const relative=path.relative(temporaryRoot,outputDir);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)
    || (existsSync(outputDir) && process.env.PDF_VALIDATION_ACTIVE_OUTPUT !== outputDir)) throw new Error("Choose a new results directory below repo tmp; existing evidence is preserved.");
// Playwright creates outputDir before worker processes re-import this config.
// This child-process marker is set only after the coordinator's no-reuse check.
process.env.PDF_VALIDATION_ACTIVE_OUTPUT = outputDir;
export default defineConfig({
 testDir:".", testMatch:/(?:lifecycle|offline)\.spec\.ts/,
 workers:1, fullyParallel:false, retries:0, timeout:180_000,
 expect:{timeout:30_000}, outputDir,
 reporter:[["list"],["json",{outputFile:path.join(outputDir,"playwright-results.json")}]],
 use:{baseURL,bypassCSP:false,serviceWorkers:"allow",acceptDownloads:true,trace:"retain-on-failure",screenshot:"only-on-failure",video:"off"},
 projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}},{name:"firefox",use:{...devices["Desktop Firefox"]}},{name:"webkit",use:{...devices["Desktop Safari"]}}],
 // Root coordinates frozen builds and per-suite server origins separately.
});
