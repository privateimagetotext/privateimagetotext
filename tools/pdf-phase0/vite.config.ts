import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { pdfRuntimeHeaders } from "../../scripts/pdf-runtime-vite-plugin";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const productionStyleCsp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com/beacon.min.js https://static.cloudflareinsights.com/beacon.min.js/",
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

const securityHeaders = {
  "Content-Security-Policy": productionStyleCsp,
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
};

function phase1aPdfNetworkBlocker(): Plugin {
  let blocked = false;
  return {
    name: "pdf-phase1a-network-blocker",
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://phase1a.test");
        if (url.pathname === "/__pdf-phase1a/network-block") {
          blocked = url.searchParams.get("enabled") === "1";
          response.statusCode = 204;
          response.setHeader("Cache-Control", "no-store");
          response.end();
          return;
        }
        if (blocked && url.pathname.startsWith("/pdf/6.2.108/")) {
          response.statusCode = 503;
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", "text/plain");
          response.end("PDF runtime origin intentionally unavailable for test");
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [phase1aPdfNetworkBlocker(), pdfRuntimeHeaders()],
  root: import.meta.dirname,
  publicDir: path.join(repositoryRoot, "tmp", "pdf-phase0", "public"),
  server: {
    host: "127.0.0.1",
    port: 4180,
    strictPort: true,
    headers: securityHeaders,
  },
  preview: {
    host: "127.0.0.1",
    port: 4180,
    strictPort: true,
    headers: securityHeaders,
  },
  build: {
    outDir: path.join(repositoryRoot, "tmp", "pdf-phase0", "dist"),
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
    manifest: true,
    sourcemap: false,
  },
  worker: {
    format: "es",
  },
});
