import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { JSDOM } from "jsdom";
import { validateBuiltSite, validateGraph, validateStructuredHtml } from "../scripts/validate-structured-data.mjs";

test("all rendered pages have valid inline JSON and Schema.org vocabulary", async () => {
  await validateBuiltSite();
});

// SoftwareApplication names are the product's tool names, not the
// search-oriented page titles. The homepage tool carries the product name.
const applicationNames = {
  "/": "Private Image to Text",
  "/pdf-to-text": "PDF to text",
  "/hide-message": "Hide a message",
  "/media-inspector": "Media Inspector",
  "/steganography-analysis": "Steganography analysis",
};

test("rendered schema matches visible content, route metadata and sitemap dates", async () => {
  const routes = JSON.parse(await readFile("dist/document-manifest.json", "utf8"));
  for (const route of routes) {
    const html = await readFile(`dist/${route.outputFile}`, "utf8");
    const { graph: data } = validateStructuredHtml(html);
    const graph = data["@graph"];
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const visible = document.querySelector("main").textContent.replace(/\s+/g, " ");
    const normalize = (text) => text.replace(/\s+/g, " ");
    try {
      assert.ok(!JSON.stringify(data).includes('"aggregateRating"'));
      assert.ok(!JSON.stringify(data).includes('"review"'));
      assert.ok(!JSON.stringify(data).includes('"supportedFormats"'));
      const app = graph.find((node) => [node["@type"]].flat().includes("SoftwareApplication"));
      if (["/", "/hide-message", "/media-inspector", "/steganography-analysis", "/pdf-to-text"].includes(route.path)) {
        assert.ok(app, route.path);
        assert.equal(app.name, applicationNames[route.path] ?? route.title, route.path);
        assert.equal(app.description, route.description);
        assert.deepEqual(app.offers, { "@type": "Offer", price: 0, priceCurrency: "AUD" });
        if (route.path === "/") {
          const rows = [...document.querySelectorAll(".ocr-tool-facts__list > div")];
          assert.equal(rows.length, 8);
          assert.deepEqual(app.featureList, rows.map((row) => `${row.querySelector("dt").textContent}: ${row.querySelector("dd > span").textContent}`));
          assert.equal(document.querySelector(".workspace-section").nextElementSibling.querySelector("h2").textContent, "What this tool does");
          assert.doesNotMatch(document.querySelector(".dropzone").textContent, /does not upload your image or recognised text/i);
          assert.match(document.querySelector(".product-intro").textContent, /Nothing uploaded/);
          assert.match(document.querySelector(".result-panel").textContent, /This site does not upload your image or recognised text/);
        } else for (const feature of app.featureList) {
          assert.ok(visible.includes(normalize(feature)), `Invisible feature: ${feature}`);
        }
      } else assert.equal(app, undefined);
      const guide = graph.find((node) => ["HowTo", "Article"].includes(node["@type"]));
      if (route.routeType === "guide") {
        assert.ok(guide, route.path);
        assert.equal(guide.name, document.querySelector("h1").textContent);
        assert.equal(guide.dateModified, route.lastModified);
        const published = document.querySelector('[data-article-date="datePublished"]')?.getAttribute("datetime");
        assert.equal(guide.datePublished, published);
        if (guide["@type"] === "HowTo") {
          const steps = guide.step.flatMap((item) => item["@type"] === "HowToSection" ? item.itemListElement : [item]);
          const visibleSteps = [...document.querySelectorAll("li[id*='-step-']")];
          assert.deepEqual(steps.map((item) => item.text), visibleSteps.map((item) => item.textContent));
          for (const step of steps) assert.equal(document.getElementById(new URL(step.url).hash.slice(1))?.textContent, step.text);
        }
      } else assert.equal(guide, undefined);
      const breadcrumbs = graph.filter((node) => node["@type"] === "BreadcrumbList");
      const expected = route.routeType === "guide" || route.path.endsWith("/technical");
      assert.equal(breadcrumbs.length, expected ? 1 : 0);
      if (expected) {
        const visibleCrumbs = [...document.querySelectorAll('nav[aria-label="Breadcrumb"] li')];
        assert.deepEqual(breadcrumbs[0].itemListElement.map((item) => item.name), visibleCrumbs.map((item) => item.textContent));
      }
      const faq = graph.find((node) => node["@type"] === "FAQPage");
      if (route.path === "/") {
        assert.ok(faq);
        const details = [...document.querySelectorAll(".homepage-faq details")];
        assert.equal(details.length, 8);
        assert.deepEqual(faq.mainEntity.map((item) => item.name), details.map((item) => item.querySelector("summary").textContent));
        assert.deepEqual(faq.mainEntity.map((item) => item.acceptedAnswer.text), details.map((item) => item.querySelector("p").textContent));
        assert.equal(document.querySelector('[aria-labelledby="limitations-title"]').nextElementSibling.className, "homepage-faq");
        for (const link of document.querySelectorAll(".homepage-faq a")) {
          const url = new URL(link.getAttribute("href"), "https://privateimagetotext.com");
          const target = routes.find((item) => item.path === url.pathname);
          assert.ok(target, `Missing FAQ route ${url.pathname}`);
          if (url.hash) {
            const targetDom = new JSDOM(await readFile(`dist/${target.outputFile}`, "utf8"));
            assert.ok(targetDom.window.document.getElementById(url.hash.slice(1)), `Missing FAQ anchor ${url.hash}`);
            targetDom.window.close();
          }
        }
      } else assert.equal(faq, undefined);
      if (route.path === "/about") {
        const person = graph.find((node) => node["@type"] === "Person");
        assert.equal(person.name, "Simon");
        assert.deepEqual(Object.keys(person).sort(), ["@id", "@type", "name"]);
        assert.equal(graph.find((node) => node["@type"] === "Organization").founder["@id"], person["@id"]);
        assert.match(visible, /source is not public yet/);
        assert.match(visible, /master's degree/);
        assert.match(visible, /CISM/);
        assert.equal(route.lastModified, "2026-11-07T00:00:00Z");
        assert.ok(document.querySelector('.app-footer a[href="/about"]'));
      }
    } finally { dom.window.close(); }
  }
});

test("validation rejects malformed JSON, unknown properties, bad domains, ranges and duplicate graphs", async () => {
  const html = await readFile("dist/index.html", "utf8");
  const { graph: data } = validateStructuredHtml(html);
  assert.throws(() => validateStructuredHtml(html.replace('{"@context"', '{INVALID"@context"')), SyntaxError);
  assert.throws(() => validateStructuredHtml(`${html}<script type="application/ld+json">{}</script>`), /exactly one/);
  const mutate = (change) => { const copy = JSON.parse(JSON.stringify(data)); change(copy["@graph"]); return copy; };
  assert.throws(() => validateGraph(mutate((graph) => { graph[0].supportedFormats = "PNG"; })), /Unknown property/);
  assert.throws(() => validateGraph(mutate((graph) => { graph[0].browserRequirements = "Browser"; })), /not applicable/);
  assert.throws(() => validateGraph(mutate((graph) => { graph[0].name = 123; })), /Invalid range/);
  assert.throws(() => validateGraph(mutate((graph) => { graph.push(graph[0]); })), /Duplicate graph ID/);
  assert.throws(() => validateGraph(mutate((graph) => { graph[0].publisher = { "@id": "https://example.com/missing" }; })), /Invalid range|Unresolved/);
});

test("Article fallback shape passes the same offline schema validation", async () => {
  const html = await readFile("dist/guides/screenshot-to-text.html", "utf8");
  const { graph } = validateStructuredHtml(html);
  const guide = graph["@graph"].find((node) => node["@type"] === "HowTo");
  guide["@type"] = "Article";
  delete guide.step;
  assert.ok(validateGraph(graph).includes("Article"));
});
