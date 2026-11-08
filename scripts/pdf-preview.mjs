/* global process */
import { spawn } from "node:child_process";

const previewEnvironmentVariable = "VITE_ENABLE_PDF_OCR_PREVIEW";
const action = process.argv[2];

function environmentWithPreview(enabled, publicRelease = false) {
  const environment = { ...process.env };
  environment.VITE_ENABLE_PDF_OCR_PUBLIC = publicRelease ? "true" : "false";
  if (enabled) environment[previewEnvironmentVariable] = "true";
  else delete environment[previewEnvironmentVariable];
  return environment;
}

function run(command, args, environment, shell = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      shell,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${command} exited ${signal ? `after ${signal}` : `with code ${code ?? "unknown"}`}.`,
          ),
        );
      }
    });
  });
}

function runPnpm(args, environment) {
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli && !/\.(?:cmd|bat)$/i.test(pnpmCli)) {
    return run(process.execPath, [pnpmCli, ...args], environment);
  }
  const executable = pnpmCli ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
  return run(executable, args, environment, process.platform === "win32");
}

function runNodeTest(testFile, environment) {
  return run(process.execPath, ["--test", testFile], environment);
}

async function buildPreview() {
  await runPnpm(["run", "build"], environmentWithPreview(true));
}

switch (action) {
  case "build":
    await buildPreview();
    break;
  case "preview":
    await buildPreview();
    await runPnpm(["run", "preview"], environmentWithPreview(true));
    break;
  case "build-public":
    await runPnpm(["run", "build"], environmentWithPreview(false, true));
    break;
  case "preview-public":
    await runPnpm(["run", "build"], environmentWithPreview(false, true));
    await runPnpm(["run", "preview"], environmentWithPreview(false, true));
    break;
  case "test-release-isolation":
    await runPnpm(["run", "build"], environmentWithPreview(false, true));
    await runNodeTest("tests/pdf-public-release.test.mjs", environmentWithPreview(false, true));
    await runNodeTest("tests/rendered-html.test.mjs", environmentWithPreview(false, true));
    // Falls through to both disabled and private modes. End with a safe preview.
  case "test-isolation":
    await runPnpm(["run", "build"], environmentWithPreview(false));
    await runNodeTest(
      "tests/pdf-preview-standard-isolation.test.mjs",
      environmentWithPreview(false),
    );
    await buildPreview();
    await runNodeTest(
      "tests/pdf-preview-enabled-isolation.test.mjs",
      environmentWithPreview(true),
    );
    break;
  case "test-disabled":
    await runPnpm(["run", "build"], environmentWithPreview(false));
    await runNodeTest("tests/pdf-phase0-isolation.test.mjs", environmentWithPreview(false));
    await runNodeTest("tests/pdf-preview-standard-isolation.test.mjs", environmentWithPreview(false));
    break;
  default:
    throw new Error(
      "Usage: node scripts/pdf-preview.mjs <build|preview|build-public|preview-public|test-isolation|test-release-isolation|test-disabled>",
    );
}
