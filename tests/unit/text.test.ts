import { describe, expect, it } from "vitest";

import {
  cleanOcrText,
  cleanOcrTextWithLayout,
  dehyphenateLineBreaks,
  joinWrappedParagraphLines,
  normaliseLineEndings,
  resultCounts,
  structuredTextForCleaning,
} from "../../src/features/ocr/text";
import type { OcrContentMode, OcrLine } from "../../src/features/ocr/types";

function line(
  text: string,
  y0: number,
  y1: number,
  paragraphIndex: number,
  x0 = 20,
): OcrLine {
  return {
    text,
    confidence: 90,
    bbox: { x0, y0, x1: x0 + 300, y1 },
    blockIndex: paragraphIndex,
    paragraphIndex,
    lineIndex: 0,
  };
}

describe("OCR text cleanup", () => {
  it("normalises Windows and classic Mac line endings", () => {
    expect(normaliseLineEndings("one\r\ntwo\rthree\nfour")).toBe(
      "one\ntwo\nthree\nfour",
    );
  });

  it("dehyphenates a lowercase word split across a line", () => {
    expect(
      dehyphenateLineBreaks(
        "para-\ngraph\nUPPER-\nCase\nversion2-\ncompatible",
      ),
    ).toBe("paragraph\nUPPER-\nCase\nversion2-\ncompatible");
  });

  it("joins wrapped prose within paragraphs while preserving list lines", () => {
    const source = [
      "This sentence wraps",
      "onto a second line.",
      "",
      "- first item",
      "- second item",
      "",
      "A final",
      "paragraph.",
    ].join("\n");

    expect(joinWrappedParagraphLines(source)).toBe(
      [
        "This sentence wraps onto a second line.",
        "",
        "- first item\n- second item",
        "",
        "A final paragraph.",
      ].join("\n"),
    );
  });

  it.each<OcrContentMode>([
    "document",
    "columns",
    "screenshot",
    "sparse",
    "single-line",
  ])("applies paragraph-aware prose cleanup in %s mode", (mode) => {
    expect(
      cleanOcrText(
        "  A wrapped-\r\nline with trailing space.  \r\n\r\nNext block.  ",
        mode,
      ),
    ).toBe("A wrappedline with trailing space.\n\nNext block.");
  });

  it("preserves code indentation, spacing, and line structure", () => {
    const source =
      "  const value  = 1;  \r\n\treturn  value;\t\r\n\r\n\r\n\r\nnext();  ";

    expect(cleanOcrText(source, "code")).toBe(
      "const value  = 1;\n\treturn  value;\n\n\nnext();",
    );
  });

  it("repairs visually continuous paragraph fragments for the Tidied view", () => {
    const lines = [
      line("Subtotal $12.00", 10, 30, 0),
      line("Tax $1.20", 38, 58, 1),
      line("Payment CARD", 66, 86, 2),
    ];

    expect(structuredTextForCleaning(lines)).toBe(
      "Subtotal $12.00\nTax $1.20\nPayment CARD",
    );
    expect(cleanOcrTextWithLayout("ignored raw layout", "document", lines)).toBe(
      "Subtotal $12.00 Tax $1.20 Payment CARD",
    );
  });

  it("preserves a materially separated true paragraph", () => {
    const lines = [
      line("First paragraph wraps", 10, 30, 0),
      line("onto another line.", 38, 58, 0),
      line("Second paragraph.", 92, 112, 1),
    ];

    expect(structuredTextForCleaning(lines)).toBe(
      "First paragraph wraps\nonto another line.\n\nSecond paragraph.",
    );
    expect(cleanOcrTextWithLayout("ignored", "document", lines)).toBe(
      "First paragraph wraps onto another line.\n\nSecond paragraph.",
    );
  });

  it("does not use structured prose cleanup for code", () => {
    expect(
      cleanOcrTextWithLayout(
        "  let x = 1;\n    x += 1;",
        "code",
        [line("different", 0, 20, 0)],
      ),
    ).toBe("let x = 1;\n    x += 1;");
  });
});

describe("result counts", () => {
  it("counts characters exactly and words across whitespace", () => {
    expect(resultCounts(" two\twords\n")).toEqual({
      characters: 11,
      words: 2,
    });
  });

  it("reports no words for whitespace-only text", () => {
    expect(resultCounts(" \n\t")).toEqual({
      characters: 3,
      words: 0,
    });
  });
});
