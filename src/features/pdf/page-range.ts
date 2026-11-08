import { PdfError } from "./errors";
import { PDF_LIMITS } from "./validation";

export type PdfPageSelection =
  | { readonly kind: "all" }
  | { readonly kind: "range"; readonly value: string };

function assertBounds(pageCount: number, maxSelectedPages: number) {
  if (
    !Number.isSafeInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > PDF_LIMITS.maxDocumentPages ||
    !Number.isSafeInteger(maxSelectedPages) ||
    maxSelectedPages < 1
  ) {
    throw new PdfError("PDF_PAGE_RANGE_INVALID");
  }
}

function addPage(
  pages: Set<number>,
  pageNumber: number,
  maxSelectedPages: number,
) {
  pages.add(pageNumber);
  if (pages.size > maxSelectedPages) {
    throw new PdfError("PDF_SELECTED_PAGE_LIMIT_EXCEEDED");
  }
}

export function parsePdfPageRange(
  input: string,
  pageCount: number,
  maxSelectedPages: number = PDF_LIMITS.maxSelectedPages,
): readonly number[] {
  assertBounds(pageCount, maxSelectedPages);
  if (
    input.length === 0 ||
    input.length > PDF_LIMITS.maxPageRangeInputCharacters
  ) {
    throw new PdfError("PDF_PAGE_RANGE_INVALID");
  }

  const compact = input.replaceAll(" ", "");
  if (
    compact.length === 0 ||
    !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(compact)
  ) {
    throw new PdfError("PDF_PAGE_RANGE_INVALID");
  }

  const pages = new Set<number>();
  for (const segment of compact.split(",")) {
    const [startText, endText = startText] = segment.split("-");
    const start = Number(startText);
    const end = Number(endText);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start ||
      end > pageCount
    ) {
      throw new PdfError("PDF_PAGE_RANGE_INVALID");
    }
    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
      addPage(pages, pageNumber, maxSelectedPages);
    }
  }

  if (pages.size === 0) throw new PdfError("PDF_PAGE_RANGE_INVALID");
  return [...pages].sort((left, right) => left - right);
}

export function selectAllPdfPages(
  pageCount: number,
  maxSelectedPages: number = PDF_LIMITS.maxSelectedPages,
): readonly number[] {
  assertBounds(pageCount, maxSelectedPages);
  if (pageCount > maxSelectedPages) {
    throw new PdfError("PDF_SELECTED_PAGE_LIMIT_EXCEEDED");
  }
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}

export function resolvePdfPageSelection(
  selection: PdfPageSelection,
  pageCount: number,
  maxSelectedPages: number = PDF_LIMITS.maxSelectedPages,
) {
  return selection.kind === "all"
    ? selectAllPdfPages(pageCount, maxSelectedPages)
    : parsePdfPageRange(selection.value, pageCount, maxSelectedPages);
}
