import { pdfGuideRouteDefinition, pdfPublicRouteDefinition, pdfPublicEnabled } from "./pdf-release";

export const SITE_ORIGIN = "https://privateimagetotext.com";

export type PublicRouteType = "tool" | "content" | "guide-index" | "guide";

export type PublicRouteDefinition = {
  readonly path: string;
  readonly outputFile: string;
  readonly title: string;
  readonly description: string;
  readonly heading: string;
  readonly announcement: string;
  readonly routeType: PublicRouteType;
  readonly indexable: true;
  readonly sourceFile: string;
  readonly lastModified?: string;
};

/**
 * The serialisable source of truth for every public document route.
 *
 * Build-time prerendering, client metadata, the sitemap, the service-worker
 * document allowlist and rendered-document tests all derive from this object.
 */
export const publicRouteManifest = {
  about: {
    sourceFile: "src/pages/AboutPage.tsx",
    path: "/about",
    outputFile: "about.html",
    title: "About Private Image to Text — Simon's Browser Tools",
    description: "Why Simon built Private Image to Text, his cyber security background, the project's limits, source availability and contact details.",
    heading: "About Private Image to Text",
    announcement: "About Private Image to Text page",
    routeType: "content",
    indexable: true,
    lastModified: "2026-11-07",
  },
  ...(pdfPublicEnabled ? {
    pdfToText: pdfPublicRouteDefinition,
    guidePdfToText: pdfGuideRouteDefinition,
  } : {}),
  tool: {
    sourceFile: "src/pages/ToolPage.tsx",
    path: "/",
    outputFile: "index.html",
    title: "Private Image to Text — Free OCR, No Upload",
    description:
      "Convert screenshots and photos to text with free OCR in your browser. This site does not upload your image or recognised text. No account needed.",
    heading: "Extract text from images. Nothing uploaded.",
    announcement: "Extract text page",
    routeType: "tool",
    indexable: true,
  },
  hideMessage: {
    sourceFile: "src/pages/HideMessagePage.tsx",
    path: "/hide-message",
    outputFile: "hide-message.html",
    title: "Hide Text in an Image — Free, Private Steganography",
    description:
      "Hide or reveal text inside a PNG or JPEG with optional password encryption. Everything runs in your browser, and the image or message is not uploaded.",
    heading: "Hide a message inside an image.",
    announcement: "Hide or reveal message page",
    routeType: "tool",
    indexable: true,
  },
  mediaInspector: {
    sourceFile: "src/pages/MediaInspectorPage.tsx",
    path: "/media-inspector",
    outputFile: "media-inspector.html",
    title: "Photo Metadata Viewer and EXIF Remover — No Upload",
    description:
      "View photo EXIF and GPS data, inspect video and audio metadata, check Content Credentials and save a cleaner copy of eligible photos. Nothing uploaded.",
    heading: "Inspect photo and video metadata. Nothing uploaded.",
    announcement: "Media Inspector page",
    routeType: "tool",
    indexable: true,
  },
  stegoAnalysis: {
    sourceFile: "src/pages/StegoAnalysisPage.tsx",
    path: "/steganography-analysis",
    outputFile: "steganography-analysis.html",
    title: "Steganography Analysis — Bit Planes, LSB and Hidden Bytes",
    description:
      "View image bit planes, extract LSB data and find bytes hidden after PNG or JPEG image data. Free CTF-style analysis in your browser. Nothing uploaded.",
    heading: "Analyse an image for hidden data. Nothing uploaded.",
    announcement: "Steganography analysis page",
    routeType: "tool",
    indexable: true,
  },
  privacy: {
    sourceFile: "src/pages/PrivacyPage.tsx",
    path: "/privacy",
    outputFile: "privacy.html",
    title: "Privacy — What Stays in Your Browser",
    description:
      "Learn what stays in your browser, what is cached for offline use, what Clear removes, and what browser-based privacy cannot control.",
    heading: "Your files and content stay in your browser.",
    announcement: "Privacy page",
    routeType: "content",
    indexable: true,
  },
  privacyTechnical: {
    sourceFile: "src/pages/TechnicalPrivacyPage.tsx",
    path: "/privacy/technical",
    outputFile: "privacy/technical.html",
    title: "Technical Privacy Architecture — Private Image to Text",
    description:
      "Review the local data flows, storage boundaries, encryption handling, cleanup behaviour and offline caches used by Private Image to Text.",
    heading: "Technical privacy architecture",
    announcement: "Technical privacy architecture page",
    routeType: "content",
    indexable: true,
  },
  howItWorks: {
    sourceFile: "src/pages/HowItWorksPage.tsx",
    path: "/how-it-works",
    outputFile: "how-it-works.html",
    title: "How Private Image to Text Works",
    description:
      "See how browser-only OCR, media inspection and image message hiding work in clear steps, including what stays local and what can affect the result.",
    heading: "How Private Image to Text works",
    announcement: "How Private Image to Text works page",
    routeType: "content",
    indexable: true,
  },
  howItWorksTechnical: {
    sourceFile: "src/pages/TechnicalHowItWorksPage.tsx",
    path: "/how-it-works/technical",
    outputFile: "how-it-works/technical.html",
    title: "Technical Docs: OCR, Media Inspection and Steganography",
    description:
      "Technical documentation for OCR, media metadata and provenance inspection, LTSG PNG v1 and JPEG v2, validation, offline assets and cleanup.",
    heading:
      "Technical documentation for OCR, media inspection and image steganography",
    announcement: "Technical documentation page",
    routeType: "content",
    indexable: true,
  },
  verify: {
    sourceFile: "src/pages/VerifyPage.tsx",
    path: "/verify",
    outputFile: "verify.html",
    title: "Verify Browser-Only Processing — Private Image to Text",
    description:
      "Use developer tools to check that selected files, recognised text, parsed metadata, hidden messages and passwords are not uploaded or stored by the site.",
    heading: "Check that your file is not uploaded",
    announcement: "Verify browser-only processing page",
    routeType: "content",
    indexable: true,
  },
  funding: {
    sourceFile: "src/pages/FundingPage.tsx",
    path: "/funding",
    outputFile: "funding.html",
    title: "How This Site Is Funded — Private Image to Text",
    description:
      "Why this free site has no ads or data sales, how optional support and disclosed affiliate links work, and what a partner can and cannot learn.",
    heading: "How this site is funded",
    announcement: "How this site is funded page",
    routeType: "content",
    indexable: true,
    lastModified: "2026-11-07",
  },
  guides: {
    sourceFile: "src/pages/GuidesPage.tsx",
    path: "/guides",
    outputFile: "guides.html",
    title: "Private OCR, Steganography and Media Metadata Guides",
    description:
      "Practical guides for extracting text, hiding messages, inspecting media metadata, removing privacy-sensitive fields and checking origin clues locally.",
    heading: "Private OCR, Steganography and Media Metadata Guides",
    announcement: "Guides page",
    routeType: "guide-index",
    indexable: true,
  },
  guideScreenshotToText: {
    sourceFile: "src/config/guides.ts",
    path: "/guides/screenshot-to-text",
    outputFile: "guides/screenshot-to-text.html",
    title: "Extract Text From a Screenshot Without Uploading It",
    description:
      "A clear workflow for turning screenshot text into editable text in your browser and checking the result before you rely on it.",
    heading: "How to extract text from a screenshot without uploading it",
    announcement: "Screenshot to text guide",
    routeType: "guide",
    indexable: true,
  },
  guideErrorMessage: {
    sourceFile: "src/config/guide-content/screenshot-to-text.ts",
    path: "/guides/copy-error-message-from-image",
    outputFile: "guides/copy-error-message-from-image.html",
    title: "Copy an Error Message From an Image or Screenshot",
    description:
      "Keep error codes, punctuation and line breaks intact when the only copy of an error message is in a screenshot or photo.",
    heading: "How to copy an error message from an image",
    announcement: "Copy an error message guide",
    routeType: "guide",
    indexable: true,
  },
  guideSensitiveDocuments: {
    sourceFile: "src/config/guide-content/copy-error-message-from-image.ts",
    path: "/guides/private-ocr-for-sensitive-documents",
    outputFile: "guides/private-ocr-for-sensitive-documents.html",
    title: "Private OCR: What Browser-Only Actually Means",
    description:
      "Understand what browser-only OCR protects, what it cannot control, and how to handle genuinely sensitive documents more carefully.",
    heading: "Private OCR for sensitive documents: what browser-only means",
    announcement: "Browser-only OCR guide",
    routeType: "guide",
    indexable: true,
  },
  guideImproveOcrAccuracy: {
    sourceFile: "src/config/guide-content/private-ocr-for-sensitive-documents.ts",
    path: "/guides/improve-ocr-accuracy",
    outputFile: "guides/improve-ocr-accuracy.html",
    title: "How to Improve OCR Accuracy for Images and Screenshots",
    description:
      "Improve OCR results with better cropping, rotation, contrast and the right recognition mode. Your image stays in your browser and is not uploaded.",
    heading: "How to improve OCR accuracy for images and screenshots",
    announcement: "Improve OCR accuracy guide",
    routeType: "guide",
    indexable: true,
  },
  guidePhotoScanToText: {
    sourceFile: "src/config/guide-content/improve-ocr-accuracy.ts",
    path: "/guides/photo-scan-to-text",
    outputFile: "guides/photo-scan-to-text.html",
    title: "Convert a Photo or Scan to Text Without Uploading It",
    description:
      "Turn a photo or scanned page into editable text with browser-based OCR. Learn how to prepare the image, choose settings and check the result.",
    heading: "How to convert a photo or scan to text without uploading it",
    announcement: "Photo or scan to text guide",
    routeType: "guide",
    indexable: true,
  },
  guideReceiptToText: {
    sourceFile: "src/config/guide-content/photo-scan-to-text.ts",
    path: "/guides/receipt-to-text",
    outputFile: "guides/receipt-to-text.html",
    title: "Extract Text From a Receipt Without Uploading It",
    description:
      "Extract merchant names, dates, items and totals from a receipt image using private browser OCR, with practical checks for common recognition errors.",
    heading: "How to extract text from a receipt image",
    announcement: "Receipt to text guide",
    routeType: "guide",
    indexable: true,
  },
  guideHideMessageInImage: {
    sourceFile: "src/config/guide-content/receipt-to-text.ts",
    path: "/guides/hide-message-in-image",
    outputFile: "guides/hide-message-in-image.html",
    title: "How to Hide a Message in an Image Privately",
    description:
      "Hide text inside a PNG or JPEG with optional password encryption. Follow a private, browser-only workflow and learn the limits before sharing the image.",
    heading: "How to hide a message in an image without uploading it",
    announcement: "Hide a message in an image guide",
    routeType: "guide",
    indexable: true,
  },
  guideRevealHiddenMessage: {
    sourceFile: "src/config/guide-content/hide-message-in-image.ts",
    path: "/guides/reveal-hidden-message-from-image",
    outputFile: "guides/reveal-hidden-message-from-image.html",
    title: "How to Reveal a Hidden Message From an Image",
    description:
      "Reveal a message from a compatible PNG or JPEG in your browser. Learn what file and password you need, plus why extraction sometimes fails.",
    heading: "How to reveal a hidden message from an image",
    announcement: "Reveal hidden message guide",
    routeType: "guide",
    indexable: true,
  },
  guideShareHiddenMessageImage: {
    sourceFile: "src/config/guide-content/reveal-hidden-message-from-image.ts",
    path: "/guides/share-image-with-hidden-message",
    outputFile: "guides/share-image-with-hidden-message.html",
    title: "How to Share an Image With a Hidden Message Intact",
    description:
      "Keep a hidden message intact when sending its image. Learn which changes break steganography, how to share the exact file and verify it arrived unchanged.",
    heading: "How to share an image with a hidden message intact",
    announcement: "Share image with hidden message guide",
    routeType: "guide",
    indexable: true,
  },
  guideViewPhotoMetadata: {
    sourceFile: "src/config/guide-content/share-image-with-hidden-message.ts",
    path: "/guides/view-photo-metadata",
    outputFile: "guides/view-photo-metadata.html",
    title: "How to View Photo Metadata Without Uploading the File",
    description:
      "View EXIF, GPS, camera, software and other media metadata locally in your browser. Learn what each field can reveal and what missing metadata means.",
    heading: "How to view photo metadata without uploading the file",
    announcement: "View photo metadata guide",
    routeType: "guide",
    indexable: true,
  },
  guideRemovePhotoMetadata: {
    sourceFile: "src/config/guide-content/view-photo-metadata.ts",
    path: "/guides/remove-photo-metadata-before-sharing",
    outputFile: "guides/remove-photo-metadata-before-sharing.html",
    title: "How to Remove Photo Metadata Before Sharing",
    description:
      "Inspect a photo for privacy-sensitive metadata, create a verified cleaner JPEG or PNG when eligible, and understand what metadata removal cannot hide.",
    heading: "How to remove photo metadata before sharing",
    announcement: "Remove photo metadata guide",
    routeType: "guide",
    indexable: true,
  },
  guideAnalyseImageForHiddenData: {
    sourceFile: "src/config/guide-content/analyse-image-for-hidden-data.ts",
    path: "/guides/analyse-image-for-hidden-data",
    outputFile: "guides/analyse-image-for-hidden-data.html",
    title: "Analyse an Image for Hidden Data: Bit Planes, LSB, Bytes",
    description:
      "Check image bit planes, extract least significant bits and find bytes appended after a PNG or JPEG. A private, browser-only workflow for CTF and puzzle images.",
    heading: "How to analyse an image for hidden data: bit planes, LSB and trailing bytes",
    announcement: "Analyse an image for hidden data guide",
    routeType: "guide",
    indexable: true,
  },
  guideCheckAiMetadata: {
    sourceFile: "src/config/guide-content/remove-photo-metadata-before-sharing.ts",
    path: "/guides/check-image-ai-metadata-content-credentials",
    outputFile: "guides/check-image-ai-metadata-content-credentials.html",
    title: "Does This AI Image Have Content Credentials? Check C2PA",
    description:
      "Check whether an AI image has Content Credentials (C2PA) without uploading it. See which tools add them, why they disappear and what a result cannot prove.",
    heading: "How to check an image for AI metadata and Content Credentials",
    announcement: "AI metadata and Content Credentials guide",
    routeType: "guide",
    indexable: true,
  },
  guideCheckPhotoLocation: {
    sourceFile: "src/config/guide-content/check-photo-location-before-posting.ts",
    path: "/guides/check-photo-location-before-posting",
    outputFile: "guides/check-photo-location-before-posting.html",
    title: "Check a Photo for Location Data Before You Post It",
    description:
      "See whether a photo contains GPS coordinates before you post it, without uploading it. Remove location from an eligible copy and stop your phone adding it.",
    heading: "How to check a photo for location data before you post it",
    announcement: "Check a photo for location data guide",
    routeType: "guide",
    indexable: true,
  },
  guideOfflineOcr: {
    sourceFile: "src/config/guide-content/offline-ocr-without-internet.ts",
    path: "/guides/offline-ocr-without-internet",
    outputFile: "guides/offline-ocr-without-internet.html",
    title: "Offline OCR: Extract Text From Images Without Internet",
    description:
      "Prepare browser OCR once while connected, then extract text from screenshots, photos and scans with no internet connection. Nothing to install and no upload.",
    heading: "Offline OCR: how to extract text from an image with no internet connection",
    announcement: "Offline OCR guide",
    routeType: "guide",
    indexable: true,
  },
  guideOcrOtherLanguages: {
    sourceFile: "src/config/guide-content/ocr-in-other-languages.ts",
    path: "/guides/ocr-in-other-languages",
    outputFile: "guides/ocr-in-other-languages.html",
    title: "Image to Text in Spanish, Hindi, Thai and More — No Upload",
    description:
      "Extract printed text from images in 12 languages, including Spanish, French, Hindi, Thai and Vietnamese. OCR runs in your browser, so the image is not uploaded.",
    heading: "How to extract text from images in Spanish, Hindi, Thai and other languages without uploading",
    announcement: "OCR in other languages guide",
    routeType: "guide",
    indexable: true,
  },
  guideBatchOcr: {
    sourceFile: "src/config/guide-content/batch-ocr-multiple-images.ts",
    path: "/guides/batch-ocr-multiple-images",
    outputFile: "guides/batch-ocr-multiple-images.html",
    title: "Batch OCR: Extract Text From Multiple Images at Once",
    description:
      "Convert up to 10 images (100 MiB in total) to text in one batch in your browser, correct each result, then download one combined file or separate files.",
    heading: "How to extract text from multiple images at once without uploading them",
    announcement: "Batch OCR guide",
    routeType: "guide",
    indexable: true,
  },
} as const satisfies Record<string, PublicRouteDefinition>;

export type PublicRouteKey = keyof typeof publicRouteManifest;
export type PublicDocumentRoute =
  NonNullable<(typeof publicRouteManifest)[PublicRouteKey]>["path"];

export const publicRouteDocuments = Object.entries(publicRouteManifest).map(
  ([key, definition]) => ({
    key: key as PublicRouteKey,
    ...definition,
  }),
);

export const publicDocumentRoutes = publicRouteDocuments.map(
  ({ path }) => path,
) as readonly PublicDocumentRoute[];

export const routes = {
  about: publicRouteManifest.about.path,
  pdfToText: pdfPublicEnabled ? pdfPublicRouteDefinition.path : undefined,
  tool: publicRouteManifest.tool.path,
  hideMessage: publicRouteManifest.hideMessage.path,
  mediaInspector: publicRouteManifest.mediaInspector.path,
  stegoAnalysis: publicRouteManifest.stegoAnalysis.path,
  privacy: publicRouteManifest.privacy.path,
  privacyTechnical: publicRouteManifest.privacyTechnical.path,
  howItWorks: publicRouteManifest.howItWorks.path,
  howItWorksTechnical: publicRouteManifest.howItWorksTechnical.path,
  verify: publicRouteManifest.verify.path,
  funding: publicRouteManifest.funding.path,
  guides: publicRouteManifest.guides.path,
  guidePattern: "/guides/:guideSlug",
  guide: {
    pdfToText: pdfPublicEnabled ? pdfGuideRouteDefinition.path : undefined,
    screenshotToText: publicRouteManifest.guideScreenshotToText.path,
    errorMessage: publicRouteManifest.guideErrorMessage.path,
    sensitiveDocuments: publicRouteManifest.guideSensitiveDocuments.path,
    improveOcrAccuracy: publicRouteManifest.guideImproveOcrAccuracy.path,
    photoScanToText: publicRouteManifest.guidePhotoScanToText.path,
    receiptToText: publicRouteManifest.guideReceiptToText.path,
    hideMessageInImage: publicRouteManifest.guideHideMessageInImage.path,
    revealHiddenMessage: publicRouteManifest.guideRevealHiddenMessage.path,
    shareHiddenMessageImage:
      publicRouteManifest.guideShareHiddenMessageImage.path,
    viewPhotoMetadata: publicRouteManifest.guideViewPhotoMetadata.path,
    removePhotoMetadata: publicRouteManifest.guideRemovePhotoMetadata.path,
    checkAiMetadata: publicRouteManifest.guideCheckAiMetadata.path,
    checkPhotoLocation: publicRouteManifest.guideCheckPhotoLocation.path,
    offlineOcr: publicRouteManifest.guideOfflineOcr.path,
    ocrOtherLanguages: publicRouteManifest.guideOcrOtherLanguages.path,
    batchOcr: publicRouteManifest.guideBatchOcr.path,
    analyseImageForHiddenData: publicRouteManifest.guideAnalyseImageForHiddenData.path,
  },
} as const;

export function isPublicDocumentRoute(
  pathname: string,
): pathname is PublicDocumentRoute {
  return publicDocumentRoutes.some((route) => route === pathname);
}

export type RouteMetadata = {
  readonly title: string;
  readonly description: string;
  readonly canonicalPath?: string;
  readonly announcement: string;
  readonly indexable: boolean;
  readonly routeType: PublicRouteType | "not-found";
};

export function socialImagePathForRoute(pathname: string): string {
  return isPublicDocumentRoute(pathname)
    ? `/og${pathname === "/" ? "/home" : pathname}.png`
    : "/og.png";
}

export const routeMetadata = Object.fromEntries(
  publicRouteDocuments.map((route) => [
    route.path,
    {
      title: route.title,
      description: route.description,
      canonicalPath: route.path,
      announcement: route.announcement,
      indexable: route.indexable,
      routeType: route.routeType,
    },
  ]),
) as Record<PublicDocumentRoute, RouteMetadata>;

export const notFoundMetadata: RouteMetadata = {
  title: "Page Not Found — Private Image to Text",
  description: "The requested Private Image to Text page could not be found.",
  announcement: "Page not found",
  indexable: false,
  routeType: "not-found",
};
