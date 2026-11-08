import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "../..");
const directory = process.env.PDF_RELEASE_RESULTS_DIRECTORY
  ? path.resolve(root, process.env.PDF_RELEASE_RESULTS_DIRECTORY)
  : path.join(root, "tmp/pdf-release-corpus/test-results");
const records = [];
async function visit(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const filename = path.join(folder, entry.name);
    if (entry.isDirectory()) await visit(filename);
    else if (entry.name === "evidence.json") records.push({ evidencePath: path.relative(root, filename), ...JSON.parse(await readFile(filename, "utf8")) });
  }
}
await visit(directory);
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const headings = ["Corpus ID", "Source kind", "Browser", "Page/control", "Expected method", "Actual method", "Method preference met", "Token smoke", "Text usefulness", "Override needed", "Elapsed ms (whole selection)", "Warnings", "Render dimensions", "Downscaled warning", "Evidence"];
const rows = records.flatMap((record) => (record.pages.length ? record.pages : [{}]).map((page) => [
  record.scenario, record.sourceKind ?? "synthetic-control", `${record.browserProject} ${record.browserVersion}`,
  page.page ?? page.control ?? page.mode, page.expectedMethod, page.method,
  page.methodMatchesPreference, page.tokenChecks ? (page.tokenChecks.every((token) => token.present) ? "PASS - tokens only" : "FAIL") : "N/A",
  page.textUsefulness ?? "N/A - control", page.overrideNeeded, record.elapsedMs ?? record.cancellationElapsedMs,
  [...(page.warnings ?? []), ...(page.safeErrors ?? []), ...(page.safeError ? [page.safeError] : [])].join(" | "),
  page.renderDimensions, page.downscaledWarning, record.evidencePath,
]));
await writeFile(path.join(directory, "corpus-results.csv"), [headings, ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n");
await writeFile(path.join(directory, "corpus-results.json"), JSON.stringify({
  summarisedAt: new Date().toISOString(),
  caution: "Only recorded runs are included. A token pass is not a usefulness review; missing scenarios and manual/device release gates remain OPEN. Read Playwright's final exit status; an interrupted run may contain incomplete evidence.",
  runCount: records.length,
  recordedAssertionFailures: records.reduce((total, record) => total + record.assertionFailures, 0),
  records,
}, null, 2) + "\n");
process.stdout.write(`Summarised ${records.length} recorded runs and ${rows.length} page/control rows.\n`);
