import { sanitiseSourceBase } from "../raster/filenames";
import { PdfError } from "./errors";
import type {
  PdfDocumentResult,
  PdfPageResult,
  PdfPageStatus,
} from "./types";
import { PDF_LIMITS } from "./validation";

export type PdfTextOutput = {
  readonly combinedText: string;
  readonly characterCount: number;
  readonly wordCount: number;
  readonly filename: string;
};

const NON_COMPLETED_STATUS: Readonly<Record<PdfPageStatus, string>> = {
  pending: "not processed",
  "checking-text": "not processed",
  rendering: "not processed",
  preparing: "not processed",
  "loading-ocr": "not processed",
  recognising: "not processed",
  complete: "complete",
  failed: "failed",
  skipped: "skipped",
  "not-processed": "not processed",
};

function safePageLabel(label: string | undefined) {
  if (!label) return null;
  const cleaned = [...label.normalize("NFC")]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return !(
        code <= 0x1f ||
        (code >= 0x7f && code <= 0x9f) ||
        /\p{Bidi_Control}/u.test(character)
      );
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return [...cleaned].slice(0, 64).join("") || null;
}

function pageMarker(pageNumber: number, page: PdfPageResult | undefined) {
  const label = safePageLabel(page?.pageLabel);
  const labelPart = label ? ` (label: ${label})` : "";
  const status = page?.status ?? "not-processed";
  const outputStatus =
    status === "complete" && page && page.edited.length === 0
      ? "empty"
      : NON_COMPLETED_STATUS[status];
  const statusPart = outputStatus === "complete" ? "" : ` — ${outputStatus}`;
  return `--- Page ${pageNumber}${labelPart}${statusPart} ---`;
}

function pageText(page: PdfPageResult | undefined) {
  return page?.status === "complete" ? page.edited : "";
}

export function safePdfTextFilename(sourceName: string) {
  const base = sanitiseSourceBase(sourceName);
  return base
    ? `${base}-pdf-text.txt`
    : "private-image-to-text-pdf-text.txt";
}

export function buildPdfTextOutput(
  result: PdfDocumentResult,
  sourceName: string,
): PdfTextOutput {
  const pagesByNumber = new Map(
    result.pages.map((page) => [page.pageNumber, page] as const),
  );
  const selectedPages = [...new Set(result.selectedPages)].sort(
    (left, right) => left - right,
  );
  let totalPageCharacters = 0;
  const sections: string[] = [];

  for (const pageNumber of selectedPages) {
    const page = pagesByNumber.get(pageNumber);
    const text = pageText(page);
    if (text.length > PDF_LIMITS.maxPageTextCharacters) {
      throw new PdfError("PDF_PAGE_TEXT_LIMIT_EXCEEDED", { pageNumber });
    }
    if (totalPageCharacters > PDF_LIMITS.maxTotalTextCharacters - text.length) {
      throw new PdfError("PDF_TOTAL_TEXT_LIMIT_EXCEEDED");
    }
    totalPageCharacters += text.length;
    sections.push(text ? `${pageMarker(pageNumber, page)}\n${text}` : pageMarker(pageNumber, page));
  }

  const combinedText = sections.join("\n\n");
  const trimmed = combinedText.trim();
  return {
    combinedText,
    characterCount: combinedText.length,
    wordCount: trimmed ? trimmed.split(/\s+/u).length : 0,
    filename: safePdfTextFilename(sourceName),
  };
}
