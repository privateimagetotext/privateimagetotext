import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { pdfOcrPreviewRoute } from "./config/pdf-preview";
import { guides } from "./config/guides";
import { routes } from "./config/routes";
import "./styles/globals.css";

function isGuidePath(pathname: string) {
  return guides.some((guide) => guide.path === pathname);
}

async function start() {
  const root = document.getElementById("root");
  if (!root) throw new Error("Application root was not found.");

  // Resolve the current route before hydrating its complete prerendered HTML.
  const ToolRoute = window.location.pathname === routes.tool
    ? (await import("./pages/ToolPage")).default : undefined;
  const HideMessageRoute = window.location.pathname === routes.hideMessage
    ? (await import("./pages/HideMessagePage")).default : undefined;

  const MediaInspectorRoute =
    window.location.pathname === routes.mediaInspector
      ? (await import("./pages/MediaInspectorPage")).default
      : undefined;
  const StegoAnalysisRoute = window.location.pathname === routes.stegoAnalysis
    ? (await import("./pages/StegoAnalysisPage")).default : undefined;
  let GuideRoute: typeof import("./pages/GuidePage").default | undefined;
  if (isGuidePath(window.location.pathname)) {
    try {
      GuideRoute = (await import("./pages/GuidePage")).default;
    } catch {
      // Offline without a cached guide chunk: keep the complete prerendered
      // guide readable rather than hydrating into an error.
      return;
    }
  }
  const PdfOcrRoute =
    (__PDF_OCR_PREVIEW__ || __PDF_OCR_PUBLIC__) &&
    pdfOcrPreviewRoute !== undefined &&
    window.location.pathname === pdfOcrPreviewRoute.path
      ? (await import("./pages/PdfOcrPage")).default
      : undefined;
  const application = (
    <React.StrictMode>
      <BrowserRouter>
        <App
          structuredDataDates={JSON.parse(root.dataset.structuredDataDates ?? "{}")}
          MediaInspectorRoute={MediaInspectorRoute}
          ToolRoute={ToolRoute}
          HideMessageRoute={HideMessageRoute}
          StegoAnalysisRoute={StegoAnalysisRoute}
          PdfOcrRoute={PdfOcrRoute}
          GuideRoute={GuideRoute}
        />
      </BrowserRouter>
    </React.StrictMode>
  );

  if (root.hasChildNodes()) hydrateRoot(root, application);
  else createRoot(root).render(application);

  // After start-up, a lazily loaded route chunk can fail to load (offline and
  // not yet cached, or replaced by a newer deployment). Load the page in full
  // instead, which serves its prerendered document rather than a blank page.
  // A start-up failure returns before this point, so this cannot loop.
  window.addEventListener("vite:preloadError", () => window.location.reload());
}

void start();
