import type { GuideContent } from "../guides";
import { routes } from "../routes";

export const ocrInOtherLanguagesGuideContent = {
  slug: "ocr-in-other-languages",
  introduction: "Extract text can read printed text in English, Spanish, Portuguese, French, German, Indonesian, Vietnamese, Tagalog (Filipino), Turkish, Hindi, Thai and Malay. Each language model is downloaded from this site only when you select it, then recognition runs in your browser. The image and the recognised text are not uploaded, which matters for letters, forms and identity documents written in a language other than English.",
  sections: [
  {
    id: "supported-languages", heading: "Which languages are supported",
    paragraphs: [
      "The tool uses Tesseract’s compact “fast” language models, pinned to a specific upstream version and checked against recorded hashes before use. Each model is a separate download of roughly 0.4 to 2 MB; the shared OCR engine is downloaded once on top of that.",
    ],
    table: {
      caption: "Supported OCR languages and writing systems",
      headers: ["Language", "Script", "Notes"],
      rows: [
        ["English", "Latin", "Selected by default."],
        ["Spanish, Portuguese, French, German", "Latin", "Each model includes its own language’s letters, such as ñ in Spanish, ç in Portuguese and French, and ß in German."],
        ["Indonesian, Malay, Tagalog (Filipino)", "Latin", "Choose the matching model; their vocabularies differ even where the alphabet looks the same."],
        ["Turkish", "Latin", "Includes dotted and dotless i (İ, ı) and ğ, ş."],
        ["Vietnamese", "Latin with tone marks", "Stacked diacritics are small; use a sharp, high-resolution image."],
        ["Hindi", "Devanagari", "Text cleanup is switched off whenever Hindi or Thai is selected, including for any other language selected with it, so characters and spacing stay exactly as recognised."],
        ["Thai", "Thai", "Text cleanup is switched off, as for Hindi. Thai is written without spaces between words, and the recogniser may insert spaces."],
      ],
    },
    callout: `Chinese, Japanese, Korean, Arabic and handwriting are not supported.${routes.pdfToText ? " The PDF tool offers the same languages for scanned pages." : ""}`,
  },
  {
    id: "choose-languages", heading: "Choose languages and extract text",
    steps: [
      "Open Extract text and expand Languages above the tool. English is selected by default.",
      "Tick the language of your image. You can select up to three, for example Spanish and English for a bilingual form. If the image contains no English, untick English so only the languages actually present are used.",
      "Optionally choose Download selected languages to fetch the models before you add an image. Otherwise they download automatically when recognition starts.",
      "Add the image by choosing a file, pasting a screenshot or dropping it on the page.",
      "Review the result in Tidied or Original OCR, correct it in Your edits, then copy or download it.",
      "If you change languages after recognition, choose Re-run OCR to update the result.",
    ],
    figures: [{ src: "/guides/ocr-in-other-languages/language-picker.webp", alt: "Expanded language picker with English and Spanish ticked, model sizes for all 12 languages and a Download selected languages button", caption: "The real language picker. Selecting a language does not download it; sizes are for the language models only.", width: 620, height: 695 }],
  },
  {
    id: "examples", heading: "Real results in Spanish and Hindi",
    paragraphs: [
      "We ran two synthetic test images through the tool with only the matching language selected. The Spanish image was recognised exactly as “El texto permanece en este dispositivo.”, including the full stop. The Hindi image was recognised as “नमस्ते दुनिया”, and the page showed that text cleanup is disabled for Hindi and Thai, so the Tidied view keeps the original output. These clean, single-line samples show that each script works; they are not an accuracy benchmark for real documents.",
    ],
    figures: [
      { src: "/guides/ocr-in-other-languages/spanish-result.webp", alt: "Extract text showing a Spanish sample image and the recognised sentence El texto permanece en este dispositivo.", caption: "Spanish only, real local result.", width: 1194, height: 543 },
      { src: "/guides/ocr-in-other-languages/hindi-result.webp", alt: "Extract text showing a Hindi sample image, the recognised Devanagari text and the notice that text cleanup is disabled for Hindi and Thai", caption: "Hindi only, real local result, with cleanup switched off.", width: 1272, height: 568 },
    ],
  },
  {
    id: "check-results", heading: "Check results for language-specific mistakes",
    bullets: [
      "Accents and tone marks: check that é, ã, ü, ñ and Vietnamese tone marks have not been dropped or swapped, especially in small text.",
      "Turkish letters: compare I, İ, ı and i carefully. They change meaning and are easily confused at low resolution.",
      "Devanagari: look for broken conjuncts and misplaced vowel signs, and for words split by an inserted space.",
      "Thai: expect extra spaces inside words. Remove them only if you know where word boundaries fall.",
      "Mixed languages: with several languages selected, a word may be read using the wrong model’s vocabulary. If a whole page is in one language, select only that language and re-run.",
      "Numbers, dates and currency symbols: check them in every language, because recognition does not understand formats such as 1.234,56.",
    ],
  },
  {
    id: "improve", heading: "Get better results",
    paragraphs: [
      "Image quality matters more than language choice. Crop to the text, rotate pages upright and make sure the characters are sharp and large enough; scripts with small marks above or below letters suffer first when an image is blurred. The content type and enhancement options apply to every language, while selecting Hindi or Thai skips the final text cleanup for the whole result.",
    ],
    links: [{ label: "How to improve OCR accuracy", to: routes.guide.improveOcrAccuracy }],
  },
  {
    id: "offline-languages", heading: "Use other languages offline",
    paragraphs: [
      "Downloaded language models are cached by your browser, so a language you have used once can work without a connection afterwards. Prepare every language you will need while connected, because a model cannot be downloaded offline. The header status lists the languages ready for offline use.",
    ],
    links: [{ label: "Offline OCR: step-by-step", to: routes.guide.offlineOcr }],
  },
  {
    id: "before-you-rely", heading: "Before you rely on this",
    bullets: [
      "OCR output is a draft. Have names, amounts, dates and official wording checked by someone who reads the language before relying on them.",
      "The fast models favour size and speed over the highest accuracy. Complex layouts, decorative fonts and low-quality photos reduce accuracy.",
      "This tool recognises text; it does not translate it. If you paste the text into a translation service, that service receives it.",
      "Language models are site files cached in your browser. They never contain your images or recognised text.",
    ],
  },
  ],
  faqs: [
  { question: "Can I extract Hindi or Thai text from an image?", answer: "Yes, for clear printed text. Select Hindi or Thai in the language picker before adding the image. Cleanup is switched off for these scripts, so review spacing in the result." },
  { question: "Can I recognise two languages in one image?", answer: "Yes. Select up to three languages, such as Spanish and English for a bilingual form. Selecting only the languages actually present gives the best results." },
  { question: "Is my document uploaded when I use another language?", answer: "No. Only the language model is downloaded, from this site. Your image is recognised in the browser. The text stays in the page; it leaves only if you copy or download it, and Clear discards it." },
  { question: "Why is Chinese or Arabic not available?", answer: "Only the 12 listed languages are currently bundled with the tool. Other scripts would need their own models, downloads and testing before they could be offered." },
  ],
} satisfies GuideContent;
