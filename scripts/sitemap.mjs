import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

export function timestamp(value) {
  // Editorial dates have day precision; UTC midnight is a stable encoding,
  // not a claim about the time of the edit.
  const result = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00Z`
    : value;
  if (
    typeof result !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(`${result.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== result.slice(0, 10)
  ) throw new Error(`Invalid sitemap lastmod: ${value}`);
  return result;
}

export function resolveLastModified(route, guides, root) {
  const guide = guides.find((item) => item.path === route.path);
  if (route.routeType === "guide" && !guide) {
    throw new Error(`Missing guide content for ${route.path}`);
  }
  const updated = guide ? guide.dateModified : route.lastModified;
  if (updated !== undefined) return timestamp(updated);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (!route.sourceFile) throw new Error(`Missing content source for ${route.path}`);
  if (git("rev-parse", "--is-shallow-repository") === "true") {
    throw new Error("Sitemap lastmod requires full Git history. Fetch with --unshallow or use fetch-depth: 0.");
  }
  const committed = git("log", "-1", "--format=%cI", "--", route.sourceFile);
  if (!committed) {
    throw new Error(`No Git history for ${route.sourceFile}; commit the content or provide an explicit updated date.`);
  }
  return timestamp(committed);
}

export async function validateSitemap({ dist, routes, origin }) {
  const xml = await readFile(path.join(dist, "sitemap.xml"), "utf8");
  const entries = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>\s*)?((?:<image:image>\s*<image:loc>[^<]+<\/image:loc>\s*<\/image:image>\s*)*)<\/url>/g)];
  if (entries.length !== routes.length || (xml.match(/<url>/g) ?? []).length !== entries.length) {
    throw new Error("Sitemap URL count or structure does not match the public routes.");
  }
  const seen = new Set();
  for (const [, location, lastmod, imageMarkup] of entries) {
    timestamp(lastmod);
    const url = new URL(location);
    const route = routes.find((item) => new URL(item.path, origin).href === location);
    if (!route || url.origin !== origin || url.protocol !== "https:" || url.hostname.startsWith("www.") || seen.has(location)) {
      throw new Error(`Non-canonical or duplicate sitemap URL: ${location}`);
    }
    seen.add(location);
    const imageLocations = [...imageMarkup.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((match) => match[1]);
    const expectedImages = (route.images ?? []).map((src) => new URL(src, origin).href);
    if (JSON.stringify(imageLocations) !== JSON.stringify(expectedImages)) throw new Error(`Sitemap figures differ from guide: ${location}`);
    for (const imageLocation of imageLocations) {
      const imageUrl = new URL(imageLocation);
      if (imageUrl.origin !== origin || !/^\/guides\/[a-z0-9-]+\/[a-z0-9-]+\.(webp|png)$/.test(imageUrl.pathname) || imageUrl.search || imageUrl.hash) {
        throw new Error(`Non-canonical sitemap image: ${imageLocation}`);
      }
      await readFile(path.join(dist, imageUrl.pathname.slice(1)));
    }
    // Cloudflare serves extensionless paths from matching .html files.
    // Resolve from the URL, not a potentially incorrect manifest outputFile.
    const outputFile = url.pathname === "/" ? "index.html" : `${url.pathname.slice(1)}.html`;
    if (outputFile !== route.outputFile) throw new Error(`Sitemap URL has no matching static route: ${location}`);
    const html = await readFile(path.join(dist, outputFile), "utf8");
    const canonicals = [...html.matchAll(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi)];
    if (canonicals.length !== 1 || !canonicals[0][0].includes(`href="${location}"`) ||
        !html.includes(`data-route-path="${route.path}"`) || html.includes('name="robots" content="noindex')) {
      throw new Error(`Sitemap URL is missing its indexable canonical document: ${location}`);
    }
    const visible = html.match(/<time\b[^>]*data-article-date="dateModified"[^>]*dateTime="([^"]+)"/i)?.[1];
    if (visible && Date.parse(timestamp(visible)) !== Date.parse(lastmod)) {
      throw new Error(`Guide Updated date differs from sitemap lastmod: ${location}`);
    }
  }
}
