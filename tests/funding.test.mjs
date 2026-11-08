import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";

// Rendered-HTML checks for the funding boundary:
// support links only outside tool workspaces, affiliate links only inside
// guide content, nothing at all from an empty configuration, and no CSP change.

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const TOOL_PATHS = ["/", "/hide-message", "/media-inspector", "/pdf-to-text", "/steganography-analysis"];
const FUNDING_HOSTS = /ko-fi\.com|github\.com\/sponsors|buymeacoffee\.com|proton\.me|getproton\.me/i;

// The reviewed production CSP. Funding links are plain navigations, so they
// need no CSP change. Any edit to this policy needs a reviewed privacy change.
const EXPECTED_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com/beacon.min.js https://static.cloudflareinsights.com/beacon.min.js/; style-src 'self'; font-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'";

async function routes() {
  return JSON.parse(await readFile(resolve(dist, "document-manifest.json"), "utf8"));
}

async function documentFor(route) {
  const html = await readFile(resolve(dist, route.outputFile), "utf8");
  return { html, dom: new JSDOM(html) };
}

test("tool workspaces contain no funding markup, links or hosts", async () => {
  const tools = (await routes()).filter((route) => TOOL_PATHS.includes(route.path));
  assert.ok(tools.length >= 3);
  for (const route of tools) {
    const { dom } = await documentFor(route);
    const main = dom.window.document.querySelector("main");
    assert.ok(main, route.path);
    assert.equal(main.querySelector("[data-funding-link], [data-funding-block], .paired-tools, .support-link, .monetisation-slot"), null, route.path);
    assert.equal(main.querySelector('a[rel~="sponsored"]'), null, route.path);
    for (const link of main.querySelectorAll("a[href]")) {
      assert.doesNotMatch(link.getAttribute("href"), FUNDING_HOSTS, `${route.path} workspace link`);
    }
    assert.doesNotMatch(main.textContent, /affiliate|paid link|support on (ko-fi|github|buy me)/i, route.path);
    dom.window.close();
  }
});

// The shipped configuration has one support link (Ko-fi) and no affiliates.
// These checks guard the built documents: the support link renders only in
// the footer of content, guide-index and guide routes, and in the main
// content of About and /funding; never on a tool route or the not-found page.
// Other configurations are rendered through the real App shell in
// tests/components/funding-placement.test.tsx.
const SUPPORT_URL = "https://ko-fi.com/privateimagetotext82499";
const SUPPORT_FOOTER_ROUTE_TYPES = ["content", "guide-index", "guide"];
const SUPPORT_MAIN_PATHS = ["/about", "/funding"];

test("the shipped support link renders only where the policy allows", async () => {
  for (const route of await routes()) {
    const { html, dom } = await documentFor(route);
    const document = dom.window.document;
    assert.equal(document.querySelector("[data-funding-block], [data-funding-link='affiliate'], .paired-tools"), null, route.path);
    assert.equal(document.querySelector('a[rel~="sponsored"]'), null, route.path);
    assert.doesNotMatch(html, /Privacy tools that pair well/, route.path);

    const footerSupport = document.querySelectorAll(".app-footer .support-link");
    const mainSupport = document.querySelectorAll("main .support-link");
    const mayShowFooter = SUPPORT_FOOTER_ROUTE_TYPES.includes(route.routeType);
    assert.equal(footerSupport.length, mayShowFooter ? 1 : 0, `${route.path} footer support link`);
    assert.equal(mainSupport.length, SUPPORT_MAIN_PATHS.includes(route.path) ? 1 : 0, `${route.path} main support link`);
    assert.equal(document.querySelectorAll(".support-link").length, footerSupport.length + mainSupport.length, route.path);

    for (const block of document.querySelectorAll(".support-link")) {
      const links = block.querySelectorAll("a");
      assert.equal(links.length, 1, route.path);
      assert.equal(links[0].getAttribute("href"), SUPPORT_URL, route.path);
      assert.equal(links[0].getAttribute("rel"), "noopener noreferrer", route.path);
      assert.equal(links[0].getAttribute("target"), "_blank", route.path);
      assert.match(links[0].textContent, /Support on Ko-fi/, route.path);
    }

    if (route.routeType === "tool" || route.routeType === "not-found") {
      for (const link of document.querySelectorAll("a[href]")) {
        assert.doesNotMatch(link.getAttribute("href"), FUNDING_HOSTS, `${route.path} link`);
      }
    }
    dom.window.close();
  }
});

test("affiliate blocks, when present, appear only inside guide content", async () => {
  for (const route of await routes()) {
    const { dom } = await documentFor(route);
    const document = dom.window.document;
    const blocks = [...document.querySelectorAll("[data-funding-block], [data-funding-link='affiliate'], a[rel~='sponsored']")];
    if (route.routeType !== "guide") assert.equal(blocks.length, 0, route.path);
    for (const block of blocks) {
      assert.ok(block.closest("main article"), `${route.path} affiliate outside guide content`);
      for (const link of block.matches("a") ? [block] : block.querySelectorAll("a[href^='https:']")) {
        assert.equal(link.getAttribute("rel"), "sponsored noopener noreferrer", route.path);
      }
    }
    dom.window.close();
  }
});

test("the funding page is published, linked from every footer and honest about its state", async () => {
  const all = await routes();
  const funding = all.find((route) => route.path === "/funding");
  assert.ok(funding, "/funding should be in the route manifest");
  assert.equal(funding.routeType, "content");
  // Matches the site-wide SEO limits added by the quality PR (#5).
  assert.ok(funding.title.length <= 60, `title is ${funding.title.length} characters`);
  assert.ok(funding.description.length <= 160, `description is ${funding.description.length} characters`);
  const sitemap = await readFile(resolve(dist, "sitemap.xml"), "utf8");
  assert.match(sitemap, /<loc>https:\/\/privateimagetotext\.com\/funding<\/loc>/);

  const { dom } = await documentFor(funding);
  const document = dom.window.document;
  const main = document.querySelector("main").textContent.replace(/\s+/g, " ");
  assert.equal(document.querySelector("h1").textContent, "How this site is funded");
  assert.match(main, /Running costs are small/);
  // The funding page states no cost figures; fail if a price creeps back in.
  assert.doesNotMatch(main, /(?:US|A|AU)?\$\s?\d|\d+\s?(?:USD|AUD)\b/);
  assert.match(main, /No advertising/);
  assert.match(main, /No sale, rental or sharing of visitor data/);
  assert.match(main, /partner can tell that you arrived through it/);
  assert.match(main, /The partner learns nothing from the tools/);
  assert.match(main, /A support link through Ko-fi is available\./);
  assert.match(main, /There are currently no affiliate links on this site\./);
  for (const href of ["/privacy", "/privacy/technical", "/verify"]) {
    assert.ok(document.querySelector(`main a[href="${href}"]`), `funding page links to ${href}`);
  }
  dom.window.close();

  for (const route of all) {
    const page = await documentFor(route);
    assert.ok(page.dom.window.document.querySelector('.app-footer a[href="/funding"]'), `${route.path} footer`);
    page.dom.window.close();
  }

  const about = await documentFor(all.find((route) => route.path === "/about"));
  assert.ok(about.dom.window.document.querySelector('main a[href="/funding"]'));
  about.dom.window.close();
});

test("the production CSP is unchanged and names no funding host", async () => {
  const headers = await readFile(resolve(root, "public", "_headers"), "utf8");
  const [defaults] = headers.split(/\r?\n\r?\n/);
  assert.equal(defaults.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1], EXPECTED_CSP);
  assert.match(defaults, /^\s*Referrer-Policy: no-referrer$/m);
  assert.doesNotMatch(headers, FUNDING_HOSTS);
});
