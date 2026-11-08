// Explicit maintenance command only. Builds and tests never fetch Schema.org.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const source = "https://schema.org/version/latest/schemaorg-current-https.jsonld";
const raw = process.argv[2] ? await readFile(process.argv[2], "utf8") : await fetch(source).then((response) => {
  if (!response.ok) throw new Error(`Schema.org download failed: ${response.status}`);
  return response.text();
});
const vocabulary = JSON.parse(raw);
const nodes = new Map(vocabulary["@graph"].map((node) => [node["@id"], node]));
const properties = "name url inLanguage publisher logo contactPoint email description author datePublished dateModified step text position itemListElement item applicationCategory operatingSystem browserRequirements offers price priceCurrency featureList mainEntity acceptedAnswer founder".split(" ");
const types = "WebSite Organization ContactPoint SoftwareApplication WebApplication Offer HowTo HowToSection HowToStep Article BreadcrumbList ListItem FAQPage Question Answer Person".split(" ");
const selected = new Map();
function include(id) {
  if (selected.has(id)) return;
  const node = nodes.get(id);
  if (!node) throw new Error(`Unknown Schema.org term: ${id}`);
  const fields = ["@id", "@type", "rdfs:subClassOf", "schema:domainIncludes", "schema:rangeIncludes"];
  const subset = Object.fromEntries(fields.filter((key) => node[key]).map((key) => [key, node[key]]));
  selected.set(id, subset);
  for (const key of fields.slice(2)) {
    for (const ref of [node[key] ?? []].flat()) {
      if (ref["@id"].startsWith("schema:")) include(ref["@id"]);
    }
  }
}
for (const term of [...types, ...properties]) include(`schema:${term}`);
await writeFile(new URL("./schema-vocabulary.json", import.meta.url), `${JSON.stringify({
  source, retrievedOn: new Date().toISOString().slice(0, 10),
  sourceSha256: createHash("sha256").update(raw).digest("hex"),
  license: "https://schema.org/docs/terms.html",
  "@context": vocabulary["@context"], "@graph": [...selected.values()],
}, null, 2)}\n`);
console.log(`Saved ${selected.size} Schema.org terms for offline validation.`);
