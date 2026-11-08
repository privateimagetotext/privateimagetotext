import { usesNonLatinScript } from "../../config/ocr-languages";
import type { OcrContentMode, OcrLine } from "./types";

export function normaliseLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

export function dehyphenateLineBreaks(value: string) {
  return value.replace(/([A-Za-z])-\n([a-z])/g, "$1$2");
}

function looksLikeListItem(value: string) {
  return /^(?:[-*•]|\d+[.)])\s+/.test(value);
}

export function joinWrappedParagraphLines(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => {
      const lines = paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (
        lines.length <= 1 ||
        lines.some(looksLikeListItem) ||
        lines.some((line) => /^\s{2,}/.test(line))
      ) {
        return lines.join("\n");
      }

      return lines.join(" ");
    })
    .filter(Boolean)
    .join("\n\n");
}

export function cleanOcrText(value: string, mode: OcrContentMode) {
  const normalised = normaliseLineEndings(value);

  if (mode === "code") {
    return normalised.replace(/[ \t]+$/gm, "").replace(/\n{4,}/g, "\n\n\n").trim();
  }

  const tidied = normalised
    .replace(/[ \t]+$/gm, "")
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return joinWrappedParagraphLines(dehyphenateLineBreaks(tidied));
}

function median(values: readonly number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function lineHeight(line: OcrLine) {
  return Math.max(1, line.bbox.y1 - line.bbox.y0);
}

function sameHierarchy(left: OcrLine, right: OcrLine) {
  return (
    left.blockIndex === right.blockIndex &&
    left.paragraphIndex === right.paragraphIndex
  );
}

/**
 * Rebuilds only the input to the Tidied view from structured line geometry.
 * Original OCR remains byte-for-byte the engine response. A paragraph boundary
 * is suppressed only when adjacent lines have ordinary spacing, compatible
 * height and compatible left alignment; materially separated paragraphs stay
 * separated. This repairs threshold/deskew layout fragmentation without
 * matching fixture text or globally deleting blank lines.
 */
export function structuredTextForCleaning(lines: readonly OcrLine[]) {
  const usable = lines.filter((line) => line.text.trim().length > 0);
  if (usable.length === 0) return "";

  const adjacent = usable.slice(1).map((line, index) => ({
    left: usable[index],
    right: line,
    gap: line.bbox.y0 - usable[index].bbox.y1,
  }));
  const sameParagraphGaps = adjacent
    .filter(({ left, right }) => sameHierarchy(left, right))
    .map(({ gap }) => gap)
    .filter((gap) => Number.isFinite(gap) && gap >= 0);
  const ordinaryGaps =
    sameParagraphGaps.length > 0
      ? sameParagraphGaps
      : adjacent
          .map(({ gap }) => gap)
          .filter((gap) => Number.isFinite(gap) && gap >= 0);
  const medianGap = median(ordinaryGaps);
  let result = usable[0].text.replace(/\r?\n+$/g, "");

  for (let index = 1; index < usable.length; index += 1) {
    const previous = usable[index - 1];
    const current = usable[index];
    const gap = current.bbox.y0 - previous.bbox.y1;
    const smallerHeight = Math.min(lineHeight(previous), lineHeight(current));
    const largerHeight = Math.max(lineHeight(previous), lineHeight(current));
    const compatibleHeight = largerHeight / smallerHeight <= 1.5;
    const compatibleAlignment =
      Math.abs(current.bbox.x0 - previous.bbox.x0) <=
      Math.max(smallerHeight * 1.5, 8);
    const ordinarySpacing =
      gap <= Math.max(medianGap * 1.5 + 1, smallerHeight * 0.9);
    const visuallyContinuous =
      gap >= -smallerHeight * 0.35 &&
      ordinarySpacing &&
      compatibleHeight &&
      compatibleAlignment;
    const separator =
      sameHierarchy(previous, current) || visuallyContinuous ? "\n" : "\n\n";
    result += separator + current.text.replace(/\r?\n+$/g, "");
  }

  return result;
}

export function cleanOcrTextWithLayout(
  raw: string,
  mode: OcrContentMode,
  lines?: readonly OcrLine[],
  languages?: readonly string[],
) {
  // Avoid Latin prose joining/dehyphenation and code cleanup for non-Latin scripts.
  // In particular, Thai spaces are not word separators.
  if (usesNonLatinScript(languages)) return raw;
  if (mode === "code" || !lines || lines.length === 0) {
    return cleanOcrText(raw, mode);
  }
  return cleanOcrText(structuredTextForCleaning(lines), mode);
}

export function resultCounts(value: string) {
  const trimmed = value.trim();
  return {
    characters: value.length,
    words: trimmed ? trimmed.split(/\s+/).length : 0,
  };
}
