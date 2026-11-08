import type { GuideContent } from "../guides";
import { routes } from "../routes";

export const revealHiddenMessageFromImageGuideContent = {
  slug: "reveal-hidden-message-from-image",
  introduction:
    "To reveal a hidden message, you need the compatible image file that contains it and, when password protection was used, the exact password. The visible picture alone is not enough if a service has resized, edited or recompressed the file after it was created.",
  sections: [
    {
      id: "reveal-message-what-you-need",
      heading: "Start with the exact image and password",
      paragraphs: [
        "Private Image to Text reads messages created by this tool or compatible software using the supported LTSG PNG v1 or JPEG v2 formats. It is not a universal scanner for every steganography method.",
      ],
      bullets: [
        "Use the original downloaded PNG or JPEG where possible.",
        "Download an attachment before revealing it; do not use a screenshot of the image.",
        "Ask for the password exactly as it was entered, including spaces, capital letters and punctuation.",
        "Confirm whether the sender used password protection or no-password mode.",
        "Keep the file unchanged until the message has been recovered and checked.",
      ],
    },
    {
      id: "reveal-message-workflow",
      heading: "Reveal the message in your browser",
      steps: [
        "Open Hide message and select Reveal a message.",
        "Use Choose image to select the compatible downloaded PNG or JPEG.",
        "Wait for the local check. An unencrypted compatible message can be revealed automatically.",
        "Fill Password when the encrypted-message prompt appears.",
        "Choose Reveal message to decrypt a password-protected message.",
        "Check Message text before choosing Copy message or Download text file.",
        "Use Clear when you have finished with the file and message on the page.",
      ],
      callout:
        "The image and password are processed in this browser. The tool does not upload them to a decoding service.",
    },
    {
      id: "reveal-message-failure",
      heading: "Why can’t I reveal the hidden message?",
      bullets: [
        "The password is wrong — check spaces, capitalisation, punctuation and whether the sender changed the passphrase.",
        "The file was resized or recompressed — request the original attachment again.",
        "A screenshot was taken — a screenshot creates a different image and normally loses the embedded message.",
        "The file was cropped, rotated through an editor, filtered or re-saved — any of these changes can alter the data that carries the message.",
        "The visible image is only a preview — download the original file instead of saving the preview shown by a website or chat app.",
        "The image uses another steganography format — this tool does not decode arbitrary third-party schemes.",
        "No compatible message was embedded — an ordinary image will not reveal a message merely because it looks unusual.",
      ],
      callout:
        "Repeated password guesses cannot repair a file whose hidden data was destroyed by image processing.",
    },
    {
      id: "reveal-message-password",
      heading: "Check the password and the file independently",
      paragraphs: [
        "Wrong passwords and damaged authenticated content can produce the same unlock error; the tool cannot reliably distinguish those causes. An incompatible format may fail earlier. Check both the supplied password and whether the file survived its transfer, rather than treating an unlock error as proof that either one is definitely wrong.",
      ],
      bullets: [
        "Re-enter the password rather than copying it from a formatted document that may replace quotation marks or spaces.",
        "Ask the sender to test their own downloaded file with the same password.",
        "Ask the sender to compare the file they created with the file they transmitted.",
        "Do not expect the site to recover, reset or bypass a lost password.",
      ],
    },
    {
      id: "reveal-message-verify-transfer",
      heading: "Verify that the received file is unchanged",
      paragraphs: [
        "For an important transfer, compare the complete SHA-256 file fingerprint before and after sending. Media Inspector can calculate this fingerprint locally. Matching complete fingerprints provide very strong evidence that the compared file bytes are unchanged; they do not prove who created the image or whether its message is true.",
      ],
      steps: [
        "The sender inspects the downloaded steganography image in Media Inspector and copies its file fingerprint.",
        "The recipient downloads the received attachment and inspects that file.",
        "Compare the complete fingerprints character for character.",
        "If they differ, obtain the original through a method that preserves the file.",
        "If they match, return to Reveal and check the password or compatibility instead.",
      ],
      links: [
        {
          label: "Compare the file fingerprint in Media Inspector",
          to: routes.mediaInspector,
        },
      ],
    },
    {
      id: "reveal-example",
      heading: "Worked example: reopening the downloaded PNG",
      paragraphs: [
        "We downloaded the rose PNG created in the hiding guide, switched to Reveal a message and selected the saved file with Choose image. Entering the original demonstration password and choosing Reveal message recovered “Meet by the rose garden at 10:30.” exactly. The figure is the real Message text panel, captured after that round trip.",
        "This confirms that the locally downloaded example could be decoded. It does not test an email or messaging service. After sending your own image, repeat the procedure on the recipient’s downloaded copy. Ask the sender for an untouched file if that copy fails, and compare full fingerprints when the cause is unclear.",
      ],
      figures: [{ src: "/guides/reveal-hidden-message-from-image/revealed.webp", alt: "Real reveal result showing Meet by the rose garden at 10:30 in the Message text field", caption: "Recovered from the actual downloaded password-protected PNG, using the original password.", width: 638, height: 506 }],
    },
    {
      id: "reveal-message-after-recovery",
      heading: "Before you rely on this",
      paragraphs: [
        "Revealing text does not establish that it is trustworthy, safe or authored by the person who supplied the image. Treat links, commands, credentials and instructions with the same caution as content received through any other channel.",
        "Copying the result can place it in operating-system clipboard history or synchronisation. Clear removes it from the current page but cannot erase copied text, downloads, screenshots or other copies.",
      ],
    },
  ],
  faqs: [
    {
      question: "Can this tool reveal a hidden message from any image?",
      answer:
        "No. It reads supported LTSG PNG v1 and JPEG v2 messages created by this tool or compatible software. Other steganography methods require their own decoder.",
    },
    {
      question: "Why does the image look correct but reveal still fails?",
      answer:
        "Small changes that are hard to see can still destroy embedded data. Resizing, recompression, screenshots and editing can leave the picture looking normal while changing the bytes required for reveal.",
    },
    {
      question: "Can I reveal a password-protected message without the password?",
      answer:
        "No recovery or bypass is provided. The sender must supply the exact password.",
    },
    {
      question: "Does a matching SHA-256 fingerprint prove the sender is genuine?",
      answer:
        "No. A match provides very strong evidence that the compared file bytes are unchanged. Identity and trust require separate evidence.",
    },
  ],
} satisfies GuideContent;
