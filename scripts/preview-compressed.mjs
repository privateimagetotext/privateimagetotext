// Local production-like transfer audit only; never a deployment server.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.resolve("dist");
const requests = [];
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm" };
const headers = Object.fromEntries((await readFile("public/_headers", "utf8")).split("\n").filter(line => /^  [\w-]+: /.test(line)).map(line => { const index = line.indexOf(":"); return [line.slice(0, index).trim(), line.slice(index + 1).trim()]; }).filter(([key]) => ["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"].includes(key)));
createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname === "/__audit__/reset") { requests.length = 0; response.end("reset"); return; }
  if (pathname === "/__audit__/requests") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(requests)); return; }
  let relative = decodeURIComponent(pathname).slice(1);
  if (!relative) relative = "index.html";
  else if (!path.extname(relative)) relative += ".html";
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(filename);
    const type = mime[path.extname(filename)] || "application/octet-stream";
    const compress = /text|json|svg/.test(type) && /\bgzip\b/.test(request.headers["accept-encoding"] || "");
    const body = compress ? gzipSync(bytes) : bytes;
    response.writeHead(200, { ...headers, "Content-Type": type, "Content-Length": body.length, "X-Robots-Tag": "noindex, nofollow", "Cache-Control": /\.(?:html|js)$/.test(relative) && !relative.startsWith("assets/") ? "no-cache" : "public, max-age=3600", Vary: "Accept-Encoding", ...(compress ? { "Content-Encoding": "gzip" } : {}) });
    requests.push({ path: pathname, bytes: body.length, rawBytes: bytes.length });
    response.end(body);
  } catch { response.writeHead(404).end("Not found"); }
}).listen(Number(process.env.PORT ?? 4184), "127.0.0.1", () => console.log(`Compressed audit preview: http://127.0.0.1:${process.env.PORT ?? 4184}`));
