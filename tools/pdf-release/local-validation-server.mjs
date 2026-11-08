import http from "node:http";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { URL } from "node:url";

// Local test infrastructure only. Never imported by the application/build.
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const temporaryRoot = path.join(repositoryRoot, "tmp");
const root = path.resolve(process.env.PDF_VALIDATION_ROOT ?? "");
const manifestPath = path.resolve(process.env.PDF_VALIDATION_BUILD_MANIFEST ?? "");
const port = Number(process.env.PDF_VALIDATION_PORT);
const offlineMode = process.env.PDF_VALIDATION_OFFLINE_MODE ?? "http503";
if (!["http503", "disconnect"].includes(offlineMode)) throw new Error("Unknown offline transport mode.");
function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
if (!within(temporaryRoot, root) || !within(temporaryRoot, manifestPath)
    || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Set a frozen root/manifest below repo tmp and a valid local port.");
}
const build = JSON.parse(await readFile(manifestPath, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assetFiles = new Set();
for (const file of build.files) {
  const filename = path.resolve(root, file.path);
  if (!within(root, filename)) throw new Error("Unsafe manifest path.");
  const body = await readFile(filename);
  if (body.length !== file.bytes || sha256(body) !== file.sha256) {
    throw new Error(`Frozen build mismatch: ${file.path}`);
  }
  assetFiles.add(file.path.replaceAll("\\", "/"));
}
const pdfManifest = JSON.parse(await readFile(path.join(repositoryRoot, "scripts/pdf-assets.manifest.json"), "utf8"));
const pdfTypes = new Map(pdfManifest.assets.map((asset) => [asset.runtimePath, asset.contentType]));
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'";
const headers = {
  "Content-Security-Policy": csp,
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
};
const controlPrefix = "/__pdf-validation__/";
let fault = null;
let networkDisabled = false;
let requests = [];
let truncated = false;
const holds = new Set();
function mimeType(urlPath, relativeFile) {
  if (pdfTypes.has(urlPath)) return pdfTypes.get(urlPath);
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".wasm": "application/wasm", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8" })[path.extname(relativeFile)] ?? "application/octet-stream";
}
function respond(response, status, body, type = "text/plain", extra = {}) {
  response.writeHead(status, { ...headers, "Content-Type": type, "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", ...extra });
  response.end(body);
}
function json(response, status, value) {
  respond(response, status, JSON.stringify(value), "application/json");
}
function state() {
  return { buildId: build.manifestSha256, buildManifest: { manifestSha256: build.manifestSha256, files: build.files }, fileCount: build.fileCount, fault, networkDisabled, offlineMode, heldRequests: holds.size };
}
function validateFault(value) {
  if (value === null) return null;
  if (!value || typeof value.path !== "string" || !["missing", "wrong-hash", "http-error", "hold"].includes(value.kind)
      || !/^\/(?:pdf\/6\.2\.108|ocr)\//u.test(value.path)
      || !assetFiles.has(value.path.slice(1)) || value.path.includes("?") || value.path.includes("#")) {
    throw new Error("Faults require an exact allowlisted PDF/OCR support path and known kind.");
  }
  return { path: value.path, kind: value.kind };
}
async function control(request, response, pathname) {
  if (request.method === "GET" && pathname === `${controlPrefix}state`) return json(response, 200, state());
  if (request.method === "GET" && pathname === `${controlPrefix}requests`) return json(response, 200, { requests, truncated });
  if (request.method !== "POST" || pathname !== `${controlPrefix}control`) return json(response, 404, { error: "Unknown control." });
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) return json(response, 413, { error: "Control too large." });
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => !["fault", "networkDisabled", "resetLog"].includes(key))) {
    return json(response, 400, { error: "Invalid control fields." });
  }
  const nextFault = Object.hasOwn(input, "fault") ? validateFault(input.fault) : fault;
  for (const key of ["networkDisabled", "resetLog"]) {
    if (Object.hasOwn(input, key) && typeof input[key] !== "boolean") return json(response, 400, { error: "Control flag must be boolean." });
  }
  fault = nextFault;
  if (Object.hasOwn(input, "networkDisabled")) networkDisabled = input.networkDisabled;
  if (input.resetLog) { requests = []; truncated = false; }
  if (fault?.kind !== "hold") {
    for (const held of [...holds]) {
      holds.delete(held);
      await held.release();
    }
  }
  return json(response, 200, state());
}
async function serve(request, response) {
  if (request.headers.host !== `127.0.0.1:${port}`) return respond(response, 400, "Unexpected host.");
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname); }
  catch { return respond(response, 400, "Invalid path."); }
  if (pathname.includes("\\") || pathname.includes("\0")) return respond(response, 400, "Invalid path.");
  if (pathname.startsWith(controlPrefix)) return control(request, response, pathname);
  const record = { path: pathname, status: null, faultApplied: null };
  if (requests.length < 10000) requests.push(record); else truncated = true;
  function fixed(status, message, faultApplied) {
    record.status = status; record.faultApplied = faultApplied;
    return respond(response, status, message);
  }
  if (!["GET", "HEAD"].includes(request.method)) return fixed(405, "Static assets only.", null);
  if (networkDisabled) {
    if (offlineMode === "disconnect") {
      record.status = 0; record.faultApplied = "network-disconnected";
      request.socket.destroy();
      return;
    }
    return fixed(503, "Test origin is offline.", "network-disabled");
  }
  let relativeFile = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!assetFiles.has(relativeFile) && !path.posix.extname(relativeFile)) relativeFile += ".html";
  let status = 200;
  if (!assetFiles.has(relativeFile)) { relativeFile = "404.html"; status = 404; }
  const filename = path.resolve(root, relativeFile);
  if (!within(root, filename)) return fixed(400, "Invalid path.", null);
  const selectedFault = fault?.path === pathname ? fault.kind : null;
  if (selectedFault === "missing") return fixed(404, "Test support asset missing.", selectedFault);
  if (selectedFault === "http-error") return fixed(503, "Test support asset unavailable.", selectedFault);
  const deliver = async () => {
    if (response.destroyed) return;
    let body = await readFile(filename);
    if (selectedFault === "wrong-hash") {
      body = Buffer.from(body);
      if (!body.length) throw new Error("Cannot corrupt an empty support file.");
      body[0] ^= 1;
    }
    record.status = status;
    record.faultApplied = selectedFault;
    const cacheControl = selectedFault ? "no-store" : pathname.startsWith("/pdf/") || pathname.startsWith("/ocr/") || pathname === "/steg/jpeg-v2-codec.wasm" ? "public, max-age=31536000, immutable" : "no-cache";
    const responseHeaders = { ...headers, "Content-Type": mimeType(pathname, relativeFile), "Content-Length": body.length, "Cache-Control": cacheControl };
    response.writeHead(status, responseHeaders);
    response.end(request.method === "HEAD" ? undefined : body);
  };
  if (selectedFault === "hold") {
    record.faultApplied = "hold";
    const held = { release: deliver };
    holds.add(held);
    response.on("close", () => holds.delete(held));
    return;
  }
  return deliver();
}
const server = http.createServer((request, response) => {
  serve(request, response).catch(() => {
    if (!response.headersSent && !response.destroyed) json(response, 400, { error: "Local validation request failed." });
    else response.destroy();
  });
});
server.requestTimeout = 0;
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${port}`, buildId: build.manifestSha256, fileCount: build.fileCount, offlineMode, scope: "Frozen local validation server; not Cloudflare evidence" }) + "\n");
});
function stop() {
  for (const held of holds) void held.release();
  server.close(); server.closeAllConnections();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
