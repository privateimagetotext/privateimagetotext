import { PdfError } from "./errors";
import type {
  PdfTextItem,
  PdfTextLayerAssessment,
  PdfTextLayerMetrics,
  PdfTextLayerReasonCode,
} from "./types";
import { PDF_LIMITS } from "./validation";

/**
 * Provisional, deliberately conservative classifier thresholds. They are
 * exported so the Phase 1B report and later real-document calibration can name
 * the exact policy rather than duplicating unexplained numbers in a runner.
 */
export const PDF_TEXT_LAYER_THRESHOLDS = {
  replacementCharacterInvalidMinimum: 2,
  replacementCharacterInvalidRatio: 0.2,
  unsafeControlInvalidMinimum: 2,
  unsafeControlInvalidRatio: 0.1,
  meaningfulCharacterInvalidMinimumNonWhitespace: 8,
  meaningfulCharacterInvalidRatio: 0.25,
  repeatedFragmentInvalidMinimum: 6,
  repeatedFragmentInvalidRatio: 0.6,
  fragmentedItemUncertainMinimum: 20,
  fragmentedItemUncertainRatio: 0.85,
  shortTextMaximumMeaningfulCharacters: 24,
  sparseHeaderFooterMaximumMeaningfulCharacters: 80,
  sparseHeaderFooterMaximumWords: 8,
  geometryMinimumBaselineTolerance: 2,
  geometryBaselineToleranceHeightRatio: 0.65,
  geometryMinimumSpaceGap: 1,
  geometrySpaceGapHeightRatio: 0.18,
  maximumConsecutiveLineEndings: 3,
} as const;

export type PdfTextReconstruction = {
  readonly text: string;
  readonly unsafeControlCount: number;
  readonly replacementCharacterCount: number;
  readonly lineCount: number;
  readonly malformedItemCount: number;
  readonly explicitLineBreakCount: number;
  readonly geometryLineBreakCount: number;
  readonly insertedSpaceCount: number;
};

type SanitisedItem = {
  readonly text: string;
  readonly unsafeControlCount: number;
  readonly replacementCharacterCount: number;
};

type PositionedItem = {
  readonly item: PdfTextItem;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const MEANINGFUL_CHARACTER = /[\p{L}\p{N}\p{P}]/u;
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;
const CLOSING_PUNCTUATION = /^[,.;:!?%)\]}\u00bb\u2019\u201d]/u;
const OPENING_PUNCTUATION = /[([{\u00ab\u2018\u201c]$/u;
const FOOTER_OR_GENERATOR_MARKER =
  /(?:\b(?:scanned|digitised|digitized|generated)\s+by\b|\bcopyright\b|\u00a9|https?:\/\/|\bwww\.|\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b|^\s*(?:header|footer)\b)/iu;

function isUnsafeControlCode(code: number) {
  return (
    (code >= 0x00 && code <= 0x08) ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f)
  );
}

function throwTextLimit() {
  throw new PdfError("PDF_PAGE_TEXT_LIMIT_EXCEEDED");
}

/** Normalises line endings and removes unsafe controls without exceeding max. */
function sanitiseItem(value: string, maxCharacters: number): SanitisedItem {
  const chunks: string[] = [];
  let chunk = "";
  let length = 0;
  let unsafeControlCount = 0;
  let replacementCharacterCount = 0;

  const append = (character: string) => {
    if (length + character.length > maxCharacters) throwTextLimit();
    chunk += character;
    length += character.length;
    if (chunk.length >= 4_096) {
      chunks.push(chunk);
      chunk = "";
    }
  };

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x0d) {
      if (value.charCodeAt(index + 1) === 0x0a) index += 1;
      append("\n");
      continue;
    }
    if (isUnsafeControlCode(code)) {
      unsafeControlCount += 1;
      continue;
    }
    const character = value[index];
    if (character === "\ufffd") replacementCharacterCount += 1;
    append(character);
  }
  if (chunk) chunks.push(chunk);
  return {
    text: chunks.join(""),
    unsafeControlCount,
    replacementCharacterCount,
  };
}

function hasOwn(value: object, property: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function isNonTextItem(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    !hasOwn(value, "str")
  );
}

function malformedItemCount(item: unknown) {
  if (isNonTextItem(item)) return 0;
  if (typeof item !== "object" || item === null) return 1;
  const candidate = item as Partial<PdfTextItem>;
  if (typeof candidate.str !== "string") return 1;
  if (candidate.dir !== undefined && typeof candidate.dir !== "string") return 1;
  if (candidate.hasEOL !== undefined && typeof candidate.hasEOL !== "boolean") {
    return 1;
  }
  if (
    candidate.width !== undefined &&
    (!Number.isFinite(candidate.width) || candidate.width < 0)
  ) {
    return 1;
  }
  if (
    candidate.height !== undefined &&
    (!Number.isFinite(candidate.height) || candidate.height < 0)
  ) {
    return 1;
  }
  if (candidate.transform !== undefined) {
    if (candidate.transform.length < 6) return 1;
    for (let index = 0; index < 6; index += 1) {
      if (!Number.isFinite(candidate.transform[index])) return 1;
    }
  }
  return 0;
}

function safeTextItem(candidate: object & { readonly str: string }): PdfTextItem {
  const item = candidate as Partial<PdfTextItem> & { readonly str: string };
  const transform =
    item.transform &&
    item.transform.length >= 6 &&
    item.transform.slice(0, 6).every((value) => Number.isFinite(value))
      ? item.transform
      : undefined;
  const width =
    item.width !== undefined && Number.isFinite(item.width) && item.width >= 0
      ? item.width
      : undefined;
  const height =
    item.height !== undefined && Number.isFinite(item.height) && item.height >= 0
      ? item.height
      : undefined;
  return {
    str: item.str,
    ...(typeof item.dir === "string" ? { dir: item.dir } : {}),
    ...(transform ? { transform } : {}),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(typeof item.hasEOL === "boolean" ? { hasEOL: item.hasEOL } : {}),
  };
}

function positioned(item: PdfTextItem, text: string): PositionedItem | null {
  const transform = item.transform;
  if (!transform || transform.length < 6) return null;
  const x = transform[4];
  const y = transform[5];
  const inferredHeight = Math.hypot(transform[2], transform[3]);
  const height = item.height && item.height > 0 ? item.height : inferredHeight;
  const width = item.width;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    width === undefined ||
    !Number.isFinite(width) ||
    width < 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return null;
  }
  return { item, text, x, y, width, height };
}

function codePointLength(value: string) {
  let length = 0;
  for (const _character of value) length += 1;
  return length;
}

function fallbackSeparator(previous: string, current: string) {
  if (/\s$/u.test(previous) || /^\s/u.test(current)) return "";
  if (CLOSING_PUNCTUATION.test(current) || OPENING_PUNCTUATION.test(previous)) {
    return "";
  }
  const previousLast = [...previous].at(-1) ?? "";
  const currentFirst = [...current][0] ?? "";
  if (
    codePointLength(previous) === 1 &&
    codePointLength(current) === 1 &&
    WORD_CHARACTER.test(previousLast) &&
    WORD_CHARACTER.test(currentFirst)
  ) {
    return "";
  }
  return " ";
}

function separatorBetween(
  previous: { readonly item: PdfTextItem; readonly text: string },
  current: { readonly item: PdfTextItem; readonly text: string },
) {
  if (/\s$/u.test(previous.text) || /^\s/u.test(current.text)) return "";
  if (
    CLOSING_PUNCTUATION.test(current.text) ||
    OPENING_PUNCTUATION.test(previous.text)
  ) {
    return "";
  }
  const previousPosition = positioned(previous.item, previous.text);
  const currentPosition = positioned(current.item, current.text);
  if (!previousPosition || !currentPosition) {
    return fallbackSeparator(previous.text, current.text);
  }

  const representativeHeight = Math.max(
    previousPosition.height,
    currentPosition.height,
  );
  const baselineDifference = Math.abs(currentPosition.y - previousPosition.y);
  const baselineTolerance = Math.max(
    PDF_TEXT_LAYER_THRESHOLDS.geometryMinimumBaselineTolerance,
    representativeHeight *
      PDF_TEXT_LAYER_THRESHOLDS.geometryBaselineToleranceHeightRatio,
  );
  if (baselineDifference > baselineTolerance) return "\n";

  const previousDirection = previous.item.dir?.toLowerCase();
  const currentDirection = current.item.dir?.toLowerCase();
  const rightToLeft = previousDirection === "rtl" && currentDirection === "rtl";
  const gap = rightToLeft
    ? previousPosition.x - (currentPosition.x + currentPosition.width)
    : currentPosition.x - (previousPosition.x + previousPosition.width);
  const spaceThreshold = Math.max(
    PDF_TEXT_LAYER_THRESHOLDS.geometryMinimumSpaceGap,
    representativeHeight *
      PDF_TEXT_LAYER_THRESHOLDS.geometrySpaceGapHeightRatio,
  );
  return gap > spaceThreshold ? " " : "";
}

function reconstructedLineCount(value: string) {
  if (value.length === 0) return 0;
  const withoutTrailingLineEndings = value.replace(/\n+$/u, "");
  if (withoutTrailingLineEndings.length === 0) return 1;
  return withoutTrailingLineEndings.split("\n").length;
}

/**
 * Reconstructs PDF text in source order. Geometry only selects a conservative
 * separator; it never reorders items or attempts columns/table reconstruction.
 */
export function reconstructPdfText(
  items: readonly PdfTextItem[],
  maxCharacters: number = PDF_LIMITS.maxPageTextCharacters,
): PdfTextReconstruction {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 0) {
    throwTextLimit();
  }

  const parts: string[] = [];
  let length = 0;
  let unsafeControlCount = 0;
  let replacementCharacterCount = 0;
  let malformedItems = 0;
  let explicitLineBreakCount = 0;
  let geometryLineBreakCount = 0;
  let insertedSpaceCount = 0;
  let previous: { readonly item: PdfTextItem; readonly text: string } | null =
    null;

  const append = (value: string) => {
    if (length + value.length > maxCharacters) throwTextLimit();
    if (value.length === 0) return;
    parts.push(value);
    length += value.length;
  };

  for (const candidate of items as readonly unknown[]) {
    const malformed = malformedItemCount(candidate);
    malformedItems += malformed;
    if (
      isNonTextItem(candidate) ||
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as Partial<PdfTextItem>).str !== "string"
    ) {
      continue;
    }
    const item = safeTextItem(
      candidate as object & { readonly str: string },
    );
    const sanitised = sanitiseItem(item.str, maxCharacters - length);
    unsafeControlCount += sanitised.unsafeControlCount;
    replacementCharacterCount += sanitised.replacementCharacterCount;
    const text = sanitised.text;

    if (text.length > 0) {
      if (previous) {
        const separator = separatorBetween(previous, { item, text });
        append(separator);
        if (separator === "\n") geometryLineBreakCount += 1;
        if (separator === " ") insertedSpaceCount += 1;
      }
      append(text);
      previous = { item, text };
    }

    if (item.hasEOL && length > 0 && !parts.at(-1)?.endsWith("\n")) {
      append("\n");
      explicitLineBreakCount += 1;
      previous = null;
    }
  }

  const text = parts.join("");
  return {
    text,
    unsafeControlCount,
    replacementCharacterCount,
    lineCount: reconstructedLineCount(text),
    malformedItemCount: malformedItems,
    explicitLineBreakCount,
    geometryLineBreakCount,
    insertedSpaceCount,
  };
}

/** Applies only PDF-safe whitespace/control normalisation, never prose cleanup. */
export function cleanEmbeddedPdfText(value: string) {
  const normalised = value.replace(/\r\n?/g, "\n");
  let withoutUnsafeControls = "";
  for (let index = 0; index < normalised.length; index += 1) {
    const code = normalised.charCodeAt(index);
    if (!isUnsafeControlCode(code)) withoutUnsafeControls += normalised[index];
  }
  return withoutUnsafeControls
    .replace(/[ \t]+$/gm, "")
    .replace(
      new RegExp(
        `\\n{${PDF_TEXT_LAYER_THRESHOLDS.maximumConsecutiveLineEndings + 1},}`,
        "g",
      ),
      "\n".repeat(PDF_TEXT_LAYER_THRESHOLDS.maximumConsecutiveLineEndings),
    )
    .trim();
}

function countTextCharacters(value: string) {
  let nonWhitespaceCharacterCount = 0;
  let meaningfulCharacterCount = 0;
  let replacementCharacterCount = 0;
  for (const character of value) {
    if (!/\s/u.test(character)) nonWhitespaceCharacterCount += 1;
    if (MEANINGFUL_CHARACTER.test(character)) meaningfulCharacterCount += 1;
    if (character === "\ufffd") replacementCharacterCount += 1;
  }
  return {
    nonWhitespaceCharacterCount,
    meaningfulCharacterCount,
    replacementCharacterCount,
  };
}

type MetricFragment = {
  readonly item: PdfTextItem;
  readonly text: string;
  readonly lineBreakBefore: boolean;
};

const LEADER_FRAGMENT = /^[.\u00b7\u2026 ]+$/u;

/**
 * A dotted leader connects two pieces of text on one horizontal line. Require
 * that geometry before ignoring its punctuation in repetition/fragmentation
 * metrics; dots alone or near unrelated lines/columns remain evidence.
 */
function isInlineLeaderRun(
  fragments: readonly MetricFragment[],
  start: number,
  end: number,
) {
  const before = fragments[start - 1];
  const after = fragments[end];
  if (
    !before || !after ||
    !/[\p{L}\p{N}]/u.test(before.text) ||
    !/[\p{L}\p{N}]/u.test(after.text)
  ) return false;

  const anchor = positioned(fragments[start].item, fragments[start].text);
  if (!anchor) return false;
  let previous: PositionedItem | null = null;
  for (let index = start - 1; index <= end; index += 1) {
    const fragment = fragments[index];
    const current = positioned(fragment.item, fragment.text);
    const transform = fragment.item.transform;
    if (
      !current || !transform || current.width <= 0 ||
      transform[1] !== 0 || transform[2] !== 0 ||
      transform[0] <= 0 || transform[3] <= 0 ||
      (fragment.item.dir !== undefined && fragment.item.dir.toLowerCase() !== "ltr") ||
      fragment.text.includes("\n") ||
      (index >= start && fragment.lineBreakBefore)
    ) return false;

    const baselineTolerance = Math.max(
      PDF_TEXT_LAYER_THRESHOLDS.geometryMinimumBaselineTolerance,
      Math.min(anchor.height, current.height) *
        PDF_TEXT_LAYER_THRESHOLDS.geometryBaselineToleranceHeightRatio,
    );
    if (Math.abs(current.y - anchor.y) > baselineTolerance) return false;
    if (previous) {
      const gap = current.x - previous.x - previous.width;
      // Neighboring fragments must advance across the line with only local
      // whitespace (at most their combined font heights), not a column jump.
      const roundingAllowance = PDF_TEXT_LAYER_THRESHOLDS.geometryMinimumSpaceGap;
      if (
        gap < -roundingAllowance ||
        gap > previous.height + current.height + roundingAllowance
      ) return false;
    }
    previous = current;
  }
  return true;
}

function inlineLeaderIndices(fragments: readonly MetricFragment[]) {
  const indices = new Set<number>();
  for (let start = 0; start < fragments.length;) {
    if (!LEADER_FRAGMENT.test(fragments[start].text)) {
      start += 1;
      continue;
    }
    let end = start + 1;
    while (end < fragments.length && LEADER_FRAGMENT.test(fragments[end].text)) {
      end += 1;
    }
    if (isInlineLeaderRun(fragments, start, end)) {
      for (let index = start; index < end; index += 1) indices.add(index);
    }
    start = end;
  }
  return indices;
}

function itemMetrics(items: readonly PdfTextItem[]) {
  let textItemCount = 0;
  let singleGlyphItemCount = 0;
  let ambiguousDirectionItemCount = 0;
  let rightToLeftItemCount = 0;
  let verticalItemCount = 0;
  let nonEmptyFragmentCount = 0;
  let repeatedFragmentCount = 0;
  const frequencies = new Map<string, number>();
  const fragments: MetricFragment[] = [];
  let lineBreakBefore = false;

  for (const candidate of items as readonly unknown[]) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as Partial<PdfTextItem>).str !== "string"
    ) {
      continue;
    }
    const item = safeTextItem(
      candidate as object & { readonly str: string },
    );
    textItemCount += 1;
    const text = sanitiseItem(
      item.str,
      PDF_LIMITS.maxPageTextCharacters,
    ).text;
    const fragment = text.trim();
    if (fragment.length > 0) {
      fragments.push({ item, text: fragment, lineBreakBefore: lineBreakBefore || /^\s*\n/u.test(text) });
      lineBreakBefore = false;
    }
    lineBreakBefore ||= item.hasEOL === true || text.includes("\n");
    if (item.dir !== undefined) {
      const direction = item.dir.toLowerCase();
      if (direction === "rtl") rightToLeftItemCount += 1;
      else if (direction === "ttb" || direction === "btt") {
        verticalItemCount += 1;
      } else if (direction !== "ltr") {
        ambiguousDirectionItemCount += 1;
      }
    }
  }
  const leaderIndices = inlineLeaderIndices(fragments);
  for (let index = 0; index < fragments.length; index += 1) {
    if (leaderIndices.has(index)) continue;
    const fragment = fragments[index].text;
    nonEmptyFragmentCount += 1;
    if (codePointLength(fragment) === 1) singleGlyphItemCount += 1;
    frequencies.set(fragment, (frequencies.get(fragment) ?? 0) + 1);
  }
  for (const count of frequencies.values()) {
    repeatedFragmentCount = Math.max(repeatedFragmentCount, count);
  }
  if (repeatedFragmentCount < 2) repeatedFragmentCount = 0;
  return {
    textItemCount,
    singleGlyphItemCount,
    singleGlyphItemRatio:
      nonEmptyFragmentCount === 0
        ? 0
        : singleGlyphItemCount / nonEmptyFragmentCount,
    repeatedFragmentCount,
    repeatedFragmentRatio:
      nonEmptyFragmentCount === 0
        ? 0
        : repeatedFragmentCount / nonEmptyFragmentCount,
    ambiguousDirectionItemCount,
    rightToLeftItemCount,
    verticalItemCount,
  };
}

function metricsFor(
  items: readonly PdfTextItem[],
  reconstruction: PdfTextReconstruction,
): PdfTextLayerMetrics {
  const characters = countTextCharacters(reconstruction.text);
  const itemCounts = itemMetrics(items);
  const unsafeDenominator =
    characters.nonWhitespaceCharacterCount + reconstruction.unsafeControlCount;
  return {
    itemCount: items.length,
    textItemCount: itemCounts.textItemCount,
    malformedItemCount: reconstruction.malformedItemCount,
    nonWhitespaceCharacterCount: characters.nonWhitespaceCharacterCount,
    meaningfulCharacterCount: characters.meaningfulCharacterCount,
    reconstructedLineCount: reconstruction.lineCount,
    replacementCharacterCount: reconstruction.replacementCharacterCount,
    replacementCharacterRatio:
      characters.nonWhitespaceCharacterCount === 0
        ? 0
        : reconstruction.replacementCharacterCount /
          characters.nonWhitespaceCharacterCount,
    unsafeControlCount: reconstruction.unsafeControlCount,
    unsafeControlRatio:
      unsafeDenominator === 0
        ? 0
        : reconstruction.unsafeControlCount / unsafeDenominator,
    meaningfulCharacterRatio:
      characters.nonWhitespaceCharacterCount === 0
        ? 0
        : characters.meaningfulCharacterCount /
          characters.nonWhitespaceCharacterCount,
    repeatedFragmentCount: itemCounts.repeatedFragmentCount,
    repeatedFragmentRatio: itemCounts.repeatedFragmentRatio,
    singleGlyphItemCount: itemCounts.singleGlyphItemCount,
    singleGlyphItemRatio: itemCounts.singleGlyphItemRatio,
    ambiguousDirectionItemCount: itemCounts.ambiguousDirectionItemCount,
    rightToLeftItemCount: itemCounts.rightToLeftItemCount,
    verticalItemCount: itemCounts.verticalItemCount,
    ambiguousDirection: itemCounts.ambiguousDirectionItemCount > 0,
    verticalLayout: itemCounts.verticalItemCount > 0,
  };
}

function pageNumberOnly(value: string) {
  return /^(?:page\s*)?(?:\d{1,6}|[ivxlcdm]{1,10})(?:\s*(?:of|\/)\s*\d{1,6})?[\p{P}\s]*$/iu.test(
    value.trim(),
  );
}

function sparseHeaderOrFooter(
  value: string,
  metrics: PdfTextLayerMetrics,
) {
  if (
    metrics.meaningfulCharacterCount >
      PDF_TEXT_LAYER_THRESHOLDS.sparseHeaderFooterMaximumMeaningfulCharacters ||
    metrics.reconstructedLineCount > 2
  ) {
    return false;
  }
  const trimmed = value.trim();
  const words = trimmed ? trimmed.split(/\s+/u).length : 0;
  if (words > PDF_TEXT_LAYER_THRESHOLDS.sparseHeaderFooterMaximumWords) {
    return false;
  }
  if (FOOTER_OR_GENERATOR_MARKER.test(trimmed)) return true;
  const letters = [...trimmed].filter((character) => /\p{L}/u.test(character));
  // Case alone is weak evidence for non-Latin scripts; the selected OCR models
  // may not cover them. Retain embedded text unless another safeguard applies.
  if (letters.some((character) => !/\p{Script=Latin}/u.test(character))) return false;
  const casedLetters = letters.filter(
    (character) => character.toLowerCase() !== character.toUpperCase(),
  );
  return (
    casedLetters.length >= 4 &&
    casedLetters.every(
      (character) => character === character.toUpperCase(),
    ) &&
    !/[.!?]\s*$/u.test(trimmed)
  );
}

function assessment(
  classification: PdfTextLayerAssessment["classification"],
  reasonCodes: readonly PdfTextLayerReasonCode[],
  metrics: PdfTextLayerMetrics,
): PdfTextLayerAssessment {
  return { classification, reasonCodes, metrics };
}

/**
 * Classifies reconstructed text with content-free metrics. The original text is
 * used transiently for decisions and is never copied into the assessment.
 */
export function assessPdfTextLayer(
  items: readonly PdfTextItem[],
  reconstruction: PdfTextReconstruction,
  extractionFailed = false,
): PdfTextLayerAssessment {
  const metrics = metricsFor(items, reconstruction);
  if (extractionFailed) {
    return assessment("invalid", ["text-extraction-failed"], metrics);
  }
  if (metrics.malformedItemCount > 0) {
    return assessment("invalid", ["malformed-text-items"], metrics);
  }
  if (metrics.textItemCount === 0) {
    return assessment("empty", ["empty-text-layer"], metrics);
  }
  if (metrics.nonWhitespaceCharacterCount === 0) {
    return assessment("empty", ["no-meaningful-text"], metrics);
  }
  if (
    metrics.replacementCharacterCount >=
      PDF_TEXT_LAYER_THRESHOLDS.replacementCharacterInvalidMinimum &&
    metrics.replacementCharacterRatio >=
      PDF_TEXT_LAYER_THRESHOLDS.replacementCharacterInvalidRatio
  ) {
    return assessment(
      "invalid",
      ["high-replacement-character-ratio"],
      metrics,
    );
  }
  if (
    metrics.unsafeControlCount >=
      PDF_TEXT_LAYER_THRESHOLDS.unsafeControlInvalidMinimum &&
    metrics.unsafeControlRatio >=
      PDF_TEXT_LAYER_THRESHOLDS.unsafeControlInvalidRatio
  ) {
    return assessment("invalid", ["high-unsafe-control-ratio"], metrics);
  }
  if (
    metrics.repeatedFragmentCount >=
      PDF_TEXT_LAYER_THRESHOLDS.repeatedFragmentInvalidMinimum &&
    metrics.repeatedFragmentRatio >=
      PDF_TEXT_LAYER_THRESHOLDS.repeatedFragmentInvalidRatio
  ) {
    return assessment("invalid", ["suspicious-repetition"], metrics);
  }
  if (
    metrics.nonWhitespaceCharacterCount >=
      PDF_TEXT_LAYER_THRESHOLDS
        .meaningfulCharacterInvalidMinimumNonWhitespace &&
    metrics.meaningfulCharacterRatio <
      PDF_TEXT_LAYER_THRESHOLDS.meaningfulCharacterInvalidRatio
  ) {
    return assessment(
      "invalid",
      ["low-meaningful-character-ratio"],
      metrics,
    );
  }
  if (metrics.verticalLayout) {
    return assessment("uncertain", ["vertical-text"], metrics);
  }
  if (metrics.ambiguousDirection) {
    return assessment("uncertain", ["ambiguous-direction"], metrics);
  }
  if (pageNumberOnly(reconstruction.text)) {
    return assessment("uncertain", ["page-number-only"], metrics);
  }
  if (sparseHeaderOrFooter(reconstruction.text, metrics)) {
    return assessment("uncertain", ["sparse-header-or-footer"], metrics);
  }
  if (
    metrics.textItemCount >=
      PDF_TEXT_LAYER_THRESHOLDS.fragmentedItemUncertainMinimum &&
    metrics.singleGlyphItemRatio >=
      PDF_TEXT_LAYER_THRESHOLDS.fragmentedItemUncertainRatio
  ) {
    return assessment("uncertain", ["high-fragmentation"], metrics);
  }
  if (metrics.rightToLeftItemCount > 0) {
    return assessment("usable", ["right-to-left-text"], metrics);
  }
  if (
    metrics.meaningfulCharacterCount <=
    PDF_TEXT_LAYER_THRESHOLDS.shortTextMaximumMeaningfulCharacters
  ) {
    return assessment("usable", ["valid-short-text"], metrics);
  }
  return assessment("usable", ["normal-text"], metrics);
}
