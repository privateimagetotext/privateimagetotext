import type { GuideContent } from "../guides";
import { routes } from "../routes";

export const viewPhotoMetadataGuideContent = {
  slug: "view-photo-metadata",
  introduction:
    "Photo metadata is information stored alongside the visible image. It can include camera details, dates, orientation, software names, creator fields and sometimes GPS coordinates. Media Inspector reads supported fields locally, but metadata should be treated as a clue rather than proof.",
  sections: [
    {
      id: "view-metadata-what-it-is",
      heading: "What is photo metadata?",
      paragraphs: [
        "Supported metadata includes EXIF camera information, XMP editing and provenance fields, selected IPTC Extension fields carried in XMP and format-specific fields needed by JPEG or PNG files. A file can contain many, few or none of these optional fields.",
        "Metadata is separate from visible content. Removing a GPS tag does not hide a street sign in the picture, and removing a creator field does not remove a visible watermark.",
      ],
      bullets: [
        "Camera make, model, lens and exposure settings.",
        "Date and time fields.",
        "Image dimensions, orientation and colour information.",
        "GPS latitude, longitude or altitude when present.",
        "Software, editor or export-tool names.",
        "Creator, copyright, description or comment fields.",
        "AI-related tags or signed Content Credentials when present and supported.",
      ],
    },
    {
      id: "view-metadata-workflow",
      heading: "Inspect a photo in your browser",
      steps: [
        "Open Media Inspector and choose Choose media file.",
        "Select the original photo from your device; use Replace if another file is already open.",
        "Wait for Inspection complete and the Origin & AI clues credential result before drawing conclusions.",
        "Read Overview for the actual format, dimensions and basic file details.",
        "Open Privacy for fields that may expose location, identity, device or workflow information.",
        "Open Origin & AI clues for ordinary AI-related tags and supported Content Credentials.",
        "Open Raw metadata to search every supported parsed field.",
        "Choose Download JSON report when you need a portable copy of the local findings.",
      ],
      callout:
        "Selecting a file does not modify it. The source remains unchanged. Creating an eligible metadata-removed copy is a separate action that produces a new download.",
    },
    {
      id: "view-metadata-privacy-fields",
      heading: "Review privacy-sensitive fields first",
      paragraphs: [
        "Not every field is dangerous in every context. Risk depends on what the image shows, who will receive it and whether the metadata adds information that the recipient should not have.",
      ],
      bullets: [
        "GPS coordinates can reveal where a photo was taken.",
        "Precise timestamps can reveal routines, travel or when an event occurred.",
        "Camera and software fields can identify a device family or editing workflow.",
        "Creator, owner, copyright or comment fields can expose a name or organisation.",
        "Unique identifiers may help correlate copies or devices, depending on the format and source.",
        "Thumbnail or preview data may preserve information not obvious from the main image in some formats.",
      ],
      callout:
        "Also inspect the visible picture. Faces, documents, screens, number plates, reflections and background landmarks are not metadata and will remain visible.",
      links: [
        {
          label: "Check a photo for location data before you post it",
          to: routes.guide.checkPhotoLocation,
        },
      ],
    },
    {
      id: "view-metadata-interpretation",
      heading: "Interpret present and missing metadata carefully",
      paragraphs: [
        "Ordinary metadata can be edited, copied or removed. A camera name does not prove that a particular camera captured the scene, and a software tag does not prove that every pixel was changed by that application.",
        "Missing metadata is common after screenshots, messaging, social-media processing, export or deliberate removal. Its absence does not prove that an image is human-made, original or safe to share.",
      ],
      bullets: [
        "Present metadata is a clue that should be checked against context.",
        "Conflicting fields may indicate editing, conversion, clock errors or copied metadata.",
        "A declared file extension can be wrong; Media Inspector reports the actual detected format where supported.",
        "A valid signed credential can provide stronger provenance than an ordinary editable tag, but it still describes claims rather than the truth of the depicted event.",
      ],
    },
    {
      id: "view-metadata-fingerprint",
      heading: "Use the file fingerprint for exact-copy comparisons",
      paragraphs: [
        "Media Inspector calculates a SHA-256 fingerprint from the selected file. This value changes when the file bytes change and is useful when comparing two copies.",
      ],
      bullets: [
        "Matching complete fingerprints provide very strong evidence that the compared files are byte-for-byte identical.",
        "Different fingerprints prove that something in the file changed, even if the image looks the same.",
        "A fingerprint does not identify the author, prove authenticity or explain what changed.",
        "Record the filename and context with the fingerprint when using it for your own tracking.",
      ],
      links: [
        {
          label: "Use a fingerprint when sharing a hidden-message image",
          to: routes.guide.shareHiddenMessageImage,
        },
      ],
    },
    {
      id: "view-metadata-formats-and-limits",
      heading: "Know the inspection limits",
      paragraphs: [
        "Media Inspector supports JPEG, PNG, WebP, GIF, MP4, MOV, WebM and common audio containers up to 512 MB, subject to what the file actually contains. Support for metadata fields and Content Credentials varies by format.",
      ],
      bullets: [
        "A recognised container does not guarantee that every internal codec or private metadata block can be decoded.",
        "Large or unusual images may receive structural results without an automatic visual preview.",
        "Video and audio preview requires a separate local action after structural inspection.",
        "The JSON report contains locally parsed findings, not a forensic certification.",
      ],
    },
    {
      id: "metadata-example",
      heading: "Worked example: a private comment in a PNG",
      paragraphs: [
        "We added a harmless demonstration Comment field to a synthetic PNG, selected it in the real inspector and opened Raw metadata. The tool displayed “Guide example: private meeting location” alongside format information. The picture itself did not display that sentence: it lived in an embedded text chunk. The figure shows the actual parsed result.",
        "Use Filter metadata fields to narrow a long list, then clear the filter before treating the review as complete. A field that disappears under a search has not been removed from the file. This sample illustrates why an ordinary screenshot can carry information beyond its visible text; it does not imply that every screenshot contains private comments.",
      ],
      figures: [{ src: "/guides/view-photo-metadata/raw-metadata.webp", alt: "Media Inspector Raw metadata tab showing a synthetic PNG Comment with a private meeting location example", caption: "An editable Comment field in the real inspector. Its presence is evidence of stored text, not proof that the comment is true.", width: 737, height: 481 }],
    },
    {
      id: "view-metadata-privacy-boundary",
      heading: "Before you rely on this",
      paragraphs: [
        "The selected file is read and inspected in the current browser and is not uploaded by Media Inspector. The local preview uses a temporary browser URL that Clear revokes from the page.",
        "Normal hosting and aggregate Cloudflare Web Analytics traffic can still occur, but those requests must not contain the selected file, parsed metadata, fingerprint or report. Browser extensions, device monitoring and downloaded reports remain outside the site’s control.",
      ],
    },
  ],
} satisfies GuideContent;
