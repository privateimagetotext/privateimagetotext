import type { GuideContent } from "../guides";

export const receiptToTextGuideContent = {
  slug: "receipt-to-text",
  introduction:
    "Receipts combine small print, narrow columns, abbreviations and numbers that are easy for OCR to confuse. A clear image and a careful review can turn the receipt into useful editable text, but the result should not be treated as an authoritative financial record.",
  sections: [
    {
      id: "receipt-photo",
      heading: "Start with a readable receipt image",
      paragraphs: [
        "Use the original photo or scan rather than a copy taken from a chat preview. Thermal paper, folds and glossy surfaces can make characters fade into the background, so the quality of the source matters.",
      ],
      bullets: [
        "Lay the receipt flat and photograph it straight-on.",
        "Include the merchant name, date, full item list, tax and total when those details matter.",
        "Use even light without covering the paper in glare.",
        "Move fingers and shadows away from prices and totals.",
        "Make sure small decimal points and currency symbols are visible when you zoom in.",
        "Retake the photo when the paper is blurred or badly curved; stronger contrast cannot recreate missing detail.",
      ],
    },
    {
      id: "receipt-workflow",
      heading: "Extract receipt text in your browser",
      steps: [
        "Open Extract text and use Choose image to select the receipt image. Recognition starts automatically after any large-image confirmation; wait for it to finish before adjusting settings.",
        "Use Rotate left or Rotate right so every line is upright.",
        "Choose Crop and Apply crop while keeping the merchant, required lines and totals.",
        "Set Content type to Document for a full receipt.",
        "Set Enhancement to Original, then compare Adaptive document if the print needs help.",
        "Choose Re-run OCR after changing settings and compare Original OCR and Tidied with the receipt image.",
        "Use Edit this version to correct important fields, then choose Copy text or Download .txt from Your edits.",
      ],
      callout:
        "Keep the original receipt image. OCR output is a convenience copy, not a replacement for the source record.",
    },
    {
      id: "receipt-fields",
      heading: "What to double-check before you rely on it",
      paragraphs: [
        "Review the information that affects reimbursement, accounting, warranty or personal records before spending time tidying the layout.",
      ],
      bullets: [
        "Merchant or business name.",
        "Transaction date and time.",
        "Receipt, invoice or transaction number.",
        "Item descriptions, quantities and unit prices.",
        "Discounts, refunds and negative amounts.",
        "Subtotal, GST, VAT or other tax amount.",
        "Final total and currency.",
        "Payment method and any displayed card digits.",
      ],
      callout:
        "Pay particular attention to zero and letter O, one and letter l, decimal points, commas, minus signs and currency symbols.",
    },
    {
      id: "receipt-layout",
      heading: "Expect to repair the layout",
      paragraphs: [
        "Receipt columns are designed for people, not for perfect plain-text extraction. Product names and prices may be separated, wrapped onto another line or read in an unexpected order.",
      ],
      bullets: [
        "Use a smaller crop for a difficult total or reference number.",
        "Use Single line when you only need one clear field.",
        "Try Columns when the receipt has clearly separated item and price columns, then check the reading order.",
        "Copy the reviewed text into your own notes or spreadsheet manually when you need structured records.",
        "Do not expect the current tool to create a table, CSV file or accounting entry automatically.",
      ],
    },
    {
      id: "receipt-common-problems",
      heading: "Handle faded, crumpled or unusual receipts",
      bullets: [
        "Faded thermal print — compare Original, Document and Adaptive document; use the version with the clearest character shapes.",
        "Dark receipt with light text — try Inverted.",
        "Long receipt — recognise the full image first, then use smaller crops for sections that need correction.",
        "Logos or barcodes recognised as text — crop them out when they are not needed.",
        "Handwritten tips or notes — transcribe and verify them manually because handwriting recognition is unreliable.",
        "Foreign-language receipt — select a supported language before recognition; unsupported languages may produce poor or misleading output.",
      ],
    },
    {
      id: "receipt-example",
      heading: "Worked example: a synthetic shop receipt",
      paragraphs: [
        "We selected a synthetic NORTH STAR MARKET receipt and ran Extract text with Document content and Original enhancement. The real result retained receipt number 000742 and TOTAL $38.45. It joined the Notebook, Desk lamp and Cable rows in Tidied, so the recognised text did not preserve the original item table.",
        "The source prices were $12.50, $21.00 and $4.95; adding them gives $38.45. That cross-check supports this simple example, but real receipts may include discounts, tax or rounding that need separate review. Do not invent a missing date or tax amount. Check the printed source and mark a field unavailable when it is not shown.",
      ],
      figures: [{ src: "/guides/receipt-to-text/recognised-text.webp", alt: "Real OCR result for a synthetic NORTH STAR MARKET receipt with total 38.45 and joined item rows", caption: "The amounts were retained in this run, but the item rows still need manual review and layout repair.", width: 575, height: 461 }],
    },
    {
      id: "receipt-privacy",
      heading: "Before you rely on this",
      paragraphs: [
        "A receipt can contain a name, location, loyalty number, partial payment-card details or information about purchases. The site processes the image and recognised text in the current browser and does not upload them to an OCR service.",
        "The privacy boundary does not follow text after you copy or download it. Clipboard synchronisation, cloud notes, expense systems, email and shared folders can handle the result according to their own settings and policies. Remove details that the recipient does not need.",
      ],
    },
  ],
  faqs: [
    {
      question: "Can OCR read every line on a long receipt?",
      answer:
        "It can recognise long receipt images, but small print, folds and narrow columns may still require separate crops and manual correction.",
    },
    {
      question: "Can it export the receipt directly to CSV or Excel?",
      answer:
        "No. The current tool produces editable plain text. Review it first, then place the required fields into your own spreadsheet or expense system.",
    },
    {
      question: "Can it read a QR code or barcode?",
      answer:
        "No barcode or QR-code decoder is provided. The OCR may turn parts of a code into meaningless characters, so crop codes out unless nearby printed text is required.",
    },
    {
      question: "Is the extracted total reliable enough for accounting?",
      answer:
        "Treat it as a draft. Check the total, tax, currency, date and transaction number against the original receipt before using it for accounting or reimbursement.",
    },
  ],
} satisfies GuideContent;
