import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import { pdfCompileTimeDefinitions } from "./scripts/pdf-preview-build-config";
import { workerManifest } from "./scripts/worker-manifest-plugin";
import {
  PDF_RUNTIME_PREFIX,
  pdfRuntimeHeaders,
} from "./scripts/pdf-runtime-vite-plugin";

const localCsp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
].join("; ");

// Development and local preview are deliberately non-indexable. Production
// Cloudflare Pages headers are defined separately in public/_headers.
const localPreviewSecurityHeaders = {
  "Content-Security-Policy": localCsp,
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
};

function cloudflarePagesDocumentRouting(): Plugin {
  let outputDirectory = "";

  return {
    name: "localtext-cloudflare-pages-document-routing",
    configResolved(config) {
      outputDirectory = path.resolve(config.root, config.build.outDir);
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
          next();
          return;
        }

        let pathname: string;
        try {
          pathname = decodeURIComponent(
            new URL(request.url ?? "/", "http://local.preview").pathname,
          );
        } catch {
          response.statusCode = 400;
          response.end("Bad request");
          return;
        }

        if (
          pathname === "/" ||
          path.posix.extname(pathname) ||
          pathname.startsWith(PDF_RUNTIME_PREFIX)
        ) {
          next();
          return;
        }

        const relativeDocument = `${pathname.slice(1)}.html`;
        const candidate = path.resolve(outputDirectory, relativeDocument);
        const outputRoot = `${outputDirectory}${path.sep}`;
        const safeCandidate = candidate.startsWith(outputRoot);

        let body: Buffer;
        let status = 200;
        try {
          if (!safeCandidate || pathname.endsWith("/")) {
            throw Object.assign(new Error("Route not found"), {
              code: "ENOENT",
            });
          }
          body = await readFile(candidate);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            next(error as Error);
            return;
          }
          status = 404;
          body = await readFile(path.resolve(outputDirectory, "404.html"));
        }

        response.statusCode = status;
        for (const [name, value] of Object.entries(localPreviewSecurityHeaders)) {
          response.setHeader(name, value);
        }
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Content-Length", body.byteLength);
        if (request.method === "HEAD") response.end();
        else response.end(body);
      });
    },
  };
}

export default defineConfig(({ mode }): UserConfig => ({
  define: pdfCompileTimeDefinitions(),
  plugins: [react(), pdfRuntimeHeaders(), cloudflarePagesDocumentRouting()],
  worker: { format: "es", plugins: () => [workerManifest()] },
  server: {
    host: "127.0.0.1",
    strictPort: true,
    headers:
      mode === "development"
        ? {
            ...localPreviewSecurityHeaders,
            "Content-Security-Policy": localCsp
              .replace(
                "script-src 'self' 'wasm-unsafe-eval'",
                "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'unsafe-inline'",
              )
              .replace(
                "connect-src 'self'",
                "connect-src 'self' ws://127.0.0.1:*",
              ),
          }
        : localPreviewSecurityHeaders,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    headers: localPreviewSecurityHeaders,
  },
  build: {
    sourcemap: false,
    target: "es2022",
    assetsInlineLimit: 0,
    manifest: true,
  },
}));
