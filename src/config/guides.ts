import { guideMeta } from "./guide-content/meta";
import { routes } from "./routes";

export type GuideCategoryId = "ocr" | "steganography" | "media-inspector";

export type GuideCategory = {
  readonly id: GuideCategoryId;
  readonly label: string;
  readonly heading: string;
  readonly introduction: string;
  readonly actionLabel: string;
  readonly actionPath: string;
};

export const guideCategoryConfig = {
  ocr: {
    id: "ocr",
    label: "Extract text",
    heading: "Extract text and OCR",
    introduction:
      "Prepare screenshots, photos, scans and receipts for more accurate printed text recognition, then review the editable result before relying on it.",
    actionLabel: "Open Extract text",
    actionPath: routes.tool,
  },
  steganography: {
    id: "steganography",
    label: "Hide message",
    heading: "Hide and reveal messages",
    introduction:
      "Create, recover and share compatible hidden-message images while preserving the exact file and understanding what password protection does.",
    actionLabel: "Open Hide message",
    actionPath: routes.hideMessage,
  },
  "media-inspector": {
    id: "media-inspector",
    label: "Media Inspector",
    heading: "Media metadata and origin clues",
    introduction:
      "Inspect privacy-sensitive metadata, exact-file fingerprints and origin clues, or create a verified metadata-removed copy when an image is eligible.",
    actionLabel: "Open Media Inspector",
    actionPath: routes.mediaInspector,
  },
} as const satisfies Record<GuideCategoryId, GuideCategory>;

export const guideCategoryOrder = [
  "ocr",
  "steganography",
  "media-inspector",
] as const satisfies readonly GuideCategoryId[];

export type GuideLink = {
  readonly label: string;
  readonly to: string;
};

export type GuideSection = {
  readonly id: string;
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly steps?: readonly string[];
  readonly bullets?: readonly string[];
  readonly callout?: string;
  readonly links?: readonly GuideLink[];
  readonly figures?: readonly GuideFigure[];
  readonly figureLayout?: "pair";
  readonly table?: {
    readonly caption: string;
    readonly headers: readonly string[];
    readonly rows: readonly (readonly string[])[];
  };
};

export type GuideFigure = {
  readonly src: string;
  readonly alt: string;
  readonly caption: string;
  readonly width: number;
  readonly height: number;
};

export type GuideFaq = {
  readonly question: string;
  readonly answer: string;
};

/** Shell metadata: enough for cards, navigation, routes and structured data. */
export type GuideMeta = {
  readonly slug: string;
  readonly path: string;
  readonly category: GuideCategoryId;
  readonly title: string;
  readonly shortTitle: string;
  readonly summary: string;
  readonly eyebrow: string;
  readonly primaryActionLabel: string;
  readonly primaryActionPath: string;
  readonly relatedGuideSlugs: readonly string[];
  readonly datePublished: string | undefined;
  readonly dateModified: string | undefined;
};

/** Guide body, loaded only with the guide route (see `guide-library.ts`). */
export type GuideContent = {
  readonly slug: string;
  readonly introduction: string;
  readonly sections: readonly GuideSection[];
  readonly faqs?: readonly GuideFaq[];
  /**
   * Optional affiliate registry ids (`productConfig.monetisation.affiliates`)
   * for a "Privacy tools that pair well with this guide" block. Unknown or
   * invalid ids are dropped, and the block renders only when at least one
   * reviewed, valid entry resolves.
   */
  readonly pairedTools?: readonly string[];
};

/** A complete guide: metadata joined with its body. */
export type Guide = GuideMeta & Omit<GuideContent, "slug">;

export const guides: readonly GuideMeta[] = guideMeta;

export function findGuideBySlug(slug: string | undefined): GuideMeta | undefined {
  if (!slug) return undefined;
  return guides.find((guide) => guide.slug === slug);
}

export function getGuidesByCategory(category: GuideCategoryId): readonly GuideMeta[] {
  return guides.filter((guide) => guide.category === category);
}

export function getRelatedGuides(guide: GuideMeta): readonly GuideMeta[] {
  return guide.relatedGuideSlugs
    .map((slug) => findGuideBySlug(slug))
    .filter((related): related is GuideMeta => related !== undefined);
}
