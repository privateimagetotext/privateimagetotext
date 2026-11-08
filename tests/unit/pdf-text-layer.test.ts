import { describe, expect, it } from "vitest";

import { PdfError } from "../../src/features/pdf/errors";
import {
  assessPdfTextLayer,
  cleanEmbeddedPdfText,
  PDF_TEXT_LAYER_THRESHOLDS,
  reconstructPdfText,
  type PdfTextReconstruction,
} from "../../src/features/pdf/text-layer";
import type {
  PdfTextItem,
  PdfTextLayerClassification,
  PdfTextLayerReasonCode,
} from "../../src/features/pdf/types";

function item(
  str: string,
  options: Partial<Omit<PdfTextItem, "str">> = {},
): PdfTextItem {
  return { str, ...options };
}

function positioned(
  str: string,
  x: number,
  y: number,
  width: number,
  options: Partial<Omit<PdfTextItem, "str" | "transform" | "width">> = {},
): PdfTextItem {
  return item(str, {
    dir: "ltr",
    transform: [10, 0, 0, 10, x, y],
    width,
    height: 10,
    ...options,
  });
}

function classify(
  items: readonly PdfTextItem[],
  extractionFailed = false,
) {
  const reconstruction = reconstructPdfText(items);
  return assessPdfTextLayer(items, reconstruction, extractionFailed);
}

function expectClassification(
  items: readonly PdfTextItem[],
  classification: PdfTextLayerClassification,
  reasonCodes: readonly PdfTextLayerReasonCode[],
) {
  const result = classify(items);
  expect(result.classification).toBe(classification);
  expect(result.reasonCodes).toEqual(reasonCodes);
  return result;
}

describe("reconstructPdfText", () => {
  it("keeps ordinary text and uses source order", () => {
    const result = reconstructPdfText([item("Ordinary selectable text.")]);
    expect(result.text).toBe("Ordinary selectable text.");
    expect(result.lineCount).toBe(1);
    expect(result.insertedSpaceCount).toBe(0);
  });

  it("separates one item per word from its same-line geometry", () => {
    const result = reconstructPdfText([
      positioned("Hello", 0, 100, 25),
      positioned("world", 30, 100, 25),
    ]);
    expect(result.text).toBe("Hello world");
    expect(result.insertedSpaceCount).toBe(1);
  });

  it("does not add spaces between adjacent one-glyph fragments", () => {
    const result = reconstructPdfText(
      [..."Hello"].map((glyph, index) =>
        positioned(glyph, index * 5, 100, 5),
      ),
    );
    expect(result.text).toBe("Hello");
  });

  it("preserves explicit whitespace without duplicating it", () => {
    const result = reconstructPdfText([
      positioned("Hello ", 0, 100, 28),
      positioned("world", 32, 100, 25),
      item("\tkept"),
    ]);
    expect(result.text).toBe("Hello world\tkept");
  });

  it("infers a missing word space when geometry is unavailable", () => {
    expect(reconstructPdfText([item("one"), item("word")]).text).toBe(
      "one word",
    );
  });

  it("treats hasEOL as the strongest line-ending signal", () => {
    const result = reconstructPdfText([
      positioned("First", 0, 100, 25, { hasEOL: true }),
      positioned("Second", 27, 100, 30),
    ]);
    expect(result.text).toBe("First\nSecond");
    expect(result.explicitLineBreakCount).toBe(1);
    expect(result.geometryLineBreakCount).toBe(0);
  });

  it("uses a conservative line break when baselines materially change", () => {
    const result = reconstructPdfText([
      positioned("First line", 0, 100, 40),
      positioned("Second line", 0, 80, 50),
    ]);
    expect(result.text).toBe("First line\nSecond line");
    expect(result.geometryLineBreakCount).toBe(1);
  });

  it("ignores empty and marked-content items", () => {
    const markedContent = { type: "beginMarkedContent", id: "safe-test" };
    const items = [
      item(""),
      markedContent as unknown as PdfTextItem,
      item("Visible"),
    ];
    const result = reconstructPdfText(items);
    expect(result.text).toBe("Visible");
    expect(result.malformedItemCount).toBe(0);
  });

  it("preserves Unicode and combining sequences byte-for-byte", () => {
    const value = "Caf\u0065\u0301 \u4e16\u754c \ud83d\ude80";
    expect(reconstructPdfText([item(value)]).text).toBe(value);
  });

  it("preserves right-to-left strings and fragment source order", () => {
    const result = reconstructPdfText([
      positioned("\u05e9\u05dc\u05d5\u05dd", 100, 100, 20, { dir: "rtl" }),
      positioned("\u05e2\u05d5\u05dc\u05dd", 70, 100, 25, { dir: "rtl" }),
    ]);
    expect(result.text).toBe("\u05e9\u05dc\u05d5\u05dd \u05e2\u05d5\u05dc\u05dd");
  });

  it("preserves vertical text in source order", () => {
    const result = reconstructPdfText([
      item("\u7e26", { dir: "ttb" }),
      item("\u66f8", { dir: "ttb" }),
      item("\u304d", { dir: "ttb" }),
    ]);
    expect(result.text).toBe("\u7e26\u66f8\u304d");
    expect(classify([
      item("\u7e26", { dir: "ttb" }),
      item("\u66f8", { dir: "ttb" }),
      item("\u304d", { dir: "ttb" }),
    ])).toMatchObject({
      classification: "uncertain",
      reasonCodes: ["vertical-text"],
    });
  });

  it("retains replacement characters for explicit assessment", () => {
    const result = reconstructPdfText([item("A\ufffd\ufffd")]);
    expect(result.text).toBe("A\ufffd\ufffd");
    expect(result.replacementCharacterCount).toBe(2);
  });

  it("removes NUL, C0, DEL and C1 controls but preserves tabs and lines", () => {
    const result = reconstructPdfText([
      item("A\u0000B\tC\u0001\r\nD\u007f\u0085"),
    ]);
    expect(result.text).toBe("AB\tC\nD");
    expect(result.unsafeControlCount).toBe(4);
    expect(result.lineCount).toBe(2);
  });

  it("enforces the character limit during construction without truncation", () => {
    let error: unknown;
    try {
      reconstructPdfText([item("Hello")], 4);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PdfError);
    expect(error).toMatchObject({ code: "PDF_PAGE_TEXT_LIMIT_EXCEEDED" });
    expect(reconstructPdfText([item("A"), item("B")], 2).text).toBe("AB");
    expect(() => reconstructPdfText([item("A"), item("B")], 1)).toThrow(
      PdfError,
    );
  });

  it("never interprets extracted HTML or Markdown", () => {
    const value = "<script>alert('local')</script> **literal**";
    const result = reconstructPdfText([item(value)]);
    expect(result.text).toBe(value);
    expect(cleanEmbeddedPdfText(result.text)).toBe(value);
  });
});

describe("cleanEmbeddedPdfText", () => {
  it("performs only conservative PDF-specific normalisation", () => {
    const value = "  code-\r\nnext  \t\rline\u0000\n\n\n\n\nlast  ";
    expect(cleanEmbeddedPdfText(value)).toBe(
      "code-\nnext\nline\n\n\nlast",
    );
  });
});

describe("assessPdfTextLayer", () => {
  it("classifies a normal selectable page as usable", () => {
    const result = expectClassification(
      [item("This is a normal selectable paragraph with enough useful text.")],
      "usable",
      ["normal-text"],
    );
    expect(result.metrics).toMatchObject({
      itemCount: 1,
      textItemCount: 1,
      malformedItemCount: 0,
      reconstructedLineCount: 1,
      ambiguousDirection: false,
      verticalLayout: false,
    });
    expect(result).not.toHaveProperty("text");
  });

  it("accepts valid short text", () => {
    expectClassification(
      [item("Approved.")],
      "usable",
      ["valid-short-text"],
    );
  });

  it("marks page-number-only content uncertain", () => {
    expectClassification(
      [item("Page 7")],
      "uncertain",
      ["page-number-only"],
    );
  });

  it("marks a sparse digital header uncertain", () => {
    expectClassification(
      [item("QUARTERLY REPORT")],
      "uncertain",
      ["sparse-header-or-footer"],
    );
  });

  it("marks a scan with only a sparse digital footer uncertain", () => {
    expectClassification(
      [item("Scanned by Archive Service")],
      "uncertain",
      ["sparse-header-or-footer"],
    );
  });

  it("distinguishes an absent layer from whitespace-only items", () => {
    expectClassification([], "empty", ["empty-text-layer"]);
    expectClassification(
      [item(" \t\n ")],
      "empty",
      ["no-meaningful-text"],
    );
  });

  it("invalidates a replacement-character-heavy layer", () => {
    const result = expectClassification(
      [item("A\ufffd\ufffd")],
      "invalid",
      ["high-replacement-character-ratio"],
    );
    expect(result.metrics.replacementCharacterCount).toBe(2);
    expect(result.metrics.replacementCharacterRatio).toBeCloseTo(2 / 3);
  });

  it("invalidates a control-heavy layer after safely removing controls", () => {
    const items = [item("A\u0000\u0001B")];
    const reconstruction = reconstructPdfText(items);
    expect(reconstruction.text).toBe("AB");
    const result = assessPdfTextLayer(items, reconstruction);
    expect(result.classification).toBe("invalid");
    expect(result.reasonCodes).toEqual(["high-unsafe-control-ratio"]);
    expect(result.metrics.unsafeControlRatio).toBe(0.5);
  });

  it("invalidates suspiciously repeated garbage fragments", () => {
    const items = Array.from({ length: 8 }, () => item("xy"));
    const result = expectClassification(
      items,
      "invalid",
      ["suspicious-repetition"],
    );
    expect(result.metrics.repeatedFragmentCount).toBe(8);
    expect(result.metrics.repeatedFragmentRatio).toBe(1);
  });

  it("accepts short Unicode text without treating uncased scripts as headers", () => {
    expectClassification(
      [item("\u4f60\u597d\u4e16\u754c")],
      "usable",
      ["valid-short-text"],
    );
  });

  it.each([
    "ДОБРО ПОЖАЛОВАТЬ",
    "WELCOME 日本",
    "ΔΟΚΙΜΗ ΚΕΙΜΕΝΟΥ",
  ])("does not infer an English OCR fallback from the case of %s", (text) => {
    expectClassification([item(text)], "usable", ["valid-short-text"]);
  });

  it.each(["Footer 日本", "© ПРИМЕР", "https://example.org/日本"])(
    "retains explicit sparse-footer evidence in mixed-script text: %s",
    (text) => {
      expectClassification([item(text)], "uncertain", ["sparse-header-or-footer"]);
    },
  );

  it.each([
    { text: "Д\ufffd\ufffd", reason: "high-replacement-character-ratio" },
    { text: "日\u0000\u0001本", reason: "high-unsafe-control-ratio" },
  ] as const)("retains Unicode corruption checks: $reason", ({ text, reason }) => {
    expectClassification([item(text)], "invalid", [reason]);
  });

  function leaderLine(dotCount = 8) {
    return [
      positioned("Subtotal amount due", 0, 100, 70),
      ...Array.from({ length: dotCount }, (_, index) =>
        positioned(".", 80 + index * 6, 100, 2),
      ),
      positioned("128", 82 + dotCount * 6, 100, 15),
    ];
  }

  it("does not count positioned inline leaders as repeated or fragmented text", () => {
    const items = leaderLine(24).flatMap((fragment) => [fragment, item(" ")]);
    const result = expectClassification(items, "usable", ["normal-text"]);
    expect(result.metrics.repeatedFragmentCount).toBe(0);
    expect(result.metrics.repeatedFragmentRatio).toBe(0);
    expect(result.metrics.singleGlyphItemCount).toBe(0);
    expect(result.metrics.singleGlyphItemRatio).toBe(0);
    expect(result.metrics.textItemCount).toBe(52);
    expect(reconstructPdfText(items).text).toBe(
      `Subtotal amount due ${". ".repeat(24)}128 `,
    );
  });

  it("recognises grouped leader glyphs without removing them from output", () => {
    const items = leaderLine().map((fragment, index) =>
      index > 0 && index < 9 ? { ...fragment, str: "··", width: 4 } : fragment,
    );
    expectClassification(items, "usable", ["normal-text"]);
    expect(reconstructPdfText(items).text).toContain(`${"·· ".repeat(7)}··`);
  });

  it.each([
    { name: "missing leading label", change: (items: PdfTextItem[]) => items.slice(1) },
    { name: "missing trailing value", change: (items: PdfTextItem[]) => items.slice(0, -1) },
    { name: "punctuation-only neighbors", change: (items: PdfTextItem[]) => items.map((fragment, index) => index === 0 || index === 9 ? { ...fragment, str: "$" } : fragment) },
    { name: "missing geometry", change: (items: PdfTextItem[]) => items.map((fragment) => item(fragment.str)) },
    { name: "a trailing value on another line", change: (items: PdfTextItem[]) => [...items.slice(0, -1), positioned("128", 130, 80, 15)] },
    { name: "a distant trailing column", change: (items: PdfTextItem[]) => [...items.slice(0, -1), positioned("128", 500, 100, 15)] },
    { name: "a distant leading column", change: (items: PdfTextItem[]) => [positioned("Subtotal amount due", -500, 100, 70), ...items.slice(1)] },
    { name: "dots on different baselines", change: (items: PdfTextItem[]) => items.map((fragment, index) => index > 0 && index < 9 ? positioned(".", 80 + index * 6, 100 - index * 15, 2) : fragment) },
    { name: "dots across separate columns", change: (items: PdfTextItem[]) => items.map((fragment, index) => index >= 5 ? { ...fragment, transform: [10, 0, 0, 10, (fragment.transform?.[4] ?? 0) + 300, 100] } : fragment) },
    { name: "an explicit line break", change: (items: PdfTextItem[]) => [...items.slice(0, 5), item("", { hasEOL: true }), ...items.slice(5)] },
  ])("retains repetition evidence with $name", ({ change }) => {
    const result = expectClassification(change(leaderLine()), "invalid", ["suspicious-repetition"]);
    expect(result.metrics.repeatedFragmentCount).toBe(8);
  });

  it("does not use valid leaders to excuse repeated words elsewhere", () => {
    const result = expectClassification([
      ...leaderLine(),
      ...Array.from({ length: 8 }, () => item("garbled")),
    ], "invalid", ["suspicious-repetition"]);
    expect(result.metrics.repeatedFragmentCount).toBe(8);
    expect(result.metrics.repeatedFragmentRatio).toBe(0.8);
  });

  it.each([".", "··", "ПРИМЕР", "日本"])(
    "retains suspicious repetition without any surrounding content: %s",
    (text) => {
      expectClassification(
        Array.from({ length: 8 }, (_, index) => positioned(text, index * 10, 100, 5)),
        "invalid",
        ["suspicious-repetition"],
      );
    },
  );

  it("accepts right-to-left text without reversing it", () => {
    const items = [item("\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645", { dir: "rtl" })];
    const result = expectClassification(
      items,
      "usable",
      ["right-to-left-text"],
    );
    expect(reconstructPdfText(items).text).toBe("\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645");
    expect(result.metrics.rightToLeftItemCount).toBe(1);
  });

  it("marks vertical and ambiguous directions uncertain", () => {
    expectClassification(
      [item("Vertical", { dir: "ttb" })],
      "uncertain",
      ["vertical-text"],
    );
    expectClassification(
      [item("Direction", { dir: "sideways" })],
      "uncertain",
      ["ambiguous-direction"],
    );
  });

  it("invalidates malformed extraction items with content-free metrics", () => {
    const malformed = { str: null } as unknown as PdfTextItem;
    const items = [malformed, item("Otherwise valid")];
    const reconstruction = reconstructPdfText(items);
    expect(reconstruction.text).toBe("Otherwise valid");
    const result = assessPdfTextLayer(items, reconstruction);
    expect(result.classification).toBe("invalid");
    expect(result.reasonCodes).toEqual(["malformed-text-items"]);
    expect(result.metrics.malformedItemCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("Otherwise valid");
  });

  it("retains safe string content while rejecting malformed geometry", () => {
    const malformedGeometry = {
      str: "Recoverable",
      transform: [10, 0, 0, 10, Number.NaN, 100],
    } as PdfTextItem;
    const reconstruction = reconstructPdfText([malformedGeometry]);
    expect(reconstruction.text).toBe("Recoverable");
    expect(assessPdfTextLayer([malformedGeometry], reconstruction)).toMatchObject({
      classification: "invalid",
      reasonCodes: ["malformed-text-items"],
    });
  });

  it("marks an extraction failure invalid with its exact reason", () => {
    const empty: PdfTextReconstruction = reconstructPdfText([]);
    const result = assessPdfTextLayer([], empty, true);
    expect(result.classification).toBe("invalid");
    expect(result.reasonCodes).toEqual(["text-extraction-failed"]);
  });

  it("invalidates a layer with very little meaningful content", () => {
    expectClassification(
      [item("\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00")],
      "invalid",
      ["low-meaningful-character-ratio"],
    );
  });

  it("marks unusually fragmented glyph extraction uncertain", () => {
    const glyphs = "abcdefghijklmnopqrst";
    const items = [...glyphs].map((glyph, index) =>
      positioned(glyph, index * 5, 100, 5),
    );
    const result = expectClassification(
      items,
      "uncertain",
      ["high-fragmentation"],
    );
    expect(result.metrics.singleGlyphItemRatio).toBe(1);
    expect(result.metrics.textItemCount).toBe(
      PDF_TEXT_LAYER_THRESHOLDS.fragmentedItemUncertainMinimum,
    );
  });
});
