import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const geometryVariant = process.env.OCR_GEOMETRY_VARIANT ?? "current";
const reportDirectory = process.env.OCR_GEOMETRY_REPORT_DIR
  ? path.resolve(repositoryRoot, process.env.OCR_GEOMETRY_REPORT_DIR)
  : path.join(
      repositoryRoot,
      "tmp",
      "ocr-geometry-reports",
      geometryVariant,
    );
const playwrightCli = path.join(
  repositoryRoot,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);
const viteCli = path.join(repositoryRoot, "node_modules", "vite", "bin", "vite.js");
const geometryBaseUrl =
  process.env.OCR_BENCHMARK_BASE_URL ?? "http://127.0.0.1:4174";
const geometryServerCommand =
  process.env.OCR_BENCHMARK_SERVER_COMMAND ??
  `"${process.execPath}" "${viteCli}" --host 127.0.0.1 --port 4174 --strictPort --mode geometry-benchmark`;

await mkdir(reportDirectory, { recursive: true });

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [
      playwrightCli,
      "test",
      "e2e/ocr-geometry.spec.ts",
      "--project=ocr-geometry",
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        OCR_GEOMETRY: "1",
        OCR_GEOMETRY_VARIANT: geometryVariant,
        OCR_GEOMETRY_REPORT_DIR: reportDirectory,
        OCR_BENCHMARK_BASE_URL: geometryBaseUrl,
        OCR_BENCHMARK_SERVER_COMMAND: geometryServerCommand,
      },
      stdio: "inherit",
    },
  );
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});

process.exitCode = exitCode;
