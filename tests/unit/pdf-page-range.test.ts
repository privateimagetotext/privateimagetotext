import { describe, expect, it } from "vitest";

import { PdfError } from "../../src/features/pdf/errors";
import {
  parsePdfPageRange,
  resolvePdfPageSelection,
  selectAllPdfPages,
} from "../../src/features/pdf/page-range";
import { PDF_LIMITS } from "../../src/features/pdf/validation";

function expectCode(operation: () => unknown, code: string) {
  expect(operation).toThrowError(PdfError);
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code, message: expect.any(String) });
  }
}

describe("PDF page-range parser", () => {
  it.each([
    ["1", [1]],
    ["1-5", [1, 2, 3, 4, 5]],
    ["1-5,8,11-14", [1, 2, 3, 4, 5, 8, 11, 12, 13, 14]],
    [" 1 - 3 , 8 , 11 - 12 ", [1, 2, 3, 8, 11, 12]],
  ])("parses %s in ascending document order", (input, expected) => {
    expect(parsePdfPageRange(input, 20)).toEqual(expected);
  });

  it("deduplicates repeated and overlapping ranges", () => {
    expect(parsePdfPageRange("5,1-3,2-5,1,5", 6)).toEqual([1, 2, 3, 4, 5]);
  });

  it("accepts the first and final document pages", () => {
    expect(parsePdfPageRange("1,100", 100)).toEqual([1, 100]);
  });

  it.each([
    "",
    "   ",
    ",",
    "1,",
    ",1",
    "1,,2",
    "1;2",
    "1 2",
    "1-",
    "-1",
    "1--2",
    "1-2-3",
    "all",
    "1\t-2",
    "1\n,2",
  ])("rejects malformed input %j", (input) => {
    expectCode(() => parsePdfPageRange(input, 10), "PDF_PAGE_RANGE_INVALID");
  });

  it.each([
    ["0", 10],
    ["0-1", 10],
    ["-2", 10],
    ["7-3", 10],
    ["11", 10],
    ["1-11", 10],
    ["999999999999999999999", 10],
  ])("rejects unsafe or out-of-document selection %s", (input, pageCount) => {
    expectCode(
      () => parsePdfPageRange(input, pageCount),
      "PDF_PAGE_RANGE_INVALID",
    );
  });

  it("accepts the selected-page limit and rejects one unique page beyond it", () => {
    expect(
      parsePdfPageRange(
        `1-${PDF_LIMITS.maxSelectedPages}`,
        PDF_LIMITS.maxSelectedPages + 1,
      ),
    ).toHaveLength(PDF_LIMITS.maxSelectedPages);
    expectCode(
      () =>
        parsePdfPageRange(
          `1-${PDF_LIMITS.maxSelectedPages + 1}`,
          PDF_LIMITS.maxSelectedPages + 1,
        ),
      "PDF_SELECTED_PAGE_LIMIT_EXCEEDED",
    );
  });

  it("bounds malicious-looking input before parsing or expansion", () => {
    const input = "1,".repeat(PDF_LIMITS.maxPageRangeInputCharacters);
    expectCode(
      () => parsePdfPageRange(input, 100),
      "PDF_PAGE_RANGE_INVALID",
    );
  });

  it.each([0, -1, 101, 1.5, Number.NaN])(
    "rejects invalid document page counts (%s)",
    (pageCount) => {
      expectCode(
        () => parsePdfPageRange("1", pageCount),
        "PDF_PAGE_RANGE_INVALID",
      );
    },
  );
});

describe("explicit all-pages selection", () => {
  it("selects all pages only through the explicit helper", () => {
    expect(selectAllPdfPages(4)).toEqual([1, 2, 3, 4]);
    expect(resolvePdfPageSelection({ kind: "all" }, 3)).toEqual([1, 2, 3]);
    expect(
      resolvePdfPageSelection({ kind: "range", value: "2-3" }, 4),
    ).toEqual([2, 3]);
  });

  it("enforces the same configured limit for all pages", () => {
    expectCode(
      () => selectAllPdfPages(PDF_LIMITS.maxSelectedPages + 1),
      "PDF_SELECTED_PAGE_LIMIT_EXCEEDED",
    );
  });
});
