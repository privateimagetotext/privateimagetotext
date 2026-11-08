import type { Connect, Plugin } from "vite";

export const PDF_RUNTIME_PREFIX = "/pdf/6.2.108/";

function contentTypeForPdfRuntime(pathname: string) {
  if (pathname === `${PDF_RUNTIME_PREFIX}PDFJS-LICENSE.txt`) return "text/plain";
  if (pathname.endsWith(".wasm")) return "application/wasm";
  if (pathname.endsWith(".mjs") || pathname.endsWith(".js")) {
    return "text/javascript";
  }
  if (pathname.endsWith(".ttf")) return "font/ttf";
  if (pathname.endsWith(".otf")) return "font/otf";
  return "application/octet-stream";
}

function installPdfRuntimeHeaders(middlewares: Connect.Server) {
  middlewares.use((request, response, next) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://local.preview").pathname;
    } catch {
      next();
      return;
    }
    if (!pathname.startsWith(PDF_RUNTIME_PREFIX)) {
      next();
      return;
    }
    response.setHeader("Content-Type", contentTypeForPdfRuntime(pathname));
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    next();
  });
}

export function pdfRuntimeHeaders(): Plugin {
  return {
    name: "localtext-pdf-runtime-headers",
    configureServer(server) {
      installPdfRuntimeHeaders(server.middlewares);
    },
    configurePreviewServer(server) {
      installPdfRuntimeHeaders(server.middlewares);
    },
  };
}
