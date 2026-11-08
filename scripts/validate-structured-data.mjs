import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const vocabulary = JSON.parse(await readFile(new URL("./schema-vocabulary.json", import.meta.url), "utf8"));
const terms = new Map(vocabulary["@graph"].map((node) => [node["@id"].replace("schema:", ""), node]));
const values = (value) => [value ?? []].flat();
const refs = (value) => values(value).map((ref) => ref["@id"].replace("schema:", ""));
function isA(type, parent, seen = new Set()) {
  if (type === parent) return true;
  if (seen.has(type)) return false;
  seen.add(type);
  return refs(terms.get(type)?.["rdfs:subClassOf"]).some((base) => isA(base, parent, seen));
}
function absoluteUrl(value) {
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}

// This is a deliberately scoped Schema.org validator, not Google's eligibility test.
// It checks vocabulary, inherited domains, value ranges and resolvable graph IDs.
export function validateGraph(data) {
  assert.equal(data["@context"], "https://schema.org");
  assert.ok(Array.isArray(data["@graph"]) && data["@graph"].length > 0, "Missing @graph");
  const entities = new Map();
  for (const node of data["@graph"]) {
    assert.ok(absoluteUrl(node["@id"]), "Graph entities need absolute IDs");
    assert.ok(!entities.has(node["@id"]), "Duplicate graph ID");
    entities.set(node["@id"], node);
  }
  function visit(node) {
    if (Object.keys(node).length === 1 && node["@id"]) {
      assert.ok(entities.has(node["@id"]), `Unresolved reference ${node["@id"]}`);
      return;
    }
    const types = values(node["@type"]);
    assert.ok(types.length, "Missing @type");
    for (const type of types) assert.ok(values(terms.get(type)?.["@type"]).includes("rdfs:Class"), `Unknown class ${type}`);
    for (const [property, value] of Object.entries(node)) {
      if (property === "@type") continue;
      if (property === "@id") { assert.ok(absoluteUrl(value), "Invalid @id"); continue; }
      const definition = terms.get(property);
      assert.ok(values(definition?.["@type"]).includes("rdf:Property"), `Unknown property ${property}`);
      assert.ok(types.some((type) => refs(definition["schema:domainIncludes"]).some((domain) => isA(type, domain))),
        `${property} is not applicable to ${types.join(", ")}`);
      const ranges = refs(definition["schema:rangeIncludes"]);
      assert.ok(values(value).length > 0, `Empty ${property}`);
      for (const entry of values(value)) {
        const object = entry && typeof entry === "object";
        const target = object && entry["@id"] ? entities.get(entry["@id"]) ?? entry : entry;
        const valid = ranges.some((range) => {
          if (object) return values(target["@type"]).some((type) => isA(type, range));
          if (range === "Text") return typeof entry === "string" && entry.trim().length > 0;
          if (range === "URL") return typeof entry === "string" && absoluteUrl(entry);
          // Schema.org's context permits URI references to Things (e.g. a
          // Breadcrumb ListItem.item URL) without an embedded typed object.
          if (isA(range, "Thing") && typeof entry === "string") return absoluteUrl(entry);
          if (range === "Number") return typeof entry === "number" && Number.isFinite(entry);
          if (range === "Integer") return Number.isInteger(entry);
          if (range === "Date" || range === "DateTime") return typeof entry === "string" &&
            /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(entry) && Number.isFinite(Date.parse(entry)) &&
            new Date(`${entry.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === entry.slice(0, 10);
          return false;
        });
        assert.ok(valid, `Invalid range for ${property}: ${JSON.stringify(entry)}`);
        if (object) visit(entry);
      }
    }
  }
  data["@graph"].forEach(visit);
  return data["@graph"].flatMap((node) => values(node["@type"]));
}

export function validateStructuredHtml(html) {
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')];
    assert.equal(blocks.length, 1, "Expected exactly one JSON-LD graph per document");
    assert.ok(!blocks[0].hasAttribute("src"), "JSON-LD must be inline");
    assert.equal(document.querySelectorAll("[itemscope], [itemtype]").length, 0, "Duplicate legacy microdata");
    // JSON.parse is deliberately run on the actual HTML data block, not source objects.
    const graph = JSON.parse(blocks[0].textContent);
    const types = validateGraph(graph);
    for (const type of ["WebSite", "Organization"]) {
      assert.equal(types.filter((candidate) => candidate === type).length, 1, `Expected one ${type}`);
    }
    return { graph, types };
  } finally { dom.window.close(); }
}

export async function validateBuiltSite(dist = resolve("dist")) {
  const results = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name.endsWith(".html")) {
        const html = await readFile(file, "utf8");
        const { types } = validateStructuredHtml(html);
        const route = html.match(/data-route-path="([^"]+)"/)?.[1] ?? file;
        results.push(`PASS ${route}: ${types.join(", ")}`);
      }
    }
  }
  await walk(dist);
  assert.ok(results.length > 0, "No rendered documents found");
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const results = await validateBuiltSite();
  console.log(results.join("\n"));
  console.log(`Validated ${results.length} rendered documents; 0 errors (offline Schema.org vocabulary, domains and ranges).`);
}
