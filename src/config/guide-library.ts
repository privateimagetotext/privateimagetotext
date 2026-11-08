import { guides, type Guide, type GuideContent } from "./guides";
import { registerGuideContents } from "./guide-content-store";
import { pdfGuideContent } from "./pdf-guide";
import { screenshotToTextGuideContent } from "./guide-content/screenshot-to-text";
import { copyErrorMessageFromImageGuideContent } from "./guide-content/copy-error-message-from-image";
import { privateOcrForSensitiveDocumentsGuideContent } from "./guide-content/private-ocr-for-sensitive-documents";
import { improveOcrAccuracyGuideContent } from "./guide-content/improve-ocr-accuracy";
import { photoScanToTextGuideContent } from "./guide-content/photo-scan-to-text";
import { receiptToTextGuideContent } from "./guide-content/receipt-to-text";
import { offlineOcrWithoutInternetGuideContent } from "./guide-content/offline-ocr-without-internet";
import { ocrInOtherLanguagesGuideContent } from "./guide-content/ocr-in-other-languages";
import { batchOcrMultipleImagesGuideContent } from "./guide-content/batch-ocr-multiple-images";
import { hideMessageInImageGuideContent } from "./guide-content/hide-message-in-image";
import { revealHiddenMessageFromImageGuideContent } from "./guide-content/reveal-hidden-message-from-image";
import { shareImageWithHiddenMessageGuideContent } from "./guide-content/share-image-with-hidden-message";
import { analyseImageForHiddenDataGuideContent } from "./guide-content/analyse-image-for-hidden-data";
import { viewPhotoMetadataGuideContent } from "./guide-content/view-photo-metadata";
import { removePhotoMetadataBeforeSharingGuideContent } from "./guide-content/remove-photo-metadata-before-sharing";
import { checkImageAiMetadataContentCredentialsGuideContent } from "./guide-content/check-image-ai-metadata-content-credentials";
import { checkPhotoLocationBeforePostingGuideContent } from "./guide-content/check-photo-location-before-posting";

// Imported only by the guide route and the server renderer, so guide bodies
// stay out of the homepage and other tool routes' initial JavaScript.
const contents: readonly GuideContent[] = [
  ...(pdfGuideContent ? [pdfGuideContent] : []),
  screenshotToTextGuideContent,
  copyErrorMessageFromImageGuideContent,
  privateOcrForSensitiveDocumentsGuideContent,
  improveOcrAccuracyGuideContent,
  photoScanToTextGuideContent,
  receiptToTextGuideContent,
  offlineOcrWithoutInternetGuideContent,
  ocrInOtherLanguagesGuideContent,
  batchOcrMultipleImagesGuideContent,
  hideMessageInImageGuideContent,
  revealHiddenMessageFromImageGuideContent,
  shareImageWithHiddenMessageGuideContent,
  analyseImageForHiddenDataGuideContent,
  viewPhotoMetadataGuideContent,
  removePhotoMetadataBeforeSharingGuideContent,
  checkImageAiMetadataContentCredentialsGuideContent,
  checkPhotoLocationBeforePostingGuideContent,
];

const contentBySlug: ReadonlyMap<string, GuideContent> = new Map(
  contents.map((content) => [content.slug, content]),
);

export const fullGuides: readonly Guide[] = guides.map((meta) => {
  const content = contentBySlug.get(meta.slug);
  if (!content) throw new Error(`Missing guide content for ${meta.slug}`);
  const { slug: _slug, ...body } = content;
  return { ...meta, ...body };
});

if (contentBySlug.size !== contents.length || contentBySlug.size !== fullGuides.length) {
  const metaSlugs = new Set(guides.map((meta) => meta.slug));
  const unmatched = contents.map((content) => content.slug).filter((slug) => !metaSlugs.has(slug));
  throw new Error(`Duplicate or unmatched guide content: ${unmatched.join(", ") || "duplicate slugs"}`);
}

registerGuideContents(contentBySlug);

export function findFullGuide(slug: string | undefined): Guide | undefined {
  if (!slug) return undefined;
  return fullGuides.find((guide) => guide.slug === slug);
}
