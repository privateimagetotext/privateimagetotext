import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { resolveLastModified, timestamp, validateSitemap } from "../scripts/sitemap.mjs";

test("explicit guide dates take precedence and require no Git checkout", () => {
  const route = { path: "/guides/example", routeType: "guide", lastModified: "2020-01-01" };
  assert.equal(resolveLastModified(route, [{ path: route.path, dateModified: "2026-08-08" }], "/missing"), "2026-08-08T00:00:00Z");
  for (const value of [undefined, "", "2026-02-30", "2026-08-08T12:00:00"]) {
    assert.throws(() => timestamp(value), /Invalid sitemap lastmod/);
  }
});

test("Git fallback follows source commits, not builds or unrelated commits", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "localocr-sitemap-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let commitDate = "2026-08-08T12:30:00+08:00";
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: {
    ...process.env, GIT_AUTHOR_NAME: "Sitemap test", GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Sitemap test", GIT_COMMITTER_EMAIL: "test@example.invalid",
    GIT_AUTHOR_DATE: "2026-08-08T12:30:00+08:00", GIT_COMMITTER_DATE: commitDate,
  } }).trim();
  git("init");
  await writeFile(path.join(root, "page.tsx"), "first");
  git("add", "page.tsx"); git("commit", "-m", "page");
  const route = { path: "/", sourceFile: "page.tsx" };
  assert.equal(resolveLastModified(route, [], root), "2026-08-08T12:30:00+08:00");
  commitDate = "2026-09-01T00:00:00Z";
  await writeFile(path.join(root, "other.txt"), "unrelated");
  git("add", "other.txt"); git("commit", "-m", "unrelated", "--date=2026-09-01T00:00:00Z");
  assert.equal(resolveLastModified(route, [], root), "2026-08-08T12:30:00+08:00");
  await writeFile(path.join(root, "page.tsx"), "edited");
  git("add", "page.tsx");
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "edit"], {
    cwd: root, env: { ...process.env, GIT_COMMITTER_DATE: "2026-09-02T01:00:00Z" },
  });
  assert.equal(Date.parse(resolveLastModified(route, [], root)), Date.parse("2026-09-02T01:00:00Z"));
  assert.throws(() => resolveLastModified({ ...route, sourceFile: "missing.tsx" }, [], root), /No Git history/);
  await writeFile(path.join(root, ".git", "shallow"), `${git("rev-parse", "HEAD")}\n`);
  assert.throws(() => resolveLastModified(route, [], root), /full Git history/);
});

test("build validation rejects missing dates, missing pages and canonical drift", async (t) => {
  const dist = await mkdtemp(path.join(tmpdir(), "localocr-sitemap-output-"));
  t.after(() => rm(dist, { recursive: true, force: true }));
  const origin = "https://privateimagetotext.com";
  const routes = [{ path: "/guides/example", outputFile: "guides/example.html" }];
  const url = `${origin}/guides/example`;
  const xml = (location = url, date = "<lastmod>2026-08-08T00:00:00Z</lastmod>") => `<urlset><url><loc>${location}</loc>${date}</url></urlset>`;
  const html = `<link rel="canonical" href="${url}" /><div data-route-path="/guides/example"></div><time data-article-date="dateModified" dateTime="2026-08-08">Updated 8 August 2026</time>`;
  const validate = () => validateSitemap({ dist, routes, origin });
  await mkdir(path.join(dist, "guides"));
  await writeFile(path.join(dist, "sitemap.xml"), xml());
  await assert.rejects(validate, /ENOENT/);
  await writeFile(path.join(dist, routes[0].outputFile), html);
  await validate();
  await writeFile(path.join(dist, "sitemap.xml"), xml(url, ""));
  await assert.rejects(validate, /Invalid sitemap lastmod/);
  for (const location of [url.replace("https:", "http:"), url.replace("https://", "https://www.")]) {
    await writeFile(path.join(dist, "sitemap.xml"), xml(location));
    await assert.rejects(validate, /Non-canonical/);
  }
  await writeFile(path.join(dist, "sitemap.xml"), xml());
  await writeFile(path.join(dist, routes[0].outputFile), html.replace(`href="${url}"`, `href="${origin}/"`));
  await assert.rejects(validate, /canonical document/);
  await writeFile(path.join(dist, routes[0].outputFile), html.replace('dateTime="2026-08-08"', 'dateTime="2026-09-08"'));
  await assert.rejects(validate, /Updated date differs/);
});

test("sitemap figures must match the guide, resolve locally and use the canonical origin", async (t) => {
  const dist = await mkdtemp(path.join(tmpdir(), "localocr-sitemap-images-"));
  t.after(() => rm(dist, { recursive: true, force: true }));
  const origin = "https://privateimagetotext.com";
  const image = "/guides/example/result.webp";
  const route = { path: "/guides/example", outputFile: "guides/example.html", images: [image] };
  await mkdir(path.join(dist, "guides/example"), { recursive: true });
  await writeFile(path.join(dist, route.outputFile), `<link rel="canonical" href="${origin}${route.path}" /><div data-route-path="${route.path}"></div>`);
  const xml = (imageUrl) => `<urlset><url><loc>${origin}${route.path}</loc><lastmod>2026-09-16</lastmod>${imageUrl ? `<image:image><image:loc>${imageUrl}</image:loc></image:image>` : ""}</url></urlset>`;
  const validate = () => validateSitemap({ dist, routes: [route], origin });
  await writeFile(path.join(dist, "sitemap.xml"), xml(origin + image));
  await assert.rejects(validate, /ENOENT/);
  await writeFile(path.join(dist, image.slice(1)), "fixture");
  await validate();
  for (const url of [undefined, `http://privateimagetotext.com${image}`, `${origin}/guides/example/wrong.webp`]) {
    await writeFile(path.join(dist, "sitemap.xml"), xml(url));
    await assert.rejects(validate, /figures differ/);
  }
});
