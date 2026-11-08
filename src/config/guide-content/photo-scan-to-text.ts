import type { GuideContent } from "../guides";

export const photoScanToTextGuideContent = {
  slug: "photo-scan-to-text",
  introduction:
    "A phone photo or scanned page can be turned into editable text without sending the document to a cloud OCR service. The result depends on the quality and layout of the image, so a few preparation steps can save far more time than correcting a poor extraction afterwards.",
  sections: [
    {
      id: "photo-scan-prepare",
      heading: "Prepare the page before choosing the image",
      paragraphs: [
        "Private Image to Text does not take the photo for you. Photograph or scan the page with your device first, then select the saved PNG, JPEG, WebP or BMP image in the OCR tool.",
        "Use the original saved image where possible. Copies sent through messaging apps or repeatedly re-saved can lose the small details that distinguish similar characters.",
      ],
      bullets: [
        "Place paper flat and keep all required text inside the frame.",
        "Hold the camera as straight above the page as practical.",
        "Use even light and move glare away from glossy areas.",
        "Keep fingers, clips and shadows away from the text.",
        "Use a resolution where small print is visibly sharp when you zoom in.",
      ],
    },
    {
      id: "photo-scan-workflow",
      heading: "Convert the page to editable text",
      steps: [
        "Open Extract text and use Choose image to select the saved page image. Recognition starts automatically after any large-image confirmation; wait for it to finish before adjusting settings.",
        "Use Rotate left or Rotate right until the text is upright.",
        "Choose Crop, remove the desk and unrelated pages, then choose Apply crop without cutting through characters.",
        "Under Content type, choose Document for paragraphs or Columns for a true multi-column layout.",
        "Set Enhancement to Original first; compare Document or Adaptive document when print is faint, small or unevenly lit.",
        "Choose Re-run OCR after changing settings and wait for Recognised text, keeping the page open.",
        "Compare Original OCR and Tidied with the image, then use Edit this version before Copy text or Download .txt.",
      ],
      callout:
        "Do not discard the source image until names, dates, figures and other important details have been checked.",
    },
    {
      id: "photo-scan-photo-versus-scan",
      heading: "Know what changes between a scan and a photo",
      paragraphs: [
        "A flat scan normally has even scale and lighting. A photo may contain perspective, shadows, curved pages or reflections. OCR can work with both, but it cannot reliably reconstruct characters that are blurred, hidden or distorted beyond recognition.",
      ],
      bullets: [
        "For a clean scan, Original or Document is usually the best starting point.",
        "For a phone photo with uneven light or small print, compare Adaptive document with the original.",
        "For a dark background with light lettering, try Inverted.",
        "For a page photographed at an angle, retake it more squarely when possible rather than relying on stronger contrast.",
      ],
    },
    {
      id: "photo-scan-layout",
      heading: "Handle long pages, columns and side notes",
      paragraphs: [
        "Long or narrow documents may be recognised in bounded local sections so the browser can retain useful source detail. This can take longer than a short screenshot.",
      ],
      bullets: [
        "Use Columns only when the page genuinely has separate reading columns.",
        "Crop marginal notes separately when they interrupt the main reading order.",
        "Split complex forms, tables or mixed layouts into logical regions and recognise each region independently.",
        "Use Single line for one isolated heading, serial number or reference field.",
      ],
      callout:
        "The current tool returns plain editable text. It does not recreate the original page design, produce a searchable PDF or convert a table directly to CSV.",
    },
    {
      id: "photo-scan-review",
      heading: "Check names, numbers and reading order",
      paragraphs: [
        "Review meaning first and formatting second. Correcting line spacing is wasted effort if a name, total or identifier is still wrong.",
      ],
      bullets: [
        "Check headings and the first and last words of each paragraph.",
        "Check page numbers, dates, currencies, percentages and decimal points.",
        "Check hyphenated words that cross line breaks.",
        "Check footnotes, superscripts and very small print separately.",
        "Check whether columns were read in the intended order.",
        "Re-run a smaller crop when only one difficult passage is wrong.",
      ],
    },
    {
      id: "photo-scan-example",
      heading: "Worked example: unevenly lit field notes",
      paragraphs: [
        "We selected a synthetic page with uneven lighting, chose Document under Content type and Adaptive document under Enhancement, then ran Extract text. The real Tidied output retained the heading FIELD NOTES and the reference SHADOW-204, while joining the body lines into a paragraph. The figure shows that unedited output; the source was a controlled test image, not a camera photograph.",
        "Compare the reference and the first and last sentences with the source. A correct reference does not prove that faint words elsewhere survived. For your own photograph, check shadowed areas individually and retake the photo if glare or blur has erased detail. Changing enhancement cannot recreate missing text.",
      ],
      figures: [{ src: "/guides/photo-scan-to-text/recognised-text.webp", alt: "Real Adaptive document OCR result from unevenly lit synthetic field notes, including SHADOW-204", caption: "Document content with Adaptive document enhancement. The heading remains separate and body lines are tidied into prose.", width: 575, height: 461 }],
    },
    {
      id: "photo-scan-sensitive-documents",
      heading: "Before you rely on this",
      paragraphs: [
        "The selected image and recognised text are processed in the current browser and are not uploaded to an OCR service. Browser-only processing does not control the rest of the device. Browser extensions, endpoint monitoring, clipboard history, downloaded files and anyone with access to the unlocked device remain outside the site’s control.",
        "For sensitive material, use a trusted browser profile, review extensions and clipboard settings, choose Clear when finished and manage downloaded copies separately.",
      ],
    },
  ],
  faqs: [
    {
      question: "Which image formats are supported?",
      answer:
        "The image workspace accepts PNG, JPEG, WebP and BMP still images up to 25 MB and 36 megapixels per file. You can queue up to 10 images and 100 MiB in total.",
    },
    {
      question: "Which setting should I use for a normal scanned page?",
      answer:
        "Start with Document as the content type and Original as the enhancement. Compare Document or Adaptive document only when the print needs help.",
    },
    {
      question: "Will the output keep the original formatting?",
      answer:
        "It keeps plain text and some line structure, depending on the chosen mode. It does not reproduce fonts, exact page layout, tables or images.",
    },
    {
      question: "Which languages can it recognise?",
      answer:
        "Choose the matching supported languages before adding the image. Up to three models can run together; unsupported languages may produce misleading output.",
    },
  ],
} satisfies GuideContent;
