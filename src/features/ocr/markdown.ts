import { usesNonLatinScript } from "../../config/ocr-languages";
import { normaliseLineEndings } from "./text";
import type { OcrContentMode, OcrLine } from "./types";

// OCR punctuation is literal text, not evidence of Markdown lists, links or HTML.
function escapeText(text: string) {
  return text.replace(/&/g, "&amp;")
    .replace(/[\\`*_{}[\]<>!|~#]/g, "\\$&")
    .replace(/^(\s*)([-+=])(?=\s|$|[-+=])/gm, "$1\\$2")
    .replace(/^(\s*)(\d+)([.)])(?=\s|$)/gm, "$1$2\\$3");
}

function plainParagraphs(raw: string, preserveLines: boolean) {
  return normaliseLineEndings(raw).trim().split(/\n\s*\n/)
    .map((paragraph) => escapeText(paragraph.split("\n").map(line => line.trim())
      .join(preserveLines ? "\n" : " ")))
    .filter(Boolean).join("\n\n");
}

function height(line: OcrLine) {
  return line.bbox.y1 - line.bbox.y0;
}

function validLine(line: OcrLine) {
  const { x0, x1, y0, y1 } = line.bbox;
  return [x0, x1, y0, y1].every(Number.isFinite) && x1 > x0 && y1 > y0;
}

function blankGap(left: OcrLine, right: OcrLine) {
  return right.bbox.y0 - left.bbox.y1 >= Math.min(height(left), height(right));
}

function paragraphBreak(left: OcrLine, right: OcrLine) {
  const size = Math.min(height(left), height(right));
  if (blankGap(left, right) || right.bbox.y0 < left.bbox.y0 - size / 2 ||
      Math.abs(left.bbox.x0 - right.bbox.x0) > size * 1.5) return true;
  const gap = right.bbox.y0 - left.bbox.y1;
  const continuous = gap >= -size * 0.35 && gap <= size * 0.9 &&
    Math.max(height(left), height(right)) / size <= 1.5;
  // Fragmented blocks and native-tile seams are not paragraph evidence when
  // their owned lines remain visually continuous on the page.
  return !continuous && (left.blockIndex !== right.blockIndex || left.paragraphIndex !== right.paragraphIndex);
}

function prose(lines: readonly OcrLine[], headings: boolean, preserveLines: boolean) {
  const paragraphs: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) paragraphs.push(escapeText(paragraph.join(preserveLines ? "\n" : " ")));
    paragraph = [];
  };
  lines.forEach((line, index) => {
    const text = line.text.trim();
    const short = text.length <= 80 && text.split(/\s+/).length <= 8;
    const allCaps = text.split(/\s+/).length <= 8 &&
      text !== text.toLowerCase() && text === text.toUpperCase();
    // A short final sentence is not a heading merely because the next paragraph
    // is separated. Require isolation before it as well as a visible gap after.
    const isolatedShort = short && /\p{L}/u.test(text) && !/[.!?;。！？；]$/.test(text) &&
      (index === 0 || blankGap(lines[index - 1], line)) &&
      index + 1 < lines.length && blankGap(line, lines[index + 1]);
    if (headings && (allCaps || isolatedShort)) {
      flush();
      paragraphs.push(`## ${escapeText(text)}`);
    } else {
      if (index > 0 && paragraphBreak(lines[index - 1], line)) flush();
      paragraph.push(text);
    }
  });
  flush();
  return paragraphs.join("\n\n");
}

function bounds(lines: readonly OcrLine[]) {
  return lines.reduce((box, line) => ({
    x0: Math.min(box.x0, line.bbox.x0), y0: Math.min(box.y0, line.bbox.y0),
    x1: Math.max(box.x1, line.bbox.x1), y1: Math.max(box.y1, line.bbox.y1),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
}

function columnSections(lines: readonly OcrLine[]) {
  const groups: OcrLine[][] = [[]];
  // Keep the engine's reading order, including right-to-left layouts. A column
  // transition must move back up the page AND across a visible gutter.
  lines.forEach((line, index) => {
    const previous = lines[index - 1];
    if (previous) {
      const gutter = Math.max(line.bbox.x0 - previous.bbox.x1, previous.bbox.x0 - line.bbox.x1);
      const size = Math.min(height(previous), height(line));
      if (line.bbox.y0 < previous.bbox.y0 - size / 2 && gutter >= size) groups.push([]);
    }
    groups[groups.length - 1].push(line);
  });
  if (groups.length < 2) return null;

  // A spanning title can precede the first column. Keep it once, ahead of the
  // column sections, but never remove an intervening or trailing spanning line.
  const preamble: OcrLine[] = [];
  const otherBounds = groups.slice(1).map(bounds);
  while (groups[0].length > 2) {
    const first = groups[0][0];
    if (!otherBounds.some(box => first.bbox.x0 < box.x1 && first.bbox.x1 > box.x0) ||
        !otherBounds.every(box => first.bbox.y1 <= box.y0) ||
        first.bbox.y1 > groups[0][1].bbox.y0) break;
    preamble.push(groups[0].shift()!);
  }

  if (groups.some(group => group.length < 2)) return null;
  const boxes = groups.map(bounds);
  const direction = Math.sign(boxes[1].x0 - boxes[0].x0);
  for (let index = 1; index < boxes.length; index += 1) {
    const left = boxes[index - 1];
    const right = boxes[index];
    const size = Math.min(height(groups[index - 1][0]), height(groups[index][0]));
    const gutter = Math.max(right.x0 - left.x1, left.x0 - right.x1);
    const overlap = Math.min(left.y1, right.y1) - Math.max(left.y0, right.y0);
    if (gutter < size || overlap < size || Math.sign(right.x0 - left.x0) !== direction) return null;
  }
  return { preamble, groups };
}

/** Formats the existing recognition response only; never recognises or renders HTML. */
export function markdownFromOcr(
  raw: string,
  mode: OcrContentMode,
  lines: readonly OcrLine[] = [],
  languages?: readonly string[],
) {
  if (!raw.trim()) return "";
  if (mode === "code") {
    // A longer fence keeps recognised backticks inside the code block. Preserve
    // indentation, blank lines and trailing spaces rather than using Tidied.
    const code = normaliseLineEndings(raw);
    let length = 3;
    for (const match of code.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
    const fence = "`".repeat(length);
    return `${fence}\n${code}${code.endsWith("\n") ? "" : "\n"}${fence}`;
  }
  const preserveLines = usesNonLatinScript(languages);
  const usable = lines.filter(line => line.text.trim());
  // Partial/invalid geometry must never discard recognised text. Ignore only
  // whitespace when checking that the adapter's lines cover this exact result.
  const compact = (text: string) => text.replace(/\s+/g, "");
  if (!usable.length || !usable.every(validLine) ||
      compact(usable.map(line => line.text).join("")) !== compact(raw) ||
      mode === "sparse" || mode === "single-line") {
    return plainParagraphs(raw, preserveLines);
  }
  if (mode === "columns") {
    const columns = columnSections(usable);
    if (columns) {
      const sections = columns.groups.map(group => prose(group, false, preserveLines)).join("\n\n---\n\n");
      return columns.preamble.length
        ? `${prose(columns.preamble, false, preserveLines)}\n\n${sections}` : sections;
    }
  }
  return prose(usable, mode === "document" || mode === "screenshot", preserveLines);
}
