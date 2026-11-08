import type { GuideContent } from "./guides";
import { pdfPublicEnabled } from "./pdf-release";

export const pdfGuideContent = pdfPublicEnabled ? {
  slug: "pdf-to-text",
  introduction: "Some PDFs already contain selectable text; others contain only pictures of pages. This workflow handles both in your browser and lets you change the extraction method for an individual page when needed.",
  sections: [
    {
      id: "choose-pdf",
      heading: "Choose a PDF and a page range",
      steps: [
        "Choose or drop one PDF from your device. If it is password protected, enter its password in the local prompt.",
        "Select all pages or a range such as 1-3, 7. Check the selected-page count before starting.",
        "Preview selected pages using Previous page, Next page or the page selector. Choose up to three OCR languages used in your scans.",
        "Start with Automatic mode. It assesses each page's text layer and uses your selected OCR languages when the page needs recognition.",
      ],
      callout: "Limits: one PDF up to 25 MiB and 100 document pages, at most 50 selected pages, and at most 25 pages requiring OCR in one operation. Split larger jobs into page ranges. Large pages may be reduced before OCR. Complex pages can also hit processing or text limits.",
      paragraphs: ["Passwords cannot be recovered. Some malformed or unusually encoded PDFs cannot be processed."],
    },
    {
      id: "choose-method",
      heading: "Choose the extraction method that fits the page",
      bullets: [
        "Existing text extracts the PDF's text layer without running OCR. It is usually faster for a document created digitally.",
        "OCR all recognises rendered page content. Try it when an existing text layer contains errors or unwanted reading order.",
        "Automatic chooses per page using a heuristic. The choice can be wrong; review the result and reprocess an individual page with the other method.",
      ],
      callout: "OCR supports up to three of 12 languages at once; English is the default. Changing languages preserves saved results and edits until you re-run OCR. Handwriting remains unreliable. Complex scripts, vertical text, columns and tables can have poor reading order.",
    },
    {
      id: "review-pdf-text",
      heading: "Review before copying or downloading",
      steps: [
        "Select each result page and compare its editable text with the matching local source preview. Use Fit width, 150% or 200% preview zoom; use a trusted PDF viewer for finer detail and annotations.",
        "Check names, dates, totals, reference numbers, punctuation and page order. Plain text does not preserve the exact page or table layout.",
        "Correct the text, then copy the combined result or download a text file. Page labels preserve where each section came from.",
      ],
      paragraphs: [
        "Interactive form values and annotations can be missing in both extraction modes. An existing text layer can also include text that is not visible on the page. Compare the result with the original PDF before relying on the export.",
        "Cancelled or failed pages are not evidence of a complete extraction. Read the page statuses and resolve gaps before treating the export as a complete document. Reprocessing edited text asks before replacing it.",
      ],
    },
    {
      id: "pdf-example",
      heading: "Worked example: a selectable page",
      paragraphs: [
        "We created a one-page synthetic PDF with the heading LOCAL PDF EXAMPLE and reference PDF-2048. In the real PDF workspace, we used Choose PDF, kept Automatic and chose Process selected pages. The editable result retained the reference and the sentence “This synthetic document contains selectable text.” This example exercises an existing text layer; it is not evidence of scanned-page OCR accuracy.",
        "Select Page 1 and compare the result with the original in a trusted PDF viewer. Check PDF-2048 character by character, then read every sentence and the final line. A short page can look complete while a more complex document loses table relationships or annotations. Review each selected page before using Copy all or Download .txt.",
      ],
      figures: [{ src: "/guides/pdf-to-text/page-text.webp", alt: "Real editable text extracted from a synthetic selectable PDF, including reference PDF-2048", caption: "An actual Automatic extraction of a selectable PDF. Check each page against the source before exporting.", width: 787, height: 401 }],
    },
    {
      id: "pdf-offline-privacy",
      heading: "Before you rely on this",
      paragraphs: [
        "The selected PDF, its password and extracted text are processed in the current browser. The site loads PDF reader and selected OCR language support files from its own origin; preparing those files for offline use does not cache your PDF or previews.",
        "Use the PDF workspace's offline controls while connected and check both PDF and OCR readiness before disconnecting. Site readiness alone does not mean every processing engine is ready.",
        "Clear releases the current document and processing resources. Downloads, clipboard history, browser extensions and device software are outside that cleanup. This is not a secure memory-erasure guarantee.",
      ],
    },
  ],
  faqs: [
    { question: "Does this create a searchable PDF?", answer: "No. The output is editable plain text. It does not rewrite the source PDF or add a searchable text layer." },
    { question: "Can it extract tables to CSV?", answer: "No. Check table values and reading order manually; a plain-text result does not preserve spreadsheet structure." },
    { question: "Why did an extraction stop?", answer: "A document can exceed a page, render, text, memory or processing-time limit. Try fewer pages, select the appropriate extraction method, and check which pages completed before exporting." },
  ],
} as const satisfies GuideContent : undefined;
