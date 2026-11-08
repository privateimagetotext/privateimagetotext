import { describe, expect, it } from "vitest";

import {
  levenshteinDistance,
  matchCriticalTokens,
  normaliseForComparison,
  strictCharacterErrorRate,
  whitespaceNormalisedCharacterErrorRate,
  wordErrorRate,
} from "../../src/features/ocr/metrics";

describe("OCR accuracy metrics", () => {
  it("normalises Unicode to NFC and converts CRLF and CR line endings", () => {
    expect(normaliseForComparison("Cafe\u0301\r\nline two\rline three")).toBe(
      "Caf\u00e9\nline two\nline three",
    );
  });

  it("calculates Levenshtein distance for strings represented as code points", () => {
    expect(levenshteinDistance(Array.from("kitten"), Array.from("sitting"))).toBe(3);
    expect(levenshteinDistance(Array.from("A\ud83d\ude42B"), Array.from("A\ud83d\ude43B"))).toBe(1);
    expect(levenshteinDistance([], Array.from("abc"))).toBe(3);
  });

  it("calculates strict character error rate after only NFC and line-ending normalisation", () => {
    expect(strictCharacterErrorRate("cat\r\n", "cut\n")).toBeCloseTo(1 / 4);
    expect(strictCharacterErrorRate("", "")).toBe(0);
    expect(strictCharacterErrorRate("", "unexpected")).toBe(1);
  });

  it("calculates character error rate after collapsing whitespace", () => {
    expect(
      whitespaceNormalisedCharacterErrorRate(
        " alpha   beta\r\ngamma ",
        "alpha beta\t gamma",
      ),
    ).toBe(0);
    expect(whitespaceNormalisedCharacterErrorRate("alpha beta", "alpha zeta")).toBeGreaterThan(0);
  });

  it("calculates word error rate with exact, case-sensitive tokens", () => {
    expect(wordErrorRate("one two three", "one too three four")).toBeCloseTo(2 / 3);
    expect(wordErrorRate("OCR", "ocr")).toBe(1);
  });

  it("matches critical tokens exactly and respects duplicate counts", () => {
    expect(
      matchCriticalTokens(
        ["ERR-4097", "O0I1l", "ERR-4097", "$38.45"],
        "ERR-4097 O0I1l $38.45",
      ),
    ).toEqual({
      matched: 3,
      total: 4,
      rate: 0.75,
      missing: ["ERR-4097"],
    });
    expect(matchCriticalTokens([], "anything").rate).toBe(1);
  });

  it("matches exact punctuation-bearing strings inside surrounding syntax", () => {
    expect(
      matchCriticalTokens(
        ["ERR-4097", "worker.ts:42", "O/0", "err-4097"],
        "[ERR-4097] at worker.ts:42:9; compare O/0.",
      ),
    ).toEqual({
      matched: 3,
      total: 4,
      rate: 0.75,
      missing: ["err-4097"],
    });
  });
});
