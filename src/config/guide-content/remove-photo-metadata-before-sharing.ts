import type { GuideContent } from "../guides";
import { routes } from "../routes";

export const removePhotoMetadataBeforeSharingGuideContent = {
  slug: "remove-photo-metadata-before-sharing",
  // Affiliate registry ids; inert until a matching reviewed entry exists.
  pairedTools: ["proton-drive"],
  introduction: "A photo can reveal more than its visible scene: GPS coordinates, device details, names and embedded thumbnails may travel with it. For eligible still JPEG and PNG files, Media Inspector creates a separate metadata-removed copy and checks it before download. You will keep the source unchanged and review exactly what the supported removal profile did.",
  sections: [
  {
    id: "privacy-first", heading: "Decide what you need to remove",
    paragraphs: [
      "Location metadata can reveal a home or meeting place. Camera serial numbers can link separate pictures to one device. Creator, comment and date fields may expose a person or project. An embedded thumbnail can retain faces or a wider view from before a crop, even when the main picture no longer shows them. These are practical reasons to inspect an image before publishing it.",
      "Open the original in Media Inspector and review Privacy, Raw metadata and Origin & AI clues. Keep a source copy if creation history, attribution or evidence may matter later. Removing provenance is a separate decision from hiding a GPS coordinate: the supported clean-copy action can remove both. Choose a different workflow if the recipient needs the original Content Credentials.",
    ],
  },
  {
    id: "create-copy", heading: "Create and download the verified copy",
    steps: [
      "Choose media file in Media Inspector and select the original JPEG or PNG. Wait for Inspection complete and the credential check.",
      "Read Privacy and Raw metadata, then locate Remove supported metadata below the result tabs.",
      "If eligible, choose Create metadata-removed copy. Leave the page open while the tool checks the source, rewrites it and verifies the output.",
      "Wait for Metadata-removed copy is ready. Review the verification details, removed fields and preserved rendering structure.",
      "Choose Download metadata-removed copy. It saves a separate file with a -clean suffix; the original is not overwritten.",
      "Choose Replace and inspect that downloaded copy. Check the dimensions, privacy findings, credential result and visible appearance before sharing it.",
    ],
  },
  {
    id: "what-remains", heading: "What removal changes and preserves",
    paragraphs: [
      "The tool performs a lossless structural rewrite, not an image re-encode. For eligible JPEGs it removes supported metadata carriers such as EXIF, XMP, comments and embedded previews while retaining the encoded image structure. For eligible PNGs it removes text, EXIF, credential and other non-allowlisted ancillary chunks. Rendering information on the supported allowlist can remain, including applicable transparency and colour-description structures.",
      "Before enabling download, it reinspects and hashes the output, checks pixel, orientation and colour handling, compares recognised metadata and privacy findings, and lists preserved structure. The output credential check must report no embedded Content Credentials. This is why “metadata-removed” does not mean every non-pixel byte disappears: a valid image still needs format and rendering information.",
    ],
    links: [{ label: "Technical removal and verification profile", to: `${routes.howItWorksTechnical}#technical-media-inspector-title` }],
  },
  {
    id: "worked-example", heading: "A comment removed from a real sample run",
    paragraphs: ["For this example, a synthetic PNG contained the comment “Guide example: private meeting location”. We inspected it, chose Create metadata-removed copy, downloaded the result and opened it again in the inspector. The comment was absent and the credential check reported none found. The image did not contain a credential beforehand; this example demonstrates comment removal and output verification, not a credential-removal test."],
    figures: [{ src: "/guides/remove-photo-metadata-before-sharing/verified-copy.webp", alt: "Media Inspector verification panel for a synthetic PNG after removing its private comment metadata", caption: "The real clean-copy result. Review the reported removals and preserved image structure before downloading.", width: 690, height: 1175 }],
  },
  {
    id: "unsupported-files", heading: "Why the action can be unavailable",
    paragraphs: ["The clean-copy profile supports a narrow set of actual still JPEG and PNG files, up to 32 MiB, 8,192 pixels per side and 36 megapixels. Animated images, embedded ICC profiles, orientation-dependent pictures and ambiguous or malformed structures can be rejected. Other inspected formats do not automatically qualify. An unavailable action means the tool cannot complete its verification safely; it does not mean the file has no metadata. It does not silently fall back to lossy conversion."],
  },
  {
    id: "removing-credentials-ai", heading: "Removing credentials does not make an AI image look human-made",
    paragraphs: ["Stripping provenance removes evidence; it does not change the pixels or turn generated content into a photograph. Pixel-based AI detectors do not need metadata, and other detection systems may combine several signals, so metadata removal cannot guarantee evasion or a particular detector result. Misrepresenting AI output as a photograph may breach platform rules or laws in some places, depending on context; EU rules, for example, require disclosure for certain deepfakes. Share the image with an accurate description of how it was made."],
    links: [{ label: "Provenance and image classifiers", to: "https://openai.com/index/understanding-the-source-of-what-we-see-and-hear-online/" }, { label: "EU transparency obligations and exceptions", to: "https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act" }],
  },
  {
    id: "before-you-rely", heading: "Before you rely on this",
    bullets: [
      "Check visible faces, street signs, badges, reflections, QR codes and paperwork. Metadata removal does not redact the picture.",
      "Check the downloaded -clean file rather than accidentally sharing the original. A new fingerprint identifies the new bytes, not improved authenticity.",
      "Keep originals when provenance or records matter. Do not call the output authenticated because removal verification passed.",
      "Inspection and rewriting stay in your browser, but downloaded files, clipboard history, backups and later uploads remain under your device and sharing settings.",
    ],
  },
  ],
} satisfies GuideContent;
