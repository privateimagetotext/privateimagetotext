import type { RouteMetadata } from "./routes";
import { pdfPublicRouteDefinition } from "./pdf-release";

export const pdfOcrPreviewRoute = __PDF_OCR_PREVIEW__ || __PDF_OCR_PUBLIC__
  ? {
      ...pdfPublicRouteDefinition,
      title: __PDF_OCR_PUBLIC__ ? pdfPublicRouteDefinition.title : "PDF to Text Preview — Private Local OCR",
      announcement: __PDF_OCR_PUBLIC__ ? pdfPublicRouteDefinition.announcement : "PDF to Text preview",
      indexable: __PDF_OCR_PUBLIC__,
    }
  : undefined;

export const pdfOcrPreviewMetadata: RouteMetadata | undefined =
  pdfOcrPreviewRoute
    ? {
        title: pdfOcrPreviewRoute.title,
        description: pdfOcrPreviewRoute.description,
        announcement: pdfOcrPreviewRoute.announcement,
        indexable: __PDF_OCR_PUBLIC__,
        canonicalPath: __PDF_OCR_PUBLIC__ ? pdfOcrPreviewRoute.path : undefined,
        routeType: pdfOcrPreviewRoute.routeType,
      }
    : undefined;

export const pdfOcrPreviewRouteDocuments = __PDF_OCR_PREVIEW__ && pdfOcrPreviewRoute
  ? [pdfOcrPreviewRoute]
  : [];
