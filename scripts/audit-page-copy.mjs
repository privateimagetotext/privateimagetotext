import { readFile, writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

// Count rendered editorial assertions, not metadata, JSON-LD, task headings,
// user filenames, links, or the mobile/desktop table-of-contents copies.
const assertion = /\b(?:does not|do not|never) upload\b|\b(?:is|are) not uploaded\b|\bno [^.!?]{0,60}upload\b|\bnothing uploaded\b|\bwithout (?:uploading|sending)\b|\bkeeps? [^.!?]{0,60} out of an upload service\b/i;
const normalize = (value) => value.replace(/\s+/g, " ").trim();
const routes = JSON.parse(await readFile("dist/document-manifest.json", "utf8"));
const audit = [];
for (const route of routes.filter((item) => ["/", "/hide-message", "/media-inspector"].includes(item.path) || item.routeType === "guide")) {
  const dom = new JSDOM(await readFile(`dist/${route.outputFile}`, "utf8"));
  const main = dom.window.document.querySelector("main");
  const headings = [...main.querySelectorAll("h1,h2")].map((element) => ({
    level: element.tagName, id: element.id, text: normalize(element.textContent),
  }));
  const privacyStatements = [];
  for (const element of main.querySelectorAll("h1,h2,h3,p,dd,li")) {
    if (element.closest("nav,[aria-live]") || element.querySelector("p,dd,li")) continue;
    const text = normalize(element.textContent);
    if (element.querySelector("a") && [...element.querySelectorAll("a")].map((link) => normalize(link.textContent)).join(" ") === text) continue;
    for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      if (/^H/.test(element.tagName) && !/\bnothing uploaded\b/i.test(sentence)) continue;
      if (assertion.test(sentence)) privacyStatements.push({ tag: element.tagName, text: sentence });
    }
  }
  audit.push({ path: route.path, title: route.title, description: route.description, headings, privacyCount: privacyStatements.length, privacyStatements });
  dom.window.close();
}
const outputIndex = process.argv.indexOf("--output");
if (outputIndex !== -1) await writeFile(process.argv[outputIndex + 1], `${JSON.stringify(audit, null, 2)}\n`);
for (const page of audit) console.log(`${page.path}: ${page.headings.length} H1/H2 headings; ${page.privacyCount} privacy statements`);
// B6 explicitly restores the homepage NO IMAGE UPLOAD badge alongside the
// preserved H1 and result reassurance. Report all three; do not hide the badge.
if (process.argv.includes("--check") && audit.some((page) => page.privacyCount > (page.path === "/" ? 3 : 2))) {
  throw new Error("A scoped page exceeds its no-upload assertion budget (homepage 3 after B6, other pages 2).");
}
