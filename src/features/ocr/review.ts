import type { RecognitionWordGeometry } from "./types";

export const UNCERTAIN_WORD_CONFIDENCE = 80;

function hasTokenBoundaries(text: string, position: number, token: string) {
  // Keep whole Unicode code points at either boundary, including surrogate pairs.
  const before = text.slice(Math.max(0, position - 2), position);
  const after = text.slice(position + token.length, position + token.length + 2);
  return (!/^[\p{L}\p{N}_]/u.test(token) || !/[\p{L}\p{N}_]$/u.test(before)) &&
    (!/[\p{L}\p{N}_]$/u.test(token) || !/^[\p{L}\p{N}_]/u.test(after));
}

/** Changed context or ambiguous words require a manual edit instead of a guessed replacement. */
export function locateReviewWord(
  words: readonly Pick<RecognitionWordGeometry, "text">[],
  index: number,
  editedText: string,
  replacement?: string,
): { start: number; end: number } | null {
  const token = replacement ?? words[index]?.text;
  if (!token) return null;
  const candidates: number[] = [];
  let start = 0;
  while (start <= editedText.length - token.length) {
    const found = editedText.indexOf(token, start);
    if (found < 0) break;
    if (hasTokenBoundaries(editedText, found, token)) {
      candidates.push(found);
    }
    start = found + Math.max(1, token.length);
  }
  const previous = words[index - 1]?.text;
  const next = words[index + 1]?.text;
  const contextual = candidates.filter((position) => {
    const before = editedText.slice(0, position).trimEnd();
    const after = editedText.slice(position + token.length).trimStart();
    return (previous === undefined || (before.endsWith(previous) &&
      hasTokenBoundaries(before, before.length - previous.length, previous))) &&
      (next === undefined || (after.startsWith(next) && hasTokenBoundaries(after, 0, next)));
  });
  return contextual.length === 1
    ? { start: contextual[0], end: contextual[0] + token.length }
    : null;
}
