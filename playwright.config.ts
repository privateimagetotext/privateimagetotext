import { defineConfig, devices } from "@playwright/test";

const benchmarkRequested = process.env.OCR_BENCHMARK === "1";
const geometryBenchmarkRequested = process.env.OCR_GEOMETRY === "1";
const isolatedBenchmarkRequested =
  benchmarkRequested || geometryBenchmarkRequested;
const externalBenchmarkServer =
  process.env.OCR_BENCHMARK_EXTERNAL_SERVER === "1";
const baseURL =
  process.env.OCR_BENCHMARK_BASE_URL ?? "http://127.0.0.1:4173";
const webServerCommand =
  process.env.OCR_BENCHMARK_SERVER_COMMAND ?? "pnpm run preview";
// Optional override for environments with a preinstalled Chromium whose build
// differs from the one this Playwright version downloads (for example, cloud
// agent sessions). Unset in CI and local development, where nothing changes.
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const desktopChrome = {
  ...devices["Desktop Chrome"],
  ...(chromiumExecutablePath
    ? { launchOptions: { executablePath: chromiumExecutablePath } }
    : {}),
};

export default defineConfig({
  testDir: "./e2e",
  testIgnore: /pdf-(?:phase1c-preview|release-lifecycle|public-release|improvements)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    bypassCSP: false,
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      grepInvert: /@ocr-(?:benchmark|geometry)/,
      use: desktopChrome,
    },
    ...(benchmarkRequested
      ? [
          {
            name: "ocr-benchmark",
            testMatch: /ocr-accuracy\.spec\.ts/,
            grep: /@ocr-benchmark/,
            use: desktopChrome,
          },
        ]
      : []),
    ...(geometryBenchmarkRequested
      ? [
          {
            name: "ocr-geometry",
            testMatch: /ocr-geometry\.spec\.ts/,
            grep: /@ocr-geometry/,
            use: desktopChrome,
          },
        ]
      : []),
    {
      name: "firefox",
      testMatch: /steganography-smoke\.spec\.ts/,
      use: {
        ...devices["Desktop Firefox"],
      },
    },
    {
      name: "webkit",
      testMatch: /steganography-smoke\.spec\.ts/,
      use: {
        ...devices["Desktop Safari"],
      },
    },
  ],
  webServer: externalBenchmarkServer
    ? undefined
    : {
        command: webServerCommand,
        url: baseURL,
        reuseExistingServer: process.env.CI ? false : !isolatedBenchmarkRequested,
        timeout: 60_000,
      },
});
