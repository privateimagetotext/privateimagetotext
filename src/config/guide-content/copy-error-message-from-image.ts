import type { GuideContent } from "../guides";
import { routes } from "../routes";

export const copyErrorMessageFromImageGuideContent = {
  slug: "copy-error-message-from-image",
  introduction: "When an error exists only in a screenshot, OCR can save you retyping it for a search or support ticket. This guide produces a checked text draft while keeping the image in your browser. Preserve the error code, application context and line breaks, then review the exact characters before sharing or acting on the result.",
  sections: [
  {
    id: "keep-context", heading: "Keep enough context to identify the error",
    paragraphs: [
      "Save the original screenshot before cropping. Include the application name, the complete error code and the line that explains the failure. A final “operation failed” line may be less useful than the cause immediately above it. If the screenshot contains a long stack trace, keep the opening error and the relevant frames together rather than copying isolated fragments without their order.",
      "Prefer a direct text export or an application’s own Copy details action when available. OCR is useful when those options are unavailable; it cannot restore characters hidden by a clipped window, cursor or notification. Retake the screenshot with larger text if punctuation is too small to distinguish. For a photo of a screen, reduce reflections and photograph it squarely.",
    ],
  },
  {
    id: "extract-error", heading: "Extract the error with the right content type",
    steps: [
      "Open Extract text and choose Choose image, or use Paste image with the screenshot on your clipboard. Recognition starts automatically after any large-image confirmation; wait for it to finish before adjusting settings.",
      "Choose Crop, retain the code and surrounding cause, then choose Apply crop. Use Rotate left or Rotate right for sideways photographs.",
      "Set Enhancement to Original first. If light lettering on a dark background is poorly recognised, compare Inverted in a separate run.",
      "Under Content type, choose Code / terminal for logs and stack traces. Choose Screenshot / app for separated dialog labels and controls.",
      "Choose Re-run OCR after changing settings, wait for Recognised text, then compare Original OCR and Tidied against the source.",
    ],
    paragraphs: ["Document mode’s Tidied view can join lines into prose. That may be useful for paragraphs but inconvenient for a stack trace. Code / terminal avoids that prose joining; it does not guarantee perfect indentation, punctuation or code syntax. Change one setting at a time so you can judge whether it actually helped."],
  },
  {
    id: "terminal-example", heading: "Worked example: ERR-4097",
    paragraphs: [
      "We ran the synthetic terminal image using Original enhancement and Code / terminal. The unedited Tidied result retained seven lines, including ERR-4097 and worker.ts:42. It also changed LOCAL_ONLY to LOCAL ONLY, dropped the indentation and inserted a space before a parenthesis. The screenshot below deliberately retains those mistakes so you can see why the result needs checking.",
      "The error code is a useful search term after comparison with the image. The surrounding text still needs correction before it is quoted as an exact log. A readable result can conceal small but meaningful changes, especially in paths and identifiers. Keep the original screenshot with the ticket when the receiving system and privacy rules permit it.",
    ],
    figures: [{ src: "/guides/copy-error-message-from-image/recognised-text.webp", alt: "Unedited Code terminal OCR result showing ERR-4097, worker.ts:42 and the misrecognised LOCAL ONLY value", caption: "Real Code / terminal output: lines remain, but the underscore and indentation did not survive recognition.", width: 575, height: 461 }],
  },
  {
    id: "review-technical-text", heading: "Check the characters that change meaning",
    bullets: [
      "Compare the error identifier in full, including prefixes, hyphens and leading zeroes.",
      "Check file paths for forward slashes, backslashes, spaces and drive letters; a wrong separator may point somewhere else.",
      "Check quotation marks, brackets, colons, semicolons, underscores and command-line switches.",
      "Distinguish zero from O and one from lowercase l or uppercase I using the source, rather than guessing from context.",
      "Keep timestamps and line numbers when they help locate the event, and verify them separately.",
    ],
    paragraphs: ["Choose Edit this version to make corrections in Your edits. For one difficult token, Crop a smaller region and choose Re-run OCR, keeping the full screenshot for context. A second OCR guess is still a guess if the original pixels are unreadable; mark that token uncertain or retrieve the log from the application."],
  },
  {
    id: "share-error", heading: "Copy only the reviewed information",
    steps: [
      "Select Your edits after correcting the text, then choose Copy text or Download .txt.",
      "Check the destination preserves line breaks and punctuation; use its code or preformatted-text control where available.",
      "Review the text for usernames, internal hostnames, access tokens, private paths and personal information before submitting it.",
      "Choose Clear when finished, and manage saved files and clipboard history separately.",
    ],
  },
  {
    id: "before-you-rely", heading: "Before you rely on this",
    callout: "Do not execute text simply because OCR recovered it. Commands and links can be misrecognised or unsafe in their original form. OCR does not diagnose the error, establish who supplied it or verify a proposed fix. Keep the source until the issue is resolved and distinguish your corrections from the original evidence.",
    links: [{ label: "Understand the real mode comparison", to: `${routes.guide.improveOcrAccuracy}#ocr-accuracy-worked-example` }],
  },
  ],
} satisfies GuideContent;
