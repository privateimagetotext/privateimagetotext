import type { GuideContent } from "../guides";
import { routes } from "../routes";

export const privateOcrForSensitiveDocumentsGuideContent = {
  slug: "private-ocr-for-sensitive-documents",
  // Affiliate registry ids; inert until a matching reviewed entry exists.
  pairedTools: ["proton-drive", "proton-pass"],
  introduction: "Browser-only OCR keeps the selected image and recognised text on your device instead of sending them to an OCR service. You can use that boundary to reduce unnecessary disclosure, then review and export a text draft. This guide explains what the boundary covers, how to check it with a harmless sample and what still depends on your browser, device and handling rules.",
  sections: [
  {
    id: "sensitive-document-no-upload", heading: "What stays in the browser",
    paragraphs: [
      "The image workspace reads the chosen image, prepares its pixels and runs the selected language recognisers locally. This site does not upload the selected image or OCR result, and does not create a cloud history of your work. Choosing a file gives the current page access to that file; it does not mean the whole device becomes inaccessible to other software.",
      "Normal hosting requests still deliver the application, fonts and model. Aggregate Cloudflare Web Analytics traffic can also occur without containing your document or recognised text. A network connection therefore does not by itself prove a document upload. Inspect what requests contain and what triggered them, rather than expecting a web application to make no requests at all.",
    ],
    links: [{ label: "Verify processing in your browser", to: routes.verify }, { label: "Read the FAQ safety answer", to: `${routes.tool}#faq-sensitive-documents` }],
  },
  {
    id: "trusted-device", heading: "Prepare the device before the document",
    bullets: [
      "Use a device and browser profile appropriate for the material, following your organisation’s handling rules.",
      "Review extensions that can read page content and any device monitoring or remote-support software.",
      "Check clipboard history and synchronisation settings before copying sensitive text.",
      "Know whether your Downloads folder, source-image folder and notes are backed up or synchronised elsewhere.",
      "Keep the device locked when unattended and avoid displaying private pages where others can see them.",
    ],
    paragraphs: ["A private browsing window is not a substitute for a trusted device. It does not neutralise malware, monitoring software or someone viewing the screen. If the applicable rules prohibit this workflow, use an approved alternative. The site does not claim medical, legal, contractual or regulatory certification."],
  },
  {
    id: "harmless-example", heading: "Try the workflow with a harmless sample",
    paragraphs: [
      "Before selecting a sensitive document, run a non-sensitive test image. We chose the site’s synthetic screenshot, set Content type to Screenshot / app and Enhancement to Original, then chose Extract text. The real Tidied output included SCREEN-7429. The example contains no private document data and lets you practise checking, editing and clearing a result.",
      "Open the verification guide alongside this test if you want to inspect browser requests. Repeat with a harmless file whose contents you recognise. A successful local example demonstrates that workflow on that browser; it cannot certify the device, every extension or what happens after you paste the text into another service.",
    ],
    figures: [{ src: "/guides/private-ocr-for-sensitive-documents/recognised-text.webp", alt: "Real OCR result from a harmless synthetic screenshot used to practise the sensitive-document workflow", caption: "Practise with synthetic data first. This example is a workflow check, not a device-security certificate.", width: 575, height: 461 }],
  },
  {
    id: "sensitive-document-workflow", heading: "Extract only what you need",
    steps: [
      "Open Extract text and choose Choose image to select the permitted document image. Recognition starts automatically after any large-image confirmation; wait for it to finish before adjusting settings.",
      "Use Crop and Apply crop to focus recognition on the required passage. Cropping the working view does not redact or overwrite the source file.",
      "Set Content type to Document for ordinary paragraphs and Enhancement to Original first; compare another preset only if needed.",
      "Choose Re-run OCR after changing settings. Review Original OCR and Tidied against the source, then choose Edit this version for corrections in Your edits.",
      "Choose Copy text or Download .txt only when the destination and storage location are appropriate for the material.",
    ],
  },
  {
    id: "offline-and-clear", heading: "Prepare offline use and finish deliberately",
    paragraphs: [
      "Use Prepare offline OCR while connected and wait for the offline status to list all selected languages before disconnecting. The site files and selected language models are cached separately from your selected image and text. Test a harmless image after disconnecting; clearing browser data or storage eviction can remove offline resources. Merely opening a page once is not proof that every tool dependency is available offline.",
      "Choose Clear when finished and close the tab. Clear removes the current work from the interface but is not secure operating-system memory erasure. It cannot delete your original image, a downloaded text file, clipboard history, screenshots, backups or content already pasted elsewhere. Deal with those copies according to your own retention requirements.",
    ],
    links: [{ label: "Step-by-step: offline OCR without internet", to: routes.guide.offlineOcr }],
  },
  {
    id: "before-you-rely", heading: "Before you rely on this",
    bullets: [
      "Double-check names, account or reference numbers, dates, quantities, decimal points and any wording that changes an obligation or instruction.",
      "Check that no page, paragraph or selected region is missing; a fluent result is not evidence of complete extraction.",
      "Confirm which result version you exported and whether you made corrections. Retain the source where required.",
      "Review the destination’s privacy and access settings: the browser-only boundary does not follow the text after export.",
    ],
  },
  ],
} satisfies GuideContent;
