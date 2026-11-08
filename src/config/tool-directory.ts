import { pdfPublicEnabled } from "./pdf-release";
import { routes } from "./routes";

export type ToolDirectoryEntry = {
  readonly path: string;
  readonly name: string;
  /** One accurate sentence about what the tool does today. */
  readonly summary: string;
  readonly actionLabel: string;
};

/**
 * Every public tool, in navigation order. Cross-tool sections, the not-found
 * page and the About page derive from this list, so a new tool only needs an
 * entry here to become discoverable from the others.
 */
export const toolDirectory: readonly ToolDirectoryEntry[] = [
  {
    path: routes.tool,
    name: "Image to text",
    summary:
      "Turn screenshots, photos and scans into editable text with OCR that runs in your browser.",
    actionLabel: "Extract text from an image",
  },
  ...(pdfPublicEnabled && routes.pdfToText
    ? [{
      path: routes.pdfToText,
      name: "PDF to text",
      summary:
        "Extract text from a selectable or scanned PDF, with page previews and OCR in 12 languages.",
      actionLabel: "Extract text from a PDF",
    }]
    : []),
  {
    path: routes.hideMessage,
    name: "Hide a message",
    summary:
      "Hide text inside a PNG or JPEG, with optional password encryption, and reveal messages hidden with this tool.",
    actionLabel: "Hide or reveal a message",
  },
  {
    path: routes.mediaInspector,
    name: "Media Inspector",
    summary:
      "View EXIF, GPS and camera metadata, check embedded Content Credentials and save a metadata-removed copy of eligible JPEG or PNG photos.",
    actionLabel: "Inspect a photo's metadata",
  },
  {
    path: routes.stegoAnalysis,
    name: "Steganography analysis",
    summary:
      "View bit planes, extract LSB data and find bytes hidden after a PNG or JPEG ends, in your browser.",
    actionLabel: "Analyse an image for hidden data",
  },
];

export function otherTools(currentPath?: string): readonly ToolDirectoryEntry[] {
  return toolDirectory.filter((tool) => tool.path !== currentPath);
}
