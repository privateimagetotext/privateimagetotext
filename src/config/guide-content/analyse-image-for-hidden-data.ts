import type { GuideContent } from "../guides";

export const analyseImageForHiddenDataGuideContent = {
  slug: "analyse-image-for-hidden-data",
  introduction:
    "Most beginner and intermediate image steganography challenges use one of three tricks: a message drawn into a single bit plane, data packed into the least significant bits of pixels, or a second file appended after the end of the image. You can check all three in a few minutes, in your browser, without uploading the image anywhere.",
  sections: [
    {
      id: "analyse-image-what-to-expect",
      heading: "What analysis can and cannot show",
      paragraphs: [
        "Steganography analysis looks for patterns. A bit plane that shows text, a QR code or a sharp-edged block where the rest of the plane is noise is a strong clue. LSB extraction turns the selected bits into bytes so you can read any text or file signature they contain. A trailing-byte check finds data that image viewers simply ignore.",
        "None of these checks can prove an image is clean. Data can be encrypted, scattered with a key, hidden in JPEG coefficients or embedded by tools such as steghide that need a password. Equally, noise in a low plane is normal for photos and is not evidence of anything.",
      ],
    },
    {
      id: "analyse-image-workflow",
      heading: "Run the three checks",
      steps: [
        "Open Steganography analysis and choose the image. The tool reads PNG data itself; JPEG, WebP, BMP and GIF are decoded by the browser.",
        "Read File facts first: the detected type, whether the extension matches, the PNG chunk list or JPEG markers, and any CRC mismatches or structure problems.",
        "In Bit planes, focus the image and press the right arrow to step through every view. Pay most attention to red, green and blue planes 0 and 1, and to the alpha planes if the image has transparency.",
        "In Extract bits, start with Red, Green and Blue, bit 0, rows, MSB-first, then choose Extract bits. Read the printable strings and the hex view.",
        "If nothing readable appears, change one setting at a time: a single channel, LSB-first packing, column order, or bits 0 and 1 together.",
        "In File bytes, check Data after the end of the image. If trailing bytes start with a ZIP, PNG or PDF signature, download them and open the result with a suitable tool.",
        "Choose Clear when you have finished. It stops the background worker and removes the file and results from the page.",
      ],
      callout:
        "The file is read on your device. Bit planes, extraction and byte scans run in a background worker in this browser; nothing is sent to the site.",
      figures: [
        {
          src: "/guides/analyse-image-for-hidden-data/bit-plane.webp",
          alt: "Steganography analysis tool showing the red plane 0 view of a test image, with view controls and a download button.",
          caption: "Red plane 0 of a synthetic puzzle image. Text written into the red least significant bits is invisible in the normal view but clear in this plane.",
          width: 1200,
          height: 800,
        },
      ],
    },
    {
      id: "analyse-image-bit-planes",
      heading: "Reading bit planes",
      paragraphs: [
        "Each 8-bit channel value has eight bits. Plane 7 is the most significant bit and looks like a high-contrast version of the image. Plane 0 is the least significant bit and, in an untouched photo, usually looks like fine noise. A plane is shown in white where the bit is 1 and black where it is 0.",
        "Look for structure that does not belong: horizontal stripes in the first rows (sequential LSB data), a rectangle of different texture, text or a QR code. Colour inversion and the single-channel views help when a message was drawn with a colour close to the background. For PNG files, the view with transparency removed reveals colour stored under fully transparent pixels. Other formats pass through the browser decoder, which alters or discards that colour.",
      ],
    },
    {
      id: "analyse-image-lsb-settings",
      heading: "Choosing LSB extraction settings",
      table: {
        caption: "What each extraction setting changes",
        headers: ["Setting", "Common choice", "When to try the alternative"],
        rows: [
          ["Channels", "Red, Green and Blue", "Try one channel at a time when the plane view shows data in only one."],
          ["Channel order", "R, G, B, A", "Try B, G, R, A when RGB output is unreadable; some tools write blue first."],
          ["Bits", "Bit 0", "Add bit 1 when planes 0 and 1 both show stripes."],
          ["Pixel order", "Rows", "Try Columns when vertical stripes appear in the planes."],
          ["Bit packing", "MSB-first", "Try LSB-first when the output looks random but the planes show structure."],
        ],
      },
      paragraphs: [
        "Selected channels are read in the chosen channel order, and multiple bits are read from the highest selected bit to the lowest. A final partial byte is dropped.",
        "If you know zsteg, its common result b1,rgb,lsb,xy is the same as Red, Green and Blue, bit 0, rows and MSB-first. Its yx order is Columns, xY is Rows from the bottom (the usual order for BMP files), b1,bgr and b1,abgr are the B, G, R and A, B, G, R channel orders, and its msb bit order is LSB-first packing here. For 16-bit PNGs, zsteg reads the low byte of each sample, so choose Low byte under Bit planes.",
      ],
    },
    {
      id: "analyse-image-trailing-bytes",
      heading: "Finding data after the end of the image",
      paragraphs: [
        "A PNG ends with an IEND chunk and a JPEG with an EOI marker. Viewers stop reading there, so anything appended afterwards stays invisible. The tool walks the file structure to find the real end, skipping embedded JPEG thumbnails, and reports the offset, length and any recognised signature of the extra bytes.",
        "Some cameras and editors add trailing data for legitimate reasons, so treat a result as a lead rather than a verdict. The embedded-signature list can also show files packed earlier in the image, but short signatures sometimes match by chance inside compressed data.",
      ],
    },
    {
      id: "analyse-image-limits",
      heading: "Before you rely on this",
      bullets: [
        "Images are limited to 4,096 × 4,096 pixels and files to 50 MiB.",
        "8-bit PNG samples are read exactly as stored. For 16-bit PNGs you view and extract either the high or the low byte of each sample, palette PNGs show palette colours rather than index bits, and only the first frame of animated images is analysed.",
        "Browser-decoded formats can differ slightly between browsers, and JPEG compression usually destroys pixel LSB data.",
        "Messages made with this site's Hide message tool use a header, a scattered bit order and optional encryption. Use Reveal a message to read them.",
        "Only analyse files you are allowed to examine.",
      ],
    },
  ],
  faqs: [
    {
      question: "Is this the same as Stegsolve?",
      answer:
        "It covers the same core views as Stegsolve's bit-plane browser plus LSB extraction and trailing-byte checks, but it runs in a web browser and is not affiliated with Stegsolve.",
    },
    {
      question: "Does the tool upload my image?",
      answer:
        "No. The file is read on your device and analysed in a background worker in this browser. After one online visit, the tool also works offline.",
    },
  ],
} satisfies GuideContent;
