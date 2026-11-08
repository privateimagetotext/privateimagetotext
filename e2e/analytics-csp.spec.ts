import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Real-browser check of the production CSP in public/_headers against the
// Cloudflare Web Analytics beacon. Cloudflare's automatic edge injection now
// uses versioned paths such as /beacon.min.js/v<id>; a CSP source without a
// trailing slash matches only its exact path, so a policy listing only
// /beacon.min.js silently blocks analytics on every page.
//
// Everything is served by route fulfilment: no request reaches the network.

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const BEACON = "https://static.cloudflareinsights.com/beacon.min.js";
const TEST_ORIGIN = "https://csp-check.privateimagetotext.test";

async function productionCsp(): Promise<string> {
  const headers = await readFile(
    path.resolve(currentDirectory, "../public/_headers"),
    "utf8",
  );
  const [defaults] = headers.split(/\r?\n\r?\n/);
  const csp = defaults.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1];
  if (!csp) throw new Error("No default Content-Security-Policy in _headers");
  return csp;
}

const candidates = {
  versionedBeacon: `${BEACON}/vce701823e78c4301a35b7e07294d87301792088814092`,
  exactBeacon: BEACON,
  otherPathSameHost: "https://static.cloudflareinsights.com/other.js",
  lookalikePath: `${BEACON}.evil`,
  otherHost: "https://cloudflareinsights.com/beacon.min.js/v1",
} as const;

test("production CSP allows the injected beacon, including versioned paths, and nothing else", async ({
  page,
}) => {
  const csp = await productionCsp();
  const reachedNetworkLayer: string[] = [];

  await page.route(`${TEST_ORIGIN}/**`, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": csp,
      },
      body: `<!doctype html><html><head><title>CSP check</title>${Object.values(
        candidates,
      )
        .map((src) => `<script src="${src}"></script>`)
        .join("")}</head><body></body></html>`,
    }),
  );
  for (const pattern of [
    "https://static.cloudflareinsights.com/**",
    "https://cloudflareinsights.com/**",
  ]) {
    await page.route(pattern, (route) => {
      reachedNetworkLayer.push(route.request().url());
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/javascript" },
        body: "(window.__loadedScripts = window.__loadedScripts || []).push(document.currentScript.src);",
      });
    });
  }

  await page.goto(`${TEST_ORIGIN}/`, { waitUntil: "load" });
  const loaded = await page.evaluate(
    () => (window as unknown as { __loadedScripts?: string[] }).__loadedScripts ?? [],
  );

  expect(loaded).toContain(candidates.versionedBeacon);
  expect(loaded).toContain(candidates.exactBeacon);
  expect(loaded).not.toContain(candidates.otherPathSameHost);
  expect(loaded).not.toContain(candidates.lookalikePath);
  expect(loaded).not.toContain(candidates.otherHost);
  // Blocked sources must be stopped by CSP before any request is made.
  expect(reachedNetworkLayer.sort()).toEqual(
    [candidates.exactBeacon, candidates.versionedBeacon].sort(),
  );
});
