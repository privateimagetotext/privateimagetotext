import type { GuideContent } from "../guides";

export const improveOcrAccuracyGuideContent = {
  slug: "improve-ocr-accuracy",
  introduction:
    "OCR, or optical character recognition, works best when the text is clear and the settings match the image. You usually get a better result by improving the input than by repeatedly recognising the same difficult image. This guide shows what to change first and how to check the result before relying on it.",
  sections: [
{
      id: "ocr-accuracy-measurement",
      heading: "How OCR accuracy is measured",
      paragraphs: [
        "Character Error Rate (CER) measures the edits needed to turn recognised text into a checked reference: substitutions for wrong characters, deletions for missing characters and insertions for extra characters. Divide their total by the reference character count. Word Error Rate (WER) uses the same calculation with whole words. Lower is better; enough extra text can push either error rate above 100%.",
        "For example, a reference line contains 120 characters. OCR makes three substitutions and one deletion, with no insertions. CER = (3 + 1 + 0) / 120 = 0.0333, or 3.3%. Calling that 96.7% character accuracy means using 100% minus CER; it does not mean 96.7% of the words, lines or documents are correct.",
        "“95% accurate” says little without the metric, test set and scoring rules. Decide whether spaces, punctuation, case and line breaks count, then use the same checked references for every comparison. Keep a representative mix of your screenshots, receipts and pages, rather than selecting only the easiest examples. Score Original OCR separately from Tidied or manually corrected text.",
        "One wrong digit in a reference number can send you to the wrong record, while five wrong letters in ordinary prose may leave its meaning clear. Check important fields for exact matches as well as calculating an average. The tool’s engine confidence is an estimate, not measured accuracy against a reference.",
        "This site does not publish an overall accuracy figure: development fixtures cannot represent every user’s images. The example below does not predict results for your documents.",
      ],
      links: [{ label: "CER and WER calculation explained", to: "https://huggingface.co/learn/audio-course/chapter5/evaluation" }],
    },
{
      id: "ocr-accuracy-five-changes",
      heading: "Five ways to improve OCR accuracy",
      steps: [
        "Use the original image or the clearest copy available.",
        "Rotate the image so the text is upright.",
        "Crop away unrelated content without cutting through letters or numbers.",
        "Choose the content type that best matches the layout.",
        "Try Original first, then compare one suitable enhancement preset.",
      ],
      callout:
        "OCR output is a draft. Always compare important names, numbers, dates, codes and punctuation with the source image.",
    },
{
      id: "ocr-accuracy-source-image",
      heading: "Give OCR a clearer source image",
      paragraphs: [
        "Recognition cannot restore detail that is not present in the image. Blur, heavy compression, glare, shadows and very small text can all remove the differences between similar characters.",
        "Where possible, use the original screenshot, photo or scan instead of a screenshot of a screenshot. A tightly cropped, upright image with readable characters is usually easier to recognise than a larger image full of unrelated detail.",
      ],
      bullets: [
        "Keep the full height of every character inside the crop.",
        "Avoid perspective distortion by photographing the page as straight-on as possible.",
        "Use even lighting and move reflections away from glossy paper.",
        "Prefer a sharper image over an enlarged but blurry one.",
        "Split a very cluttered image into a few logical crops when the reading order is unclear.",
      ],
    },
{
      id: "ocr-accuracy-common-errors",
      heading: "Match common errors to the likely cause",
      bullets: [
        "Zero and letter O, one and lowercase l, or capital I are confused — use a sharper source and verify the character from context.",
        "Punctuation disappears — crop more closely, keep the original resolution and use Code / terminal when spacing matters.",
        "Lines appear in the wrong order — use Columns for genuine columns or recognise separate regions individually.",
        "Small text is missing — use a clearer original, a tighter crop or Adaptive document.",
        "Light text on a dark background is poor — try Inverted.",
        "Characters merge together — return to Original or a gentler preset instead of adding more contrast.",
        "Logos, icons or textured backgrounds become nonsense text — crop them out when they are not part of the information you need.",
      ],
    },
{
      id: "ocr-accuracy-review",
      heading: "Review the result in the right order",
      paragraphs: [
        "Check consequential details first. An incorrect account number, command or date matters more than untidy formatting.",
      ],
      bullets: [
        "Names, addresses and organisation names.",
        "Reference numbers, serial numbers and error codes.",
        "Dates, prices, quantities, decimal points and currency symbols.",
        "URLs, email addresses, file paths and command-line switches.",
        "Brackets, quotation marks, slashes, hyphens and other punctuation.",
        "Line breaks and indentation in code or terminal output.",
      ],
      callout:
        "Keep the source image until the extracted text has been checked and used. Recognised text alone is not authoritative evidence of what the image contained.",
    },
{
      id: "ocr-accuracy-content-type",
      heading: "What each setting actually changes",
      paragraphs: [
        "Content type changes text segmentation, reading order and cleanup. Enhancement changes the pixels presented to recognition. They are separate controls: choosing Document in one does not select Document in the other.",
      ],
      bullets: [
        "Content type: Document favours page reading order and joins wrapped prose in Tidied; use it for paragraphs.",
        "Content type: Columns groups text down each column; use it for separate vertical reading areas and check their order.",
        "Content type: Screenshot / app looks for separate text regions; choose it for dialog boxes, labels and controls.",
        "Content type: Code / terminal preserves inter-word spacing and avoids prose joining; choose it for errors, logs and code.",
        "Content type: Single line recognises one line; use a close crop around a reference or heading.",
        "Content type: Scattered text finds isolated text regions; use it for labels spread around an image.",
        "Enhancement: Original keeps the image’s tones; start here for a clear screenshot or scan.",
        "Enhancement: Document converts to greyscale and increases contrast; try it for ordinary printed text.",
        "Enhancement: Adaptive document adjusts tones locally and can enlarge small text or process long pages in sections; try unevenly lit print.",
        "Enhancement: High contrast thresholds pixels to black or white; try faint text, but check for lost thin strokes.",
        "Enhancement: Inverted reverses light and dark colours; try it for light lettering on a dark background.",
      ],
    },
{
      id: "ocr-accuracy-worked-example",
      heading: "Compare a terminal screenshot in two modes",
      paragraphs: [
        "This example used the same monospace terminal image, Original enhancement and the real Extract text action twice. Choose image and wait for the automatic run. The tool now suggests a content type; to reproduce this comparison, explicitly select Document with Original enhancement, choose Re-run OCR and inspect Tidied. Then select Code / terminal and choose Re-run OCR again. Keep the input and enhancement unchanged so you can see what the content mode changes.",
        "Document joined seven recognised lines into one paragraph in Tidied; Code / terminal kept seven lines. Original OCR retained line breaks in both runs. Neither was an exact transcription: LOCAL_ONLY became LOCAL ONLY, the indentation was lost and an extra space appeared before a parenthesis. Preserving lines helps review an error message, but does not make the output safe to execute as code.",
      ],
      figures: [
        { src: "/guides/improve-ocr-accuracy/document.webp", alt: "Real Document mode Tidied result with the seven terminal lines joined into a paragraph", caption: "Document, Tidied: logical lines joined; visual wrapping inside the box is not a line break.", width: 575, height: 461 },
        { src: "/guides/improve-ocr-accuracy/code.webp", alt: "Real Code terminal mode Tidied result retaining seven terminal lines with recognition mistakes still visible", caption: "Code / terminal, Tidied: seven lines retained; check underscores, indentation and punctuation.", width: 575, height: 461 },
      ],
    },
{
      id: "ocr-accuracy-privacy",
      heading: "Before you rely on this",
      paragraphs: [
        "Private Image to Text performs recognition in the current browser and does not upload the selected image or recognised text to an OCR service. Normal hosting requests and aggregate Cloudflare Web Analytics can still occur, but those requests must not contain your selected file or OCR result.",
        "Copied text can enter operating-system clipboard history or synchronisation. Downloaded text remains on the device until you remove it. Clear removes the current work from the page, but it is not a secure operating-system memory wipe.",
      ],
    }
],
} satisfies GuideContent;
