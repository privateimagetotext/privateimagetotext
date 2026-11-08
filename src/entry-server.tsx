import React from "react";
// Prerendering, the sitemap and guide-quality checks need complete guides.
export { fullGuides as guides } from "./config/guide-library";
export { socialImagePathForRoute } from "./config/routes";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import App from "./App";
import type { StructuredDataDates } from "./config/structured-data";
import { pdfOcrPreviewRouteDocuments } from "./config/pdf-preview";
import {
  notFoundMetadata,
  publicRouteDocuments,
  SITE_ORIGIN,
} from "./config/routes";
import MediaInspectorPage from "./pages/MediaInspectorPage";
import ToolPage from "./pages/ToolPage";
import HideMessagePage from "./pages/HideMessagePage";
import StegoAnalysisPage from "./pages/StegoAnalysisPage";
import GuidePage from "./pages/GuidePage";

const PdfOcrRoute = __PDF_OCR_PREVIEW__ || __PDF_OCR_PUBLIC__
  ? (await import("./pages/PdfOcrPage")).default
  : undefined;

export {
  notFoundMetadata,
  pdfOcrPreviewRouteDocuments,
  publicRouteDocuments,
  SITE_ORIGIN,
};

export function renderRoute(pathname: string, structuredDataDates: StructuredDataDates = {}) {
  return renderToString(
    <React.StrictMode>
      <StaticRouter location={pathname}>
        <App
          structuredDataDates={structuredDataDates}
          MediaInspectorRoute={MediaInspectorPage}
          ToolRoute={ToolPage}
          HideMessageRoute={HideMessagePage}
          StegoAnalysisRoute={StegoAnalysisPage}
          PdfOcrRoute={PdfOcrRoute}
          GuideRoute={GuidePage}
        />
      </StaticRouter>
    </React.StrictMode>,
  );
}
