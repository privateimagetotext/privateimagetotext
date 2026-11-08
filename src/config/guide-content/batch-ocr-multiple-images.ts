import type { GuideContent } from "../guides";
import { routes } from "../routes";
import { OCR_BATCH_LIMITS } from "../ocr-batch-limits";

const batchMiB = OCR_BATCH_LIMITS.bytes / (1024 * 1024);

export const batchOcrMultipleImagesGuideContent = {
  slug: "batch-ocr-multiple-images",
  introduction: `Extract text can process a batch of up to ${OCR_BATCH_LIMITS.files} images, ${batchMiB} MiB in total, one after another in your browser. You can reorder the images, correct each result and export everything as one text file or as a zip of separate text files. Nothing is uploaded, which matters when a batch contains receipts, statements, letters or identity documents.`,
  sections: [
  {
    id: "when-to-batch", heading: "When a batch helps",
    paragraphs: [
      "A batch suits a pile of similar images: a week of receipts, photographed pages of a letter, a set of screenshots from a chat or several error messages from one incident. Instead of choosing, recognising and copying each image separately, you add them together and collect all the text at the end.",
      "Each image keeps its own result. The text is not merged until you export it, so you can review one image at a time and fix mistakes against the right picture.",
    ],
  },
  {
    id: "create-batch", heading: "Add images and run the batch",
    steps: [
      "Open Extract text and, if needed, choose the language of the text under Languages. Images are processed with the languages selected when you choose Process pending images.",
      `Choose image file and select several PNG, JPEG, WebP or BMP images at once, or drop several files on the Image panel. Each image can be up to 25 MiB and 36 megapixels; the batch can hold ${OCR_BATCH_LIMITS.files} images and ${batchMiB} MiB in total.`,
      "Check the list under Your image batch. Use the arrow buttons to put the images in reading order, and Remove to drop any you added by mistake.",
      "Choose Process pending images. Images are recognised one at a time, and each changes from Ready to Complete, or to Needs attention if it fails.",
      "To add more, choose Add more images, then Process pending images again. Only images without a result are processed.",
    ],
    figures: [{ src: "/guides/batch-ocr-multiple-images/batch-complete.webp", alt: "Your image batch panel listing three completed images with reorder, Remove and .txt buttons, and buttons for Combined text .txt and Separate text files .zip", caption: "A real batch of three sample images after Process pending images. Counts and limits are shown at the top right.", width: 1248, height: 356 }],
  },
  {
    id: "review-each", heading: "Review and correct each result",
    paragraphs: [
      "Select an image in the list to show it beside its recognised text. Check the result against the picture and correct it in Your edits. Corrections stay with that image when you select another one. The exports use the Your edits text, which is the Tidied result unless you changed it, even if Original OCR is on screen. Changing the crop, rotation, enhancement or content type of an image discards its result and your corrections, so make those changes before correcting the text. If you change languages after processing, select each completed image and choose Re-run OCR.",
      "If an image cannot be processed, it is marked Needs attention with a short message. If the file could not be read, remove it and add a corrected file. If recognition failed, select it, try cropping, rotating or a different content type, then choose Re-run OCR or Process pending images.",
    ],
    links: [{ label: "How to improve OCR accuracy", to: routes.guide.improveOcrAccuracy }],
  },
  {
    id: "export", heading: "Download one combined file or separate files",
    bullets: [
      "Combined text .txt saves image-batch.txt, with each completed image under a heading line such as --- receipt.png --- in batch order.",
      "Separate text files .zip saves image-text-files.zip, with one numbered text file per completed image, for example 01-receipt-ocr.txt.",
      "The .txt button beside an image saves that image’s text on its own.",
      "Copy, Markdown, Re-run OCR and the other single-image options remain available for the selected image.",
    ],
    paragraphs: [
      "In our run, three sample images (a screenshot, a receipt and a terminal window) were processed in one batch. The combined file contained all three sections in order, including “Reference: SCREEN-7429” from the screenshot and “TOTAL $38.45” from the receipt.",
    ],
  },
  {
    id: "privacy", heading: "What happens to the images",
    paragraphs: [
      "The images and recognised text stay in the page’s memory while you work. Large previews are reduced locally; your original files are not changed. The batch is not saved anywhere: choosing Clear or leaving the page discards it, so export first. Downloaded text files are then controlled by your device, like any other download.",
    ],
    links: [{ label: "Verify browser-only processing", to: routes.verify }],
  },
  {
    id: "before-you-rely", heading: "Before you rely on this",
    bullets: [
      `The limit is ${OCR_BATCH_LIMITS.files} images and ${batchMiB} MiB per batch. For more, export, choose Clear and start another batch.`,
      "OCR results are drafts. Check totals, dates, reference numbers and names in each image before using the exported text.",
      "Printed text works best. Handwriting, very small text and poorly lit photos reduce accuracy in a batch just as they do individually.",
      "Processing many large images can be slow on older phones and laptops, because all recognition happens on your device.",
    ],
  },
  ],
  faqs: [
  { question: "How many images can I convert to text at once?", answer: `Up to ${OCR_BATCH_LIMITS.files} images and ${batchMiB} MiB per batch. Start a new batch after exporting if you have more.` },
  { question: "Can I get all the text in one file?", answer: "Yes. Combined text .txt saves one file with a heading for each image, in the order shown in the batch list." },
  { question: "Are the images uploaded?", answer: "No. Each image is recognised in your browser, one at a time, and the batch is discarded when you choose Clear or leave the page." },
  { question: "Can I batch PDFs?", answer: routes.pdfToText ? "The image batch accepts images only. Use PDF to Text for PDF files; it handles multi-page documents on its own page." : "The image batch accepts images only, not PDF files." },
  ],
} satisfies GuideContent;
