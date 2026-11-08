import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
} from "react";
import { Route, Routes, useLocation } from "react-router";
import { AppFooter } from "./components/AppFooter";
import { AppHeader } from "./components/AppHeader";
import { StructuredData } from "./components/StructuredData";
import type { StructuredDataDates } from "./config/structured-data";
import {
  SITE_ORIGIN,
  productConfig,
  routes,
  type LocalProcessingStatus,
} from "./config/product";
import {
  pdfOcrPreviewMetadata,
  pdfOcrPreviewRoute,
} from "./config/pdf-preview";
import {
  isPublicDocumentRoute,
  notFoundMetadata,
  routeMetadata,
  socialImagePathForRoute,
} from "./config/routes";
import { GuidesPage } from "./pages/GuidesPage";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { TechnicalHowItWorksPage } from "./pages/TechnicalHowItWorksPage";
import { TechnicalPrivacyPage } from "./pages/TechnicalPrivacyPage";
import { VerifyPage } from "./pages/VerifyPage";
import { AboutPage } from "./pages/AboutPage";
import { FundingPage } from "./pages/FundingPage";
import { footerMayShowSupport } from "./lib/funding-links";
import {
  registerLocalServiceWorker,
  type LocalStatus,
} from "./lib/service-worker";

const headerStatus: Record<LocalStatus, LocalProcessingStatus> = {
  "Local processing": "local-processing",
  "Preparing offline app": "preparing-offline-app",
  "Offline app ready": "offline-app-ready",
  Offline: "offline",
};

const LazyMediaInspectorPage = lazy(() => import("./pages/MediaInspectorPage"));
const LazyToolPage = lazy(() => import("./pages/ToolPage"));
const LazyHideMessagePage = lazy(() => import("./pages/HideMessagePage"));
const LazyStegoAnalysisPage = lazy(() => import("./pages/StegoAnalysisPage"));
// Guide bodies load with this route only, keeping them out of other routes' initial JavaScript.
const LazyGuidePage = lazy(() => import("./pages/GuidePage"));
const LazyPdfOcrPage = __PDF_OCR_PREVIEW__ || __PDF_OCR_PUBLIC__
  ? lazy(() => import("./pages/PdfOcrPage"))
  : undefined;

function upsertMeta(
  attribute: "name" | "property",
  key: string,
  content: string,
) {
  const matches = Array.from(
    document.head.querySelectorAll<HTMLMetaElement>(
      `meta[${attribute}="${key}"]`,
    ),
  );
  let element = matches.shift();
  matches.forEach((duplicate) => duplicate.remove());
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = content;
}

function upsertCanonical(href: string) {
  const matches = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]'),
  );
  let element = matches.shift();
  matches.forEach((duplicate) => duplicate.remove());
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.append(element);
  }
  element.href = href;
}

function removeMeta(attribute: "name" | "property", key: string) {
  document.head
    .querySelectorAll(`meta[${attribute}="${key}"]`)
    .forEach((element) => element.remove());
}

function removeCanonical() {
  document.head
    .querySelectorAll('link[rel="canonical"]')
    .forEach((element) => element.remove());
}

export type AppProps = {
  readonly structuredDataDates?: StructuredDataDates;
  readonly MediaInspectorRoute?: ComponentType;
  readonly ToolRoute?: ComponentType;
  readonly HideMessageRoute?: ComponentType;
  readonly StegoAnalysisRoute?: ComponentType;
  readonly PdfOcrRoute?: ComponentType;
  readonly GuideRoute?: ComponentType;
};

export default function App({
  structuredDataDates = {},
  MediaInspectorRoute = LazyMediaInspectorPage,
  ToolRoute = LazyToolPage,
  HideMessageRoute = LazyHideMessagePage,
  StegoAnalysisRoute = LazyStegoAnalysisPage,
  PdfOcrRoute = LazyPdfOcrPage,
  GuideRoute = LazyGuidePage,
}: AppProps) {
  const [localStatus, setLocalStatus] =
    useState<LocalStatus>("Local processing");
  const location = useLocation();
  const publicPath = isPublicDocumentRoute(location.pathname)
    ? location.pathname
    : undefined;
  const isPublicRoute = publicPath !== undefined;
  const isPdfPreviewRoute =
    __PDF_OCR_PREVIEW__ &&
    pdfOcrPreviewRoute !== undefined &&
    location.pathname === pdfOcrPreviewRoute.path;
  const isApplicationRoute = isPublicRoute || isPdfPreviewRoute;
  const metadata = publicPath
    ? routeMetadata[publicPath]
    : isPdfPreviewRoute
      ? (pdfOcrPreviewMetadata ?? notFoundMetadata)
      : notFoundMetadata;
  const guidePath = isPublicRoute && metadata.routeType !== "tool" ? location.pathname : undefined;

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    setLocalStatus(navigator.onLine ? "Local processing" : "Offline");
    void registerLocalServiceWorker(setLocalStatus, guidePath, isApplicationRoute ? location.pathname : routes.tool)
      .then((dispose) => {
        if (cancelled) dispose();
        else cleanup = dispose;
      })
      .catch(() => {
        if (!cancelled) {
          setLocalStatus(navigator.onLine ? "Local processing" : "Offline");
        }
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [guidePath, isApplicationRoute, location.pathname]);

  useEffect(() => {
    const canonicalUrl = metadata.canonicalPath
      ? new URL(metadata.canonicalPath, SITE_ORIGIN).href
      : undefined;
    const socialImageUrl = new URL(socialImagePathForRoute(location.pathname), SITE_ORIGIN).href;
    document.title = metadata.title;
    upsertMeta("name", "description", metadata.description);
    upsertMeta(
      "name",
      "robots",
      metadata.indexable ? "index, follow" : "noindex, nofollow",
    );
    if (canonicalUrl) upsertCanonical(canonicalUrl);
    else removeCanonical();
    upsertMeta(
      "property",
      "og:type",
      metadata.routeType === "guide" ? "article" : "website",
    );
    upsertMeta("property", "og:site_name", productConfig.name);
    upsertMeta("property", "og:title", metadata.title);
    upsertMeta("property", "og:description", metadata.description);
    if (canonicalUrl) upsertMeta("property", "og:url", canonicalUrl);
    else removeMeta("property", "og:url");
    upsertMeta("property", "og:image", socialImageUrl);
    upsertMeta("property", "og:image:alt", metadata.title);
    upsertMeta("property", "og:image:width", "1200");
    upsertMeta("property", "og:image:height", "630");
    upsertMeta("property", "og:image:type", "image/png");
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", metadata.title);
    upsertMeta("name", "twitter:description", metadata.description);
    upsertMeta("name", "twitter:image", socialImageUrl);
    upsertMeta("name", "twitter:image:alt", metadata.title);
    if (!location.hash) window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.hash, location.pathname, metadata]);

  return (
    <>
      <StructuredData pathname={location.pathname} dates={structuredDataDates} />
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <AppHeader
        localStatus={headerStatus[localStatus]}
        activeNavigation={isApplicationRoute}
      />
      {isApplicationRoute ? (
        <Routes>
          <Route path={routes.tool} element={
            <Suspense fallback={<main id="main-content" className="route-loading" role="status">Opening Image to Text…</main>}>
              <ToolRoute />
            </Suspense>
          } />
          <Route path={routes.hideMessage} element={
            <Suspense fallback={<main id="main-content" className="route-loading" role="status">Opening Hide a Message…</main>}>
              <HideMessageRoute />
            </Suspense>
          } />
          <Route
            path={routes.mediaInspector}
            element={
              <Suspense
                fallback={
                  <main id="main-content" className="route-loading" role="status">
                    Opening Media Inspector…
                  </main>
                }
              >
                <MediaInspectorRoute />
              </Suspense>
            }
          />
          <Route path={routes.stegoAnalysis} element={
            <Suspense fallback={<main id="main-content" className="route-loading" role="status">Opening Steganography Analysis…</main>}>
              <StegoAnalysisRoute />
            </Suspense>
          } />
          <Route path={routes.privacy} element={<PrivacyPage />} />
          <Route
            path={routes.privacyTechnical}
            element={<TechnicalPrivacyPage />}
          />
          <Route path={routes.howItWorks} element={<HowItWorksPage />} />
          <Route
            path={routes.howItWorksTechnical}
            element={<TechnicalHowItWorksPage />}
          />
          <Route path={routes.verify} element={<VerifyPage />} />
          <Route path={routes.about} element={<AboutPage />} />
          <Route path={routes.funding} element={<FundingPage />} />
          <Route path={routes.guides} element={<GuidesPage />} />
          <Route path={routes.guidePattern} element={
            <Suspense fallback={<main id="main-content" className="route-loading" role="status">Opening guide…</main>}>
              <GuideRoute />
            </Suspense>
          } />
          {(__PDF_OCR_PREVIEW__ || __PDF_OCR_PUBLIC__) && PdfOcrRoute && pdfOcrPreviewRoute ? (
            <Route
              path={pdfOcrPreviewRoute.path}
              element={
                <Suspense
                  fallback={
                    <main
                      id="main-content"
                      className="route-loading"
                      role="status"
                    >
                      {__PDF_OCR_PUBLIC__ ? "Opening PDF to Text…" : "Opening PDF to Text preview…"}
                    </main>
                  }
                >
                  <PdfOcrRoute />
                </Suspense>
              }
            />
          ) : null}
        </Routes>
      ) : (
        <NotFoundPage />
      )}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {metadata.announcement}
      </div>
      <AppFooter
        buildVersion={import.meta.env.VITE_APP_VERSION}
        activeNavigation={isApplicationRoute}
        showSupport={isPublicRoute && footerMayShowSupport(metadata.routeType)}
      />
    </>
  );
}
