import type { GuideContent } from "../guides";
import { routes } from "../routes";

export const screenshotToTextGuideContent = {
  slug: "screenshot-to-text",
  introduction: "Use a screenshot when an app will not let you select a setting, reference number or sentence. Private Image to Text recognises printed text in 12 selectable languages in your browser and gives you an editable draft. This workflow takes you from the original screenshot to checked text you can copy or download, with the source available for comparison throughout.",
  sections: [
  {
    id: "prepare-screenshot", heading: "Start with the clearest screenshot",
    paragraphs: [
      "Use the original file saved by the device rather than a thumbnail from a chat. Small interface text can become unreadable after resizing or repeated JPEG compression. If you still have access to the app, enlarge its text before taking a new screenshot. Enlarging an already blurry picture cannot recreate missing strokes or punctuation.",
      "Include the whole message and enough context to understand it, but remove unrelated panels when practical. A setting name without its selected value is not a useful record. Keep the original somewhere appropriate until you have compared the extracted text; the OCR draft should not become your only evidence of what the screen showed.",
    ],
  },
  {
    id: "screenshot-extract-review", heading: "Choose the image and recognition settings",
    steps: [
      "Open Extract text and choose Choose image to select a PNG, JPEG, WebP or BMP screenshot. Paste image is another option when an image is on your clipboard. Recognition starts automatically after any large-image confirmation; wait for it to finish before adjusting settings.",
      "Use Crop to remove unrelated content and Apply crop to confirm it. Leave a margin around every character; use Cancel if the crop cuts into the message.",
      "Use Rotate left or Rotate right if the text is sideways. Reset changes returns the image preparation controls to their starting state.",
      "Set Enhancement to Original. Under Content type, choose Screenshot / app for dialog boxes, labels and buttons, or Code / terminal when line breaks matter.",
      "Choose Re-run OCR after changing settings and wait for Recognised text. Keep the tab open while the selected models load and recognition runs.",
    ],
    paragraphs: ["If the browser asks you to reduce a large image, consider a closer crop or a smaller source first. Tiny text may become harder to recognise after reduction. A failed or cancelled run is not a completed transcription; read the status and retry only after resolving the reported problem."],
  },
  {
    id: "screenshot-example", heading: "Worked example: a sample reference number",
    paragraphs: [
      "You can reproduce this example without using private material. On an empty workspace, choose the Screenshot sample button. It loads the site’s synthetic screenshot and runs recognition. In our real run, Tidied included the reference SCREEN-7429 and the sentence “No upload required.” The figure shows the unedited result, not a mock-up.",
      "Compare SCREEN-7429 character by character with the image: check the hyphen, every digit and the order. Then read the surrounding labels. Finding the expected reference does not establish that all the other text is correct. Your own screenshot may use a smaller font, a different layout or unfamiliar names, so this result is not an accuracy promise.",
    ],
    figures: [{ src: "/guides/screenshot-to-text/recognised-text.webp", alt: "Real OCR Tidied result from the Screenshot sample, including reference SCREEN-7429", caption: "The synthetic Screenshot sample recognised in the actual tool. Check the reference against the source before copying it.", width: 575, height: 461 }],
  },
  {
    id: "review-versions", heading: "Compare the result versions before editing",
    paragraphs: [
      "Original OCR retains the recogniser’s output. Tidied applies the selected mode’s cleanup, which can join lines or repair split words. Those changes can help prose but can also hide a meaningful line boundary. Switch between the two when labels appear merged or a result looks unexpectedly fluent. Visual wrapping inside the text box is not necessarily a stored line break.",
      "Choose Edit this version to copy the current version into Your edits. Correct names, numbers and punctuation there while checking the source. If you use Review words against the image, its highlighted crop can help locate a suspicious word. An engine confidence estimate or a low uncertain-word count does not replace checking the actual characters.",
    ],
  },
  {
    id: "copy-checked-text", heading: "Copy the checked text",
    steps: [
      "Select Your edits after making corrections, or the result version you have checked.",
      "Choose Copy text to send that version to the clipboard, or Download .txt to save a plain-text file.",
      "Check the pasted or downloaded text in its destination, especially line breaks and reference numbers.",
      "Choose Clear when finished. Remove downloaded copies or clipboard entries separately when appropriate.",
    ],
    paragraphs: ["Plain text does not reproduce the screenshot’s visual layout, colours or button shapes. If someone needs the original wording in context, retain or share the screenshot through an appropriate channel alongside the corrected text. Check for visible account details or secrets before sharing either version."],
  },
  {
    id: "before-you-rely", heading: "Before you rely on this",
    bullets: [
      "Verify lookalikes such as 0/O, 1/l/I, straight and curly quotes, hyphens and minus signs. One wrong character can change a code or URL.",
      "Check reading order when an interface has several panels. Recognise smaller regions separately if labels and values become mixed.",
      "Processing stays in this browser; extensions, device monitoring, clipboard history and downloaded files remain outside the site’s control.",
      "Treat OCR as a draft. For error messages or commands, preserve the original and do not execute recognised text without reviewing it.",
    ],
    links: [{ label: "Measure and improve OCR accuracy", to: `${routes.guide.improveOcrAccuracy}#ocr-accuracy-measurement` }],
  },
  ],
} satisfies GuideContent;
