import { describe, expect, it } from "vitest";
import { batchAdmissionError, combinedBatchText, separateBatchTextZip, type OcrBatchItem } from "../../src/features/ocr/batch";
import { initialOcrState, type OcrResult } from "../../src/features/ocr/types";
import { locateReviewWord } from "../../src/features/ocr/review";

const item = (id: number, name: string, text?: string): OcrBatchItem => ({ id, name, size: 10,
  state: { ...initialOcrState, result: text === undefined ? null : { raw: "unchanged raw", edited: text } as OcrResult } });

describe("bounded local image batches", () => {
  it("rejects count and combined byte overruns before reading images", () => {
    expect(batchAdmissionError(Array.from({ length: 10 }, () => ({ size: 1 })), [{ size: 1 }])).toMatch(/10 images/);
    expect(batchAdmissionError([{ size: 99 * 1024 * 1024 }], [{ size: 2 * 1024 * 1024 }])).toMatch(/100 MiB/);
    expect(batchAdmissionError([], [{ size: 100 * 1024 * 1024 }])).toBeNull();
  });
  it("exports edited text in queue order and excludes unprocessed images", () => {
    const result = combinedBatchText([item(2, "second.png", "corrected second"), item(1, "first.png", "corrected first"), item(3, "pending.png")]);
    expect(result).toBe("--- second.png ---\n\ncorrected second\n\n--- first.png ---\n\ncorrected first");
  });
  it("writes independent UTF-8 ZIP entries with safe unique names and valid CRC", async () => {
    const zip = separateBatchTextZip([item(1, "../same.png", "123456789"), item(2, "../same.png", "Café €"), item(3, "pending.png")]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(0xcbf43926); // independent standard CRC test vector
    const nameLength = view.getUint16(26, true);
    const decoder = new TextDecoder();
    const name = decoder.decode(bytes.slice(30, 30 + nameLength));
    expect(name).toMatch(/^01-/);
    expect(name).not.toMatch(/[\\/]/);
    expect(decoder.decode(bytes.slice(30 + nameLength, 30 + nameLength + 9))).toBe("123456789");
    const end = new DataView(bytes.buffer, bytes.length - 22);
    expect(end.getUint32(0, true)).toBe(0x06054b50);
    expect(end.getUint16(10, true)).toBe(2);
    const centralOffset = end.getUint32(16, true);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
    expect(decoder.decode(bytes)).toContain("02-");
    expect(decoder.decode(bytes)).toContain("Café €");
  });
});

describe("source-linked word corrections", () => {
  it("finds unambiguous words without replacing substrings", () => {
    expect(locateReviewWord([{ text: "cat" }], 0, "a cat catalog")).toEqual({ start: 2, end: 5 });
    expect(locateReviewWord([{ text: "cat" }], 0, "catalog")).toBeNull();
  });
  it("uses immediate context for repeated words and refuses ambiguous matches", () => {
    const words = ["first", "cat", "then", "second", "cat", "end"].map((text) => ({ text }));
    expect(locateReviewWord(words, 4, "first cat then second cat end")).toEqual({ start: 22, end: 25 });
    expect(locateReviewWord([{ text: "cat" }], 0, "cat cat")).toBeNull();
    expect(locateReviewWord(words, 4, "first cat then second dog end")).toBeNull();
  });
  it("refuses a unique word moved away from its source neighbors by manual edits", () => {
    const words = [{ text: "alpha" }, { text: "beta" }];
    expect(locateReviewWord(words, 0, "alpha beta")).toEqual({ start: 0, end: 5 });
    expect(locateReviewWord(words, 0, "gamma alpha")).toBeNull();
    expect(locateReviewWord(words, 1, "beta gamma")).toBeNull();
    expect(locateReviewWord(words, 0, "corrected beta", "corrected")).toEqual({ start: 0, end: 9 });
  });
  it("does not accept a neighboring word as a prefix or suffix of another word", () => {
    const words = ["first", "cat", "end"].map((text) => ({ text }));
    expect(locateReviewWord(words, 1, "notfirst cat end")).toBeNull();
    expect(locateReviewWord(words, 1, "first cat ending")).toBeNull();
    expect(locateReviewWord(words, 1, "first\ncat\nend")).toEqual({ start: 6, end: 9 });
  });
  it("keeps Unicode letters at token and context boundaries", () => {
    expect(locateReviewWord([{ text: "cat" }], 0, "𐐀cat")).toBeNull();
    expect(locateReviewWord([{ text: "cat" }, { text: "end" }], 0, "cat end𐐀")).toBeNull();
  });
});
