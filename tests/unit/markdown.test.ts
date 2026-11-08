import { describe, expect, it } from "vitest";
import { markdownFromOcr } from "../../src/features/ocr/markdown";
import type { OcrContentMode, OcrLine } from "../../src/features/ocr/types";

function line(text: string, y: number, x = 20, width = 220, paragraphIndex = 0): OcrLine {
  return { text, bbox: { x0: x, y0: y, x1: x + width, y1: y + 20 },
    confidence: 90, blockIndex: 0, paragraphIndex, lineIndex: y };
}
const documentLines = [line("Project notes", 0), line("The first paragraph wraps", 50),
  line("onto a second line.", 76), line("NEXT STEPS", 120), line("Check the source.", 150)];
const screenshotLines = [line("STATUS", 0), line("The upload is ready", 30),
  line("to review.", 56), line("Saved just now.", 110, 20, 220, 1)];
const columnLines = [line("Left column starts", 0), line("and continues here.", 26),
  line("Another left paragraph.", 90, 20, 220, 1),
  line("Right column starts", 0, 300), line("and finishes here.", 26, 300)];
const fixtures: { mode: OcrContentMode; raw?: string; lines: OcrLine[]; expected: string }[] = [
  { mode: "document", lines: documentLines,
    expected: "## Project notes\n\nThe first paragraph wraps onto a second line.\n\n## NEXT STEPS\n\nCheck the source." },
  { mode: "screenshot", lines: screenshotLines,
    expected: "## STATUS\n\nThe upload is ready to review.\n\nSaved just now." },
  { mode: "columns", lines: columnLines,
    expected: "Left column starts and continues here.\n\nAnother left paragraph.\n\n---\n\nRight column starts and finishes here." },
  { mode: "code", lines: [], raw: "  if (ready) {\r\n    run();  \r\n  }\r\n",
    expected: "```\n  if (ready) {\n    run();  \n  }\n```" },
  { mode: "sparse", lines: [line("LABEL", 0), line("Value", 90)], raw: "LABEL\n\nValue",
    expected: "LABEL\n\nValue" },
  { mode: "single-line", lines: [line("REFERENCE 7429", 0)], expected: "REFERENCE 7429" },
];

describe("Markdown OCR output", () => {
  it.each(fixtures)("formats the exact $mode fixture", ({ mode, raw, lines, expected }) => {
    expect(markdownFromOcr(raw ?? lines.map(item => item.text).join("\n"), mode, lines)).toBe(expected);
  });

  it("requires geometry for headings and keeps all text when lines are absent or incomplete", () => {
    const raw = "TITLE\n\nA paragraph\nwith its last line.";
    for (const lines of [[], [line("TITLE", 0)], [line(raw, 0, 20, NaN)]]) {
      expect(markdownFromOcr(raw, "document", lines)).toBe("TITLE\n\nA paragraph with its last line.");
    }
  });

  it("leaves short continuous prose, final sentences, numbers and long capitals as paragraphs", () => {
    const lines = [line("A short line", 0), line("keeps going.", 26),
      line("A sentence.", 90), line("12345", 150),
      line("ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE", 180)];
    expect(markdownFromOcr(lines.map(item => item.text).join("\n"), "document", lines))
      .toBe("A short line keeps going.\n\nA sentence.\n\n12345 ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE");
  });

  it("escapes recognised Markdown punctuation rather than inventing links, lists, tables or HTML", () => {
    const raw = "# literal\n\n- item\n\n1. item\n\n<script> *word* [link](url) a_b | cell &copy;\n\n---\n\n===";
    expect(markdownFromOcr(raw, "document"))
      .toBe("\\# literal\n\n\\- item\n\n1\\. item\n\n\\<script\\> \\*word\\* \\[link\\](url) a\\_b \\| cell &amp;copy;\n\n\\---\n\n\\===");
  });

  it("uses a fence longer than any recognised backtick run and retains blank lines", () => {
    expect(markdownFromOcr("```md\n# heading\n```\n\nnext", "code"))
      .toBe("````\n```md\n# heading\n```\n\nnext\n````");
    expect(markdownFromOcr(" \n", "code")).toBe("");
  });

  it("keeps a spanning title once and before two column sections", () => {
    const lines = [line("Page title", -60, 20, 500), ...columnLines];
    expect(markdownFromOcr(lines.map(item => item.text).join("\n"), "columns", lines))
      .toBe(`Page title\n\n${fixtures[2].expected}`);
  });

  it("follows engine reading order for right-to-left and three-column pages", () => {
    const lines = [line("Right first", 0, 580), line("right second.", 26, 580),
      line("Middle first", 0, 300), line("middle second.", 26, 300),
      line("Left first", 0), line("left second.", 26)];
    expect(markdownFromOcr(lines.map(item => item.text).join("\n"), "columns", lines))
      .toBe("Right first right second.\n\n---\n\nMiddle first middle second.\n\n---\n\nLeft first left second.");
  });

  it("does not infer columns from vertically stacked blocks, indents or interleaved table rows", () => {
    const cases = [
      [line("First block.", 0), line("Still first.", 26), line("Second block.", 100, 300), line("Still second.", 126, 300)],
      [line("First line.", 0), line("Next line.", 26), line("Indented line.", 0, 40), line("More text.", 26, 40)],
      [line("Item", 0), line("Price", 0, 300), line("Apple", 26), line("Two", 26, 300)],
    ];
    for (const lines of cases) {
      const result = markdownFromOcr(lines.map(item => item.text).join("\n"), "columns", lines);
      expect(result).not.toContain("---");
      expect(result).not.toContain("##");
      for (const item of lines) expect(result).toContain(item.text);
    }
  });

  it("preserves non-Latin line boundaries without inserting spaces or dehyphenating", () => {
    const lines = [line("ภาษาไทย", 0), line("ภาษาไทย", 26)];
    expect(markdownFromOcr("ภาษาไทย\nภาษาไทย", "document", lines, ["tha"]))
      .toBe("ภาษาไทย\nภาษาไทย");
  });

  it("does not turn a native-tile seam or fragmented block into a paragraph", () => {
    const lines = [line("The same paragraph", 0),
      { ...line("continues across tiles.", 26), blockIndex: 1_000_000 }];
    expect(markdownFromOcr("The same paragraph\ncontinues across tiles.", "document", lines))
      .toBe("The same paragraph continues across tiles.");
  });
});
