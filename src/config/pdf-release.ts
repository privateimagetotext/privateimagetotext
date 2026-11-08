import type { PublicRouteDefinition } from "./routes";

// The guard keeps raw config imports usable by Node-based test tooling.
export const pdfPublicEnabled = typeof __PDF_OCR_PUBLIC__ !== "undefined" && __PDF_OCR_PUBLIC__;

/** Included in public discovery only by the explicit PDF release build. */
export const pdfPublicRouteDefinition = {
  sourceFile: "src/pages/PdfOcrPage.tsx",
  path: "/pdf-to-text",
  outputFile: "pdf-to-text.html",
  title: "PDF to Text — Private OCR, No Upload",
  description:
    "Extract text from a PDF or scanned PDF in your browser, with OCR in 12 languages, page previews and editable results. This site does not upload your PDF.",
  heading: "Extract text from a PDF. Nothing uploaded.",
  announcement: "PDF to Text page",
  routeType: "tool",
  indexable: true,
  lastModified: "2026-10-29",
} as const satisfies PublicRouteDefinition;

export const pdfGuideRouteDefinition = {
  sourceFile: "src/config/pdf-guide.ts",
  path: "/guides/pdf-to-text",
  outputFile: "guides/pdf-to-text.html",
  title: "Extract Text From a PDF Without Uploading It",
  description:
    "Choose PDF text or multilingual OCR, preview selected pages, and review a private plain-text result with clear document limits.",
  heading: "How to extract text from a PDF without uploading it",
  announcement: "PDF to text guide",
  routeType: "guide",
  indexable: true,
} as const satisfies PublicRouteDefinition;
