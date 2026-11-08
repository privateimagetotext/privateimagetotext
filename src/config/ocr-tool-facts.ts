import { OCR_LANGUAGE_NAMES } from "./ocr-languages";
import { OCR_IMAGE_FORMAT_LABEL, OCR_MARKDOWN_OUTPUT, OCR_TEXT_OUTPUT, productConfig, PUBLIC_TOOL_COST_LABEL, PUBLIC_TOOL_TERMS } from "./product";

const offlineAvailability = `Works after the site files and selected language OCR assets, including the model, have been cached.`;

// This collection is rendered as the visible definition list and as JSON-LD
// featureList. Technical limits and formats come from the validator's config.
export const ocrToolFacts = [
  { label: "Input formats", value: OCR_IMAGE_FORMAT_LABEL },
  { label: "Limits", value: `Up to ${productConfig.fileLimits.maximumFileSizeLabel} per image and ${productConfig.fileLimits.maximumDecodedPixelsLabel}; very large images are previewed at a reduced size in your browser.` },
  { label: "Language", value: `${OCR_LANGUAGE_NAMES}. Printed text; choose up to three languages. Handwriting is not a strength.` },
  { label: "Output", value: `Editable text; copy to clipboard or download as ${OCR_TEXT_OUTPUT.extension} or Markdown (${OCR_MARKDOWN_OUTPUT.extension}).` },
  { label: "Where processing happens", value: "In your browser.", verificationLink: true },
  { label: "Offline", value: `${offlineAvailability} The combined offline status is shown in the header and above the tool.`, mobileValue: `${offlineAvailability} The combined offline status is shown in the header and below the tool.` },
  { label: "Account", value: PUBLIC_TOOL_TERMS.accountRequired ? "Required." : "None." },
  { label: "Cost", value: `${PUBLIC_TOOL_COST_LABEL}.` },
] as const;

export const ocrToolFeatures = ocrToolFacts.map(({ label, value }) => `${label}: ${value}`);
