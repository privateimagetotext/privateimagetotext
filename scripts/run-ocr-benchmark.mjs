import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkVariant = process.env.OCR_BENCHMARK_VARIANT ?? "current";
const playwrightCli = path.join(
  repositoryRoot,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [
      playwrightCli,
      "test",
      "e2e/ocr-accuracy.spec.ts",
      "--project=ocr-benchmark",
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        OCR_BENCHMARK: "1",
        OCR_BENCHMARK_VARIANT: benchmarkVariant,
      },
      stdio: "inherit",
    },
  );
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});

if (exitCode === 0) {
  const sourceDirectory = path.join(
    repositoryRoot,
    "tmp",
    "ocr-benchmark-reports",
    benchmarkVariant,
  );
  const reportPrefix = benchmarkVariant === "current" ? "final" : benchmarkVariant;
  const deskewPrefix =
    benchmarkVariant === "current" ? "deskew-on" : `${benchmarkVariant}-deskew`;
  const layoutPrefix =
    benchmarkVariant === "current" ? "layout-current" : `${benchmarkVariant}-layout`;
  const reportDirectory = path.join(
    repositoryRoot,
    "tmp",
    "ocr-benchmark-reports",
  );
  await mkdir(reportDirectory, { recursive: true });
  const reportCopies = [
    copyFile(
      path.join(sourceDirectory, "report.json"),
      path.join(reportDirectory, `${reportPrefix}.json`),
    ),
    copyFile(
      path.join(sourceDirectory, "report.md"),
      path.join(reportDirectory, `${reportPrefix}.md`),
    ),
    copyFile(
      path.join(sourceDirectory, "deskew-matrix.json"),
      path.join(reportDirectory, `${deskewPrefix}.json`),
    ),
    copyFile(
      path.join(sourceDirectory, "deskew-matrix.md"),
      path.join(reportDirectory, `${deskewPrefix}.md`),
    ),
  ];
  if (benchmarkVariant !== "baseline-head") {
    reportCopies.push(
      copyFile(
        path.join(sourceDirectory, "layout-matrix.json"),
        path.join(reportDirectory, `${layoutPrefix}.json`),
      ),
      copyFile(
        path.join(sourceDirectory, "layout-matrix.md"),
        path.join(reportDirectory, `${layoutPrefix}.md`),
      ),
    );
  }
  await Promise.all(reportCopies);
}

process.exitCode = exitCode;
