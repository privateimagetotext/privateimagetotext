import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";

// Exercise Cloudflare's real _headers matching, not Vite's MIME middleware or
// a test reimplementation of the rules. No remote bindings or deployment.
process.env.WRANGLER_SEND_METRICS = "false";
const { createTestHarness } = await import("wrangler");
const root = process.cwd();
const manifest = JSON.parse(
  await readFile(path.join(root, "scripts/pdf-assets.manifest.json"), "utf8"),
);

test("Cloudflare serves every offline PDF asset with verified MIME, bytes and security headers", {
  timeout: 120_000,
}, async (t) => {
  assert.equal(
    await readFile(path.join(root, "dist/_headers"), "utf8"),
    await readFile(path.join(root, "public/_headers"), "utf8"),
    "Build first: deployed headers must match their source",
  );
  const server = createTestHarness({
    root,
    workers: [{ configPath: "./wrangler.jsonc" }],
  });
  t.after(() => server.close());
  await server.listen();

  const failures = [];
  for (const asset of manifest.assets) {
    const response = await server.fetch(asset.runtimePath);
    const mime = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim();
    const bytes = new Uint8Array(await response.arrayBuffer());
    const checks = {
      status: response.status === 200,
      mime: mime === asset.contentType ||
        (asset.contentType === "text/javascript" && mime === "application/javascript"),
      size: bytes.byteLength === asset.bytes,
      hash: createHash("sha256").update(bytes).digest("hex") === asset.sha256,
      cache: response.headers.get("cache-control") === "public, max-age=31536000, immutable",
      nosniff: response.headers.get("x-content-type-options") === "nosniff",
      csp: response.headers.get("content-security-policy")?.includes("connect-src 'self';") === true,
    };
    for (const [check, passed] of Object.entries(checks)) {
      if (!passed) failures.push({ path: asset.runtimePath, check, mime });
    }
  }
  assert.deepEqual(failures, [], "PDF offline preparation must accept every deployed support asset");
  t.diagnostic(`Verified ${manifest.assets.length} PDF support assets through Cloudflare's runtime`);
});
