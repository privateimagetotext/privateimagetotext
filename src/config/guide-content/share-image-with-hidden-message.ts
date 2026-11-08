import type { GuideContent } from "../guides";
import { routes } from "../routes";

export const shareImageWithHiddenMessageGuideContent = {
  slug: "share-image-with-hidden-message",
  introduction: "You will create a new image containing your text, download it and send that exact file. PNG is the recommended output; JPEG is an advanced option for supported JPEG sources. Password protection encrypts the message, while No password only hides it. Neither format is designed to survive photo editing or recompression. The recipient needs the downloaded file, this tool and, if used, the password.",
  sections: [
  {
    id: "prepare-image", heading: "Prepare the image",
    paragraphs: [
      "Choose a photo with plenty of fully opaque pixels. PNG mode uses those pixels to carry the message; transparent areas do not add usable capacity. The Message size indicator reports available bytes after the image has been checked. A long message, emojis or password protection can use more space than expected. Shorten the text or choose a larger supported picture if it will not fit.",
      "Keep the original until the exchange is finished. A screenshot captures the displayed picture, not its embedded data. Scaling, colour handling and re-encoding can change values that look identical to your eye. Send the saved output itself, never a screenshot or a copied chat preview.",
    ],
  },
  {
    id: "create-file", heading: "Create and test the file",
    steps: [
      "Open Hide message, select Hide a message, then Choose image and select your cover picture.",
      "Under Output format, keep PNG — recommended. JPEG — advanced appears only for a supported JPEG source.",
      "Enter the text in Message and check Message size. Keep Password protected — recommended and complete Password and Confirm password, or deliberately select No password.",
      "Choose Create PNG with hidden message, or Create JPEG with hidden message for JPEG output. Wait for Download your hidden-message image.",
      "Choose Download PNG or Download JPEG. Switch to Reveal a message and choose the downloaded file. For password protection, enter the password and choose Reveal message; an unprotected message appears automatically. Compare the recovered text.",
    ],
    paragraphs: ["In this real-tool example, the rose photograph carried “Meet by the rose garden at 10:30.” in a password-protected PNG. The downloaded file was reopened and the sentence recovered exactly. The two previews look identical at normal viewing size; that appearance alone would not establish a successful transfer."],
    figureLayout: "pair",
    figures: [
      { src: "/guides/share-image-with-hidden-message/cover.webp", alt: "Original red rose photograph in the tool’s cover image preview before embedding", caption: "Before: the cover photograph, from the libjpeg-turbo test fixture.", width: 522, height: 344 },
      { src: "/guides/share-image-with-hidden-message/generated.webp", alt: "The same red rose in the tool’s generated PNG preview after embedding the encrypted message", caption: "After: the generated file looks identical. These WebP illustrations are previews, not files to reveal.", width: 576, height: 380 },
    ],
  },
  {
    id: "send-without-breaking", heading: "Send it without breaking it",
    paragraphs: ["Treat this table as transfer guidance, not a list of tested app versions. “Should” assumes the recipient downloads the unchanged original. Photo quality labels, including HD, do not promise byte identity. If a path re-encodes the image, it will not provide a reliable transfer for either format; JPEG v2 has no recompression recovery."],
    table: {
      caption: "Sharing routes and expected message survival; platform transfers have not been tested here.",
      headers: ["Channel", "What happens to the image", "Will the message survive?"],
      rows: [
        ["Email attachment", "An attached file can be downloaded; photo insertion may offer resizing.", "Should, as an unchanged attachment. Decline size reduction."],
        ["WhatsApp document", "Document sending is separate from ordinary photo sharing.", "Should if the original file is retained; verify the download."],
        ["WhatsApp photo", "WhatsApp says shared media is usually compressed.", "Do not rely on it, including HD. A re-encoded copy is unsafe."],
        ["Telegram file", "A without-compression sending option is available.", "Should through that file path; compare the received copy."],
        ["Telegram photo", "Photo delivery is distinct from without-compression file sending.", "Untested; use file mode instead."],
        ["Signal", "Encrypted messaging does not itself promise unchanged image data.", "Untested. Transfer a ZIP containing the file and verify after extraction."],
        ["iMessage", "The originating Photos share flow can change the image format.", "Untested; use a file link or archive and verify."],
        ["Slack", "Uploaded files have a download action separate from previews.", "Should when downloading the original file; never save a preview."],
        ["Google Drive / Dropbox link", "Share the stored file and use its download action.", "Should for the unchanged original; do not export a preview."],
        ["Instagram / Facebook / X post", "Displayed posts are not an exact-file delivery guarantee.", "No reliable survival. Re-encoded or resized versions will not preserve a dependable message."],
        ["AirDrop", "Files can be transferred; Photos also offers conversion options.", "Should from the saved file. Check the received bytes."],
        ["USB", "A normal file copy preserves contents.", "Should; compare fingerprints if the transfer matters."],
      ],
    },
    links: [
      { label: "WhatsApp media and document help", to: "https://faq.whatsapp.com/453914586839706/" },
      { label: "Telegram without-compression option", to: "https://translations.telegram.org/en/android_x/private_chats/SendMediaHint" },
      { label: "Apple Photos sharing options", to: "https://support.apple.com/en-hk/guide/iphone/iphf28f17237/ios" },
      { label: "Slack file downloads", to: "https://slack.com/help/articles/201330736-Add-files-to-Slack" },
    ],
  },
  {
    id: "recipient-reveal", heading: "Tell the recipient how to reveal it",
    paragraphs: [
      "Ask the recipient to download the attachment, open Hide message and select Reveal a message. Share the password separately when practical, preserving spaces and capital letters. Keep it out of filenames and captions. The reveal guide explains password errors and unsupported images.",
      "For an exact-copy check, both people can select their file in Media Inspector and compare the complete SHA-256 file fingerprint. Matching values strongly establish identical bytes; different values mean something changed. Then reveal the received image. A matching fingerprint does not authenticate the sender or make the message trustworthy.",
    ],
    links: [{ label: "Reveal a hidden message from an image", to: routes.guide.revealHiddenMessage }, { label: "Compare file fingerprints", to: routes.mediaInspector }],
  },
  {
    id: "before-you-rely", heading: "Before you rely on this",
    bullets: [
      "Hiding a message does not guarantee that expert analysis cannot detect it.",
      "Password protection encrypts the text. No-password mode does not; compatible software can read it.",
      "Resizing, cropping, editing, screenshots and JPEG recompression can destroy the message. Preserve the exact output for reliable reveal.",
      "Lost passwords cannot be recovered. Test before sending and keep an untouched copy until the recipient succeeds.",
      "Generated images discard most source metadata. JPEG output keeps orientation where required; neither output preserves the original provenance record.",
    ],
  },
  ],
} satisfies GuideContent;
