import { OCR_LANGUAGE_NAMES } from "./ocr-languages";
import { OCR_IMAGE_FORMAT_LABEL, routes } from "./product";
import { OCR_BATCH_LIMITS } from "./ocr-batch-limits";
import { SITE_AUTHOR_NAME } from "./site-author";

type AnswerPart = { readonly text: string; readonly to?: string };
export type HomepageFaq = { readonly id?: string; readonly question: string; readonly answer: readonly AnswerPart[] };
const accuracyPath = `${routes.guide.improveOcrAccuracy}#ocr-accuracy-measurement`;

export const homepageFaqs: readonly HomepageFaq[] = [
  {
    question: "Is it safe to use this with sensitive documents?",
    id: "faq-sensitive-documents",
    answer: [
      { text: "Processing stays on your device, which avoids sending the document to an OCR service; you can " },
      { text: "check this in your browser", to: routes.verify },
      { text: ". That does not make a sensitive document safe in every situation: browser extensions, clipboard sync and malware are outside the site's control. Follow your organisation's rules for handling sensitive information." },
    ],
  },
  {
    question: "Does it work offline?",
    answer: [{ text: `Yes, once both the site files and selected language OCR files have been cached in this browser. The Offline status shows whether preparation is running, the model still needs caching, or everything needed for image OCR is ready. Use Prepare offline OCR while connected, and check again if you clear browser data or the browser removes cached files.` }],
  },
  {
    question: "Why is some of my text wrong?",
    answer: [
      { text: "OCR produces a draft, not a guarantee: uneven lighting, skew and low resolution can make characters hard to distinguish. " },
      { text: "Improve the source image and OCR settings", to: routes.guide.improveOcrAccuracy },
      { text: ", then compare the result with the original, especially numbers and codes." },
    ],
  },
  {
    question: "How accurate is it?",
    answer: [
      { text: "Accuracy varies with the image, layout and settings, so there is no single reliable percentage for your document. Character error rate (CER) and word error rate (WER) count substitutions, deletions and insertions against a checked reference, divided by its character or word count. See " },
      { text: "how OCR accuracy is measured", to: accuracyPath },
      { text: " and review important details yourself." },
    ],
  },
  {
    question: "Which languages are supported?",
    answer: [{ text: `${OCR_LANGUAGE_NAMES} printed text is supported for image OCR. English is the default; choose up to three languages. Models download from this site on first use and can be cached for offline use. Handwriting is not a strength.` }],
  },
  {
    question: "Can I upload a PDF or several images at once?",
    answer: [
      { text: `You can choose up to ${OCR_BATCH_LIMITS.files} images (${OCR_IMAGE_FORMAT_LABEL}), with a ${OCR_BATCH_LIMITS.bytes / 1024 / 1024} MiB total batch limit; they are processed one at a time in your browser. ` },
      ...(routes.pdfToText ? [
        { text: "For PDFs, use " }, { text: "PDF to text", to: routes.pdfToText },
        { text: " to extract existing text or recognise supported scanned pages locally." },
      ] : [{ text: "PDF input is not currently available in this build." }]),
    ],
  },
  {
    question: "Does the site store my images or text?",
    answer: [{ text: "The application does not intentionally save your images or recognised text to browser storage; current work is held in the page's memory. Clear removes the current work and batch from the page, but is not a secure memory wipe. Copied or downloaded text can remain outside the page, and cached site files and OCR models are separate from your document content." }],
  },
  {
    question: "Who runs this site?",
    answer: [
      { text: `${SITE_AUTHOR_NAME} runs Private Image to Text as a personal project. Read ` },
      { text: "about the project and why it exists", to: routes.about }, { text: "." },
    ],
  },
];

export const faqAnswerText = (faq: HomepageFaq) => faq.answer.map((part) => part.text).join("");
