import { OCR_LANGUAGES } from "./ocr-languages";
import { pdfPublicEnabled } from "./pdf-release";
import { guides, type GuideMeta } from "./guides";
import { routes, SITE_ORIGIN } from "./routes";
import type { AffiliateEntry, SupportConfig } from "../lib/funding-links";

export type { Guide, GuideMeta, GuideSection } from "./guides";
export type { AffiliateEntry, SupportConfig } from "../lib/funding-links";

export { routes, SITE_ORIGIN };

export type NavigationItem = {
  readonly label: string;
  readonly to: string;
  readonly end?: boolean;
};

export type LocalProcessingStatus =
  | "local-processing"
  | "preparing-offline-app"
  | "offline-app-ready"
  | "offline";

export type LocalProcessingStatusDefinition = {
  readonly label: string;
  readonly description: string;
};

export const localProcessingStatuses: Record<
  LocalProcessingStatus,
  LocalProcessingStatusDefinition
> = {
  "local-processing": {
    label: "Local processing",
    description: "This site processes your selected files and content in this browser.",
  },
  "offline-app-ready": {
    label: "Site available offline",
    description:
      "The site files needed for offline use have been saved in this browser.",
  },
  offline: {
    label: "Offline",
    description:
      "The browser is offline and this site is using saved site files.",
  },
  "preparing-offline-app": {
    label: "Preparing offline app",
    description:
      "The browser is saving the site files needed for offline use.",
  },
};

export type PrivacyFlowStep = {
  readonly label: string;
  readonly detail: string;
};

export type PrivacyFact = {
  readonly title: string;
  readonly detail: string;
};

export type PrivacyCopy = {
  readonly processingPromise: string;
  readonly storageStatement: string;
  readonly clipboardCaveat: string;
  readonly extensionCaveat: string;
  readonly offlineCaveat: string;
  readonly flow: readonly PrivacyFlowStep[];
  readonly facts: readonly PrivacyFact[];
};

export type FileLimits = {
  readonly maximumFileBytes: number;
  readonly maximumFileSizeLabel: string;
  readonly maximumDecodedPixels: number;
  readonly maximumDecodedPixelsLabel: string;
  readonly maximumCanvasSide: number;
  readonly supportedMimeTypes: readonly string[];
  readonly supportedExtensions: readonly string[];
};

export const OCR_IMAGE_FORMATS = {
  png: { label: "PNG", mimeTypes: ["image/png"], extensions: [".png"] },
  jpeg: { label: "JPEG", mimeTypes: ["image/jpeg", "image/jpg"], extensions: [".jpg", ".jpeg"] },
  webp: { label: "WebP", mimeTypes: ["image/webp"], extensions: [".webp"] },
  bmp: { label: "BMP", mimeTypes: ["image/bmp", "image/x-ms-bmp"], extensions: [".bmp"] },
} as const;

export const SUPPORTED_IMAGE_TYPES = Object.values(OCR_IMAGE_FORMATS).flatMap<string>((format) => format.mimeTypes);
export const OCR_IMAGE_FORMAT_LABEL = Object.values(OCR_IMAGE_FORMATS).map((format) => format.label).join(", ");
export const OCR_IMAGE_ACCEPT = Object.values(OCR_IMAGE_FORMATS).map((format) => format.mimeTypes[0]).join(",");
export const OCR_LANGUAGE = { id: "eng", label: "English", modelLabel: "English (default)" } as const;
export const OCR_TEXT_OUTPUT = { extension: ".txt", mimeType: "text/plain;charset=utf-8" } as const;
export const OCR_MARKDOWN_OUTPUT = { extension: ".md", mimeType: "text/markdown;charset=utf-8" } as const;
export const PUBLIC_TOOL_TERMS = { accountRequired: false, price: 0, priceCurrency: "AUD" } as const;
export const PUBLIC_TOOL_COST_LABEL = PUBLIC_TOOL_TERMS.price === 0 ? "Free" : `${PUBLIC_TOOL_TERMS.priceCurrency} ${PUBLIC_TOOL_TERMS.price}`;

export const FILE_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  maxMegabytes: 25,
  maxDecodedPixels: 36_000_000,
  maxMegapixels: 36,
  maxWorkingSide: 4_096,
} as const;

export type OcrLanguage = {
  readonly id: string;
  readonly label: string;
  readonly modelLabel: string;
};

export type OcrModeId =
  | "document"
  | "columns"
  | "screenshot"
  | "code"
  | "sparse"
  | "single-line";

export type OcrMode = {
  readonly id: OcrModeId;
  readonly label: string;
  readonly description: string;
  readonly segmentation:
    | "automatic"
    | "single-block"
    | "sparse"
    | "single-line";
  readonly preserveSpacing: boolean;
  readonly allowProseCleanup: boolean;
};

export type EnhancementPresetId =
  | "original"
  | "document"
  | "adaptive-document"
  | "high-contrast"
  | "inverted";

export type EnhancementPreset = {
  readonly id: EnhancementPresetId;
  readonly label: string;
  readonly description: string;
};

export type MonetisationMode = "off" | "sponsor" | "contextual";

export type MonetisationConfig = {
  readonly mode: MonetisationMode;
  readonly sponsor: {
    readonly name: string;
    readonly copy: string;
    readonly url: string;
    readonly logoAsset: string;
    readonly disclosure: string;
  };
  /**
   * One plain outbound support link (Ko-fi, GitHub Sponsors or Buy Me a
   * Coffee). Rendered only in the shared footer, About and funding pages,
   * never inside a tool workspace. Empty renders nothing.
   */
  readonly support: SupportConfig;
  /**
   * Reviewed affiliate links. Rendered only inside guide content, each with
   * an adjacent disclosure and rel="sponsored noopener noreferrer". Empty
   * renders nothing. Guides reference entries by `id` in `pairedTools`.
   */
  readonly affiliates: readonly AffiliateEntry[];
};

export type ProConfig = {
  readonly enabled: boolean;
  readonly url: string;
  readonly futureCapabilities: readonly string[];
};

export type ProductConfig = {
  readonly name: string;
  readonly descriptor: string;
  readonly homepageEyebrow: string;
  readonly tagline: string;
  readonly supportingPromise: string;
  readonly trustMarkers: readonly string[];
  readonly navigation: readonly NavigationItem[];
  readonly privacy: PrivacyCopy;
  readonly fileLimits: FileLimits;
  readonly ocrLanguages: readonly OcrLanguage[];
  readonly ocrModes: readonly OcrMode[];
  readonly enhancementPresets: readonly EnhancementPreset[];
  readonly guides: readonly GuideMeta[];
  readonly monetisation: MonetisationConfig;
  readonly pro: ProConfig;
  readonly build: {
    readonly environmentLabel: string;
  };
  readonly contactEmail: string;
  readonly securityContact: string;
  readonly features: {
    readonly pdfInput: boolean;
    readonly cameraCapture: boolean;
    readonly persistentHistory: boolean;
  };
};

export const PUBLIC_CONTACT_EMAIL = "contact@privateimagetotext.com";

export const productConfig = {
  name: "Private Image to Text",
  descriptor: "Private browser tools",
  homepageEyebrow: "Free private image to text",
  tagline: "Extract text from images. Nothing uploaded.",
  supportingPromise:
    "Turn screenshots, photos and scans into editable text in your browser. Free multilingual image OCR, with no account required.",
  trustMarkers: [PUBLIC_TOOL_COST_LABEL, PUBLIC_TOOL_TERMS.accountRequired ? "Account required" : "No account", "No image upload"],
  navigation: [
    { label: "Extract text", to: routes.tool, end: true },
    ...(pdfPublicEnabled && routes.pdfToText ? [{ label: "PDF to text", to: routes.pdfToText }] : []),
    { label: "Hide message", to: routes.hideMessage },
    { label: "Media Inspector", to: routes.mediaInspector },
    { label: "How it works", to: routes.howItWorks },
    { label: "Privacy", to: routes.privacy },
    { label: "Guides", to: routes.guides },
  ],
  privacy: {
    processingPromise:
      "Images are processed in this browser. This site does not upload the selected image or recognised text.",
    storageStatement:
      "The application does not intentionally save your document content to browser storage.",
    clipboardCaveat:
      "Copied text may be handled or synchronised by your operating system’s clipboard settings.",
    extensionCaveat:
      "Browser extensions and device-level software are outside this site’s control.",
    offlineCaveat:
      "Offline OCR is available only after the site files and selected OCR language files have been saved in this browser.",
    flow: [
      {
        label: "Your image",
        detail: "The PNG, JPEG, WebP or BMP that you select, drop or paste.",
      },
      {
        label: "Your browser",
        detail:
          "A bounded preview is prepared. Eligible long documents are recognised in bounded local sections at source detail.",
      },
      {
        label: "Text recognition",
        detail: "OCR runs in a background process in this browser.",
      },
      {
        label: "Editable text",
        detail: "Plain text that remains in the current page until you clear it.",
      },
    ],
    facts: [
      {
        title: "No image or text upload",
        detail: "This site does not upload the selected image or recognised text.",
      },
      {
        title: "No account or cloud history",
        detail: "There is no account, remote history or document database.",
      },
      {
        title: "No user content in browser storage",
        detail:
          "Selected images and recognised text are not put in localStorage, IndexedDB or service-worker caches.",
      },
      {
        title: "Clear removes your current work",
        detail:
          "Clear removes current page references, clears visible working areas and stops the relevant background process.",
      },
    ],
  },
  fileLimits: {
    maximumFileBytes: FILE_LIMITS.maxBytes,
    maximumFileSizeLabel: `${FILE_LIMITS.maxBytes / (1024 * 1024)} MiB`,
    maximumDecodedPixels: FILE_LIMITS.maxDecodedPixels,
    maximumDecodedPixelsLabel: `${FILE_LIMITS.maxDecodedPixels / 1_000_000} megapixels`,
    maximumCanvasSide: FILE_LIMITS.maxWorkingSide,
    supportedMimeTypes: SUPPORTED_IMAGE_TYPES,
    supportedExtensions: Object.values(OCR_IMAGE_FORMATS).flatMap<string>((format) => format.extensions),
  },
  ocrLanguages: OCR_LANGUAGES.map(model => ({ ...model, modelLabel: model.label })),
  ocrModes: [
    {
      id: "document",
      label: "Document",
      description: "Favour paragraphs and normal reading order.",
      segmentation: "automatic",
      preserveSpacing: false,
      allowProseCleanup: true,
    },
    {
      id: "columns",
      label: "Columns",
      description: "Read down each column before moving to the next one.",
      segmentation: "automatic",
      preserveSpacing: false,
      allowProseCleanup: true,
    },
    {
      id: "screenshot",
      label: "Screenshot / app",
      description: "Recognise separated labels, controls and interface text.",
      segmentation: "sparse",
      preserveSpacing: false,
      allowProseCleanup: true,
    },
    {
      id: "code",
      label: "Code / terminal",
      description: "Preserve line breaks and inter-word spacing.",
      segmentation: "single-block",
      preserveSpacing: true,
      allowProseCleanup: false,
    },
    {
      id: "sparse",
      label: "Scattered text",
      description: "Find labels and short text scattered around an image.",
      segmentation: "sparse",
      preserveSpacing: false,
      allowProseCleanup: true,
    },
    {
      id: "single-line",
      label: "Single line",
      description: "Optimise recognition for one clear line of text.",
      segmentation: "single-line",
      preserveSpacing: true,
      allowProseCleanup: false,
    },
  ],
  enhancementPresets: [
    {
      id: "original",
      label: "Original",
      description: "Use the image as it is.",
    },
    {
      id: "document",
      label: "Document",
      description: "Improve the contrast of printed text.",
    },
    {
      id: "adaptive-document",
      label: "Adaptive document",
      description:
        "Locally improve small, unevenly lit or long printed text. Long pages may use bounded sections and take a little longer.",
    },
    {
      id: "high-contrast",
      label: "High contrast",
      description: "Use stronger light and dark separation.",
    },
    {
      id: "inverted",
      label: "Inverted",
      description: "Reverse light and dark colours.",
    },
  ],
  guides,
  monetisation: {
    mode: "off",
    sponsor: {
      name: "",
      copy: "",
      url: "",
      logoAsset: "",
      disclosure: "",
    },
    // Paste the full support page URL here, for example
    // "https://ko-fi.com/<handle>" or "https://github.com/sponsors/<user>".
    support: {
      url: "https://ko-fi.com/privateimagetotext82499",
    },
    // Add one AffiliateEntry per approved link: { id, partner, product,
    // description, url, host }.
    // src/lib/funding-links.ts validates each entry and drops anything invalid.
    affiliates: [],
  },
  pro: {
    enabled: false,
    url: "",
    futureCapabilities: [
      ...(pdfPublicEnabled ? [] : ["PDF OCR"]),
      "Additional language packs",
      "Table to CSV",
      "Searchable PDF",
      "Advanced redaction",
      "Opt-in local history",
      "Technical-text presets",
    ],
  },
  build: {
    environmentLabel: "Private web app",
  },
  contactEmail: PUBLIC_CONTACT_EMAIL,
  securityContact: PUBLIC_CONTACT_EMAIL,
  features: {
    pdfInput: pdfPublicEnabled,
    cameraCapture: false,
    persistentHistory: false,
  },
} as const satisfies ProductConfig;

export const footerNavigation = [
  { label: "Steganography analysis", to: routes.stegoAnalysis },
  { label: "About", to: routes.about },
  { label: "How this site is funded", to: routes.funding },
  { label: "Verify privacy", to: routes.verify },
  { label: "Technical documentation", to: routes.howItWorksTechnical },
  { label: "Technical privacy architecture", to: routes.privacyTechnical },
] as const satisfies readonly NavigationItem[];

export const PRODUCT = productConfig;
export const ROUTES = routes;
export const NAVIGATION = productConfig.navigation;
export const PRIVACY_COPY = productConfig.privacy;
export const GUIDES = productConfig.guides;
export const OCR_CONTENT_MODES = productConfig.ocrModes;
export const ENHANCEMENT_PRESETS = productConfig.enhancementPresets;
export const MONETISATION = productConfig.monetisation;

export {
  findGuideBySlug,
  getGuidesByCategory,
  getRelatedGuides,
  guideCategoryConfig,
  guideCategoryOrder,
} from "./guides";
