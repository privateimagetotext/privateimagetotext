import type { GuideContent } from "../guides";
import { routes } from "../routes";

export const hideMessageInImageGuideContent = {
  slug: "hide-message-in-image",
  // Affiliate registry ids; inert until a matching reviewed entry exists.
  pairedTools: ["proton-pass"],
  introduction:
    "Image steganography hides information inside a picture without visibly replacing what the picture shows. Private Image to Text can create a new PNG or JPEG containing a text message, with optional password encryption. The process runs in your browser, but the exact downloaded file and a sensible sharing method are essential.",
  sections: [
    {
      id: "hide-message-steganography-and-encryption",
      heading: "What is the difference between hiding and encrypting a message?",
      paragraphs: [
        "Steganography hides that a message exists. Encryption protects the contents of the message. They solve different problems, so password protection is recommended whenever the message should remain unreadable to someone who finds the file.",
      ],
      bullets: [
        "Password protected — the message is encrypted before it is placed in the image.",
        "No password — the message is hidden but not encrypted. Anyone with a compatible decoder can read it.",
        "Neither option guarantees that specialist analysis cannot detect signs of hidden data.",
        "Steganography is not a replacement for an appropriate encrypted communication service when the existence of the exchange is already known.",
      ],
    },
    {
      id: "hide-message-workflow",
      heading: "Create an image with a hidden message",
      steps: [
        "Open Hide message and select Hide a message.",
        "Use Choose image or Paste image for a PNG, JPEG, WebP or BMP source picture.",
        "Wait for Message size to show the available capacity.",
        "Under Output format, choose PNG — recommended, or JPEG — advanced when available for a supported JPEG source.",
        "Type text in Message and check Message size; UTF-8 bytes, not the visible character count, determine whether it fits.",
        "Keep Password protected — recommended and fill Password and Confirm password, or select No password only when unencrypted text is appropriate.",
        "Choose Create PNG with hidden message, then Download PNG; JPEG output uses Create JPEG with hidden message and Download JPEG.",
        "Switch to Reveal a message, use Choose image for the download and enter Password if requested. Choose Reveal message to test it.",
      ],
      callout:
        "Your source picture is not overwritten. Keep the new downloaded image and test that exact file.",
    },
    {
      id: "hide-message-png-or-jpeg",
      heading: "Choose between PNG and JPEG output",
      paragraphs: [
        "The two output formats use different compatible steganography formats. Neither remains reliable after arbitrary editing or recompression.",
      ],
      bullets: [
        "PNG is recommended and uses the LTSG v1 pixel format. A PNG can be created from a PNG, JPEG, WebP or BMP source.",
        "JPEG uses the LTSG v2 coefficient format and requires a supported JPEG source with a documented grayscale or YCbCr profile.",
        "Both formats require the exact downloaded file for reliable reveal.",
        "Resizing, cropping, rotating through an editor, taking a screenshot, applying filters or recompressing the image can destroy the message.",
      ],
      callout:
        "Choosing JPEG does not make the message safe from later JPEG recompression. Keep and share the exact file produced by the tool.",
      links: [
        {
          label: "Read the technical format documentation",
          to: routes.howItWorksTechnical,
        },
      ],
    },
    {
      id: "hide-message-password",
      heading: "Use a password you can exchange separately",
      paragraphs: [
        "The password must contain between 12 and 256 Unicode characters after normalisation. Spaces, capital letters and punctuation remain significant. The site does not store the password and provides no recovery, reset, bypass or back door if it is lost.",
      ],
      bullets: [
        "Use a long, unique password or passphrase that is difficult to guess.",
        "Check capital letters, spaces and punctuation before creating the image.",
        "Send the password through a different communication channel from the image when practical.",
        "Do not place the password in the same message, filename or caption as the image.",
        "Test the downloaded image with the password before deleting your working notes.",
      ],
    },
    {
      id: "hide-message-capacity",
      heading: "Let the tool calculate message capacity",
      paragraphs: [
        "The amount of UTF-8 text that fits depends on the selected picture, output format and encoding overhead. The page calculates the available space after the picture has been inspected locally.",
      ],
      bullets: [
        "Shorten the message when it exceeds the displayed capacity.",
        "Choose a larger suitable source picture when more space is required.",
        "Do not assume two pictures with the same file size have the same capacity.",
        "Avoid filling every available byte when you can communicate the same idea more clearly with less text.",
      ],
    },
    {
      id: "hide-message-before-sharing",
      heading: "Test before sharing and preserve the exact file",
      steps: [
        "Reveal the message from the downloaded image on the same device.",
        "Confirm the full message and password work exactly as expected.",
        "Send the image as a file, document or attachment through a service that preserves the original bytes.",
        "Ask the recipient to download the original file rather than use a preview or screenshot.",
        "Test the received copy again before relying on the channel.",
      ],
      callout:
        "Many messaging and social-media services alter images. Sending the picture in normal photo mode may silently remove the hidden message.",
    },
    {
      id: "hide-message-example",
      heading: "Worked example: a password-protected rose image",
      paragraphs: [
        "We chose the small rose photograph from the libjpeg-turbo test fixtures, kept PNG — recommended and entered “Meet by the rose garden at 10:30.” A demonstration passphrase protected this non-sensitive sentence. After Create PNG with hidden message completed, we used Download PNG and reopened that downloaded file under Reveal a message. The full sentence was recovered exactly.",
        "The figure shows the actual generated result. Its filename, dimensions and protection label describe the output, not the source JPEG. The WebP screenshot in this guide cannot itself be decoded. Use your own downloaded PNG when testing, and choose your own unique password rather than copying an example passphrase.",
      ],
      figures: [{ src: "/guides/hide-message-in-image/created.webp", alt: "Actual generated rose PNG result showing password protection and Download PNG", caption: "The real generated file was downloaded and successfully revealed. This guide figure is only an illustration.", width: 638, height: 804 }],
    },
    {
      id: "hide-message-privacy-and-metadata",
      heading: "Before you rely on this",
      paragraphs: [
        "The picture, message and password are processed in the current browser and are not uploaded by the tool. Normal hosting and aggregate Cloudflare Web Analytics requests can still occur, but they must not contain the selected picture, message or password.",
        "Source metadata is not preserved. PNG is newly browser-encoded. JPEG v2 discards source metadata and reconstructs only a minimal orientation tag when source orientation requires it. Do not assume the output retains camera details, dates, location data or Content Credentials from the source.",
        "Clear removes the selected picture, message and result from the page and stops the relevant background process. It cannot remove a downloaded file, clipboard content, operating-system temporary memory or copies already sent elsewhere.",
      ],
    },
  ],
} satisfies GuideContent;
