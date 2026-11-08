import {
  clearCanvas,
  cropToSourcePixels,
  decodeImage,
  renderRecognitionTile,
} from "../image-editor/image";
import {
  compose,
  fineRotationAroundTileCenter,
  invert,
  mapRectEnvelope,
  orientedSize,
  orientedToPreparedTileTransform,
  sourceToOrientedTransform,
  type AffineMatrix,
  type PixelRect,
  type PixelSize,
} from "../image-editor/coordinates";
import type { LocalTesseractAdapter } from "./tesseract-adapter";
import {
  assembleOwnedLines,
  nativeTilingEligibility,
  planNativeVerticalTiles,
  type MappedTileLine,
  type NativeRecognitionTile,
  type NativeVerticalTilePlan,
} from "./tiling";
import { mapEngineSectionWord } from "./word-geometry";
import type {
  EngineSectionWord,
  ImageTransform,
  OcrContentMode,
  OcrLine,
  OcrProgress,
  PreparationMetadata,
  RecognitionCoordinateMetadata,
  RecognitionSectionMetadata,
  RecognitionSummary,
  RecognitionWordGeometry,
} from "./types";

type RecognitionAdapter = Pick<LocalTesseractAdapter, "recognise">;

export type RecognitionRunOptions = {
  languages?: readonly string[];
  adapter: RecognitionAdapter;
  file: File;
  sourceWidth: number;
  sourceHeight: number;
  sourceFileBytes: number;
  transform: ImageTransform;
  contentMode: OcrContentMode;
  previewCanvas: HTMLCanvasElement;
  previewPreparation: PreparationMetadata;
  signal: AbortSignal;
  onProgress: (progress: OcrProgress) => void;
  /** Opt-in source geometry; the image tool enables this for word review. */
  includeWordGeometry?: boolean;
};

export type RecognitionRunResult = {
  raw: string;
  confidence: number | null;
  rotateRadians: number;
  lines: readonly OcrLine[];
  recognition: RecognitionSummary;
  words?: readonly RecognitionWordGeometry[];
};

type OwnedLine = {
  tileIndex: number;
  sourceOrder: number;
  line: OcrLine;
  hierarchyKey: string;
};

type MappedWordCandidate = {
  hierarchyKey: string;
  sourceOrder: number;
  geometry: RecognitionWordGeometry;
};

export function isRecognitionAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  const error = new Error("The local recognition operation was cancelled.");
  error.name = "AbortError";
  throw error;
}

function coordinateMetadata(
  sourceWidth: number,
  sourceHeight: number,
  sourceCrop: PixelRect,
  rotation: ImageTransform["rotation"],
): RecognitionCoordinateMetadata {
  const sourceToOriented = sourceToOrientedTransform(sourceCrop, rotation);
  return {
    version: 1,
    sourceSize: { width: sourceWidth, height: sourceHeight },
    sourceCrop,
    orientedPageSize: orientedSize(sourceCrop, rotation),
    sourceToOriented,
    orientedToSource: invert(sourceToOriented),
  };
}

function sectionMetadata(
  tile: NativeRecognitionTile,
  preparedSize: PixelSize,
  rotateRadians: number,
  preparation: PreparationMetadata,
): RecognitionSectionMetadata {
  const orientedToPrepared = orientedToPreparedTileTransform(
    tile.inputRect,
    preparedSize,
  );
  const preparedToEngine = fineRotationAroundTileCenter(
    rotateRadians,
    preparedSize,
  );
  return {
    id: `section-${tile.index + 1}`,
    index: tile.index,
    inputRect: tile.inputRect,
    coreRect: tile.coreRect,
    preparedSize,
    orientedToPrepared,
    preparedToOriented: invert(orientedToPrepared),
    preparedToEngine,
    engineToPrepared: invert(preparedToEngine),
    rotateRadians,
    thresholdingMethod: preparation.thresholdingMethod,
    polarityInverted: preparation.polarityInverted,
  };
}

function mappedLineEnvelope(
  line: OcrLine,
  engineToPrepared: AffineMatrix,
  preparedToOriented: AffineMatrix,
) {
  return mapRectEnvelope(compose(engineToPrepared, preparedToOriented), {
    x: line.bbox.x0,
    y: line.bbox.y0,
    width: line.bbox.x1 - line.bbox.x0,
    height: line.bbox.y1 - line.bbox.y0,
  });
}

function hierarchyKey(
  tileIndex: number,
  item: Pick<
    EngineSectionWord | OcrLine,
    "blockIndex" | "paragraphIndex" | "lineIndex"
  >,
) {
  return `${tileIndex}:${item.blockIndex}:${item.paragraphIndex}:${item.lineIndex}`;
}

function weightedConfidence(lines: readonly OcrLine[]) {
  let weightedTotal = 0;
  let weight = 0;
  for (const line of lines) {
    if (line.confidence === null) continue;
    const lineWeight = Math.max(1, line.text.replace(/\s/g, "").length);
    weightedTotal += line.confidence * lineWeight;
    weight += lineWeight;
  }
  return weight === 0 ? null : weightedTotal / weight;
}

function combinedRawText(lines: readonly OwnedLine[]) {
  if (lines.length === 0) return "";
  let result = lines[0].line.text.replace(/\r?\n+$/g, "");
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    const sameParagraph =
      previous.tileIndex === current.tileIndex &&
      previous.line.blockIndex === current.line.blockIndex &&
      previous.line.paragraphIndex === current.line.paragraphIndex;
    // A seam is an implementation boundary, not a document paragraph.
    const separator =
      previous.tileIndex !== current.tileIndex || sameParagraph ? "\n" : "\n\n";
    result += separator + current.line.text.replace(/\r?\n+$/g, "");
  }
  return result;
}

function phaseForProgress(progress: OcrProgress): OcrProgress["phase"] {
  return progress.stage.toLowerCase().includes("recogn")
    ? "recognising"
    : "loading-assets";
}

async function runSingleCanvas(
  options: RecognitionRunOptions,
  coordinates: RecognitionCoordinateMetadata,
): Promise<RecognitionRunResult> {
  throwIfAborted(options.signal);
  const response = await options.adapter.recognise(
    options.previewCanvas,
    {
      contentMode: options.contentMode,
      languages: options.languages,
      autoDeskew:
        options.transform.preset === "adaptive-document" &&
        options.contentMode !== "single-line",
      thresholdingMethod: options.previewPreparation.thresholdingMethod,
      includeWords: options.includeWordGeometry === true,
      includeLines: true,
    },
    (progress) => {
      if (options.signal.aborted) return;
      options.onProgress({ ...progress, phase: phaseForProgress(progress) });
    },
  );
  throwIfAborted(options.signal);

  const pageSize = coordinates.orientedPageSize;
  const tile: NativeRecognitionTile = {
    index: 0,
    inputRect: { x: 0, y: 0, ...pageSize },
    coreRect: { x: 0, y: 0, ...pageSize },
  };
  const preparedSize = {
    width: options.previewCanvas.width,
    height: options.previewCanvas.height,
  };
  const section = sectionMetadata(
    tile,
    preparedSize,
    response.rotateRadians,
    options.previewPreparation,
  );

  const result: RecognitionRunResult = {
    raw: response.text,
    confidence: response.confidence,
    rotateRadians: response.rotateRadians,
    lines: response.lines ?? [],
    recognition: {
      strategy: "single-canvas",
      sourceDetail: options.previewPreparation.scaleAction,
      sectionCount: 1,
      totalPreparedPixels: preparedSize.width * preparedSize.height,
      peakPreparedSize: preparedSize,
      coordinates,
      sections: [section],
    },
  };
  if (options.includeWordGeometry) {
    result.words = (response.words ?? []).map((word) =>
      mapEngineSectionWord(
        word,
        section,
        coordinates.orientedToSource,
      ),
    );
  }
  return result;
}

function tileProgress(
  progress: OcrProgress,
  tileIndex: number,
  tileCount: number,
): OcrProgress {
  const recognising = progress.stage.toLowerCase().includes("recogn");
  return {
    stage: recognising
      ? `Recognising section ${tileIndex + 1} of ${tileCount}`
      : progress.stage,
    value:
      progress.value === null
        ? null
        : (tileIndex + Math.min(1, Math.max(0, progress.value))) / tileCount,
    phase: recognising ? "recognising" : "loading-assets",
    currentSection: tileIndex + 1,
    totalSections: tileCount,
  };
}

async function runNativeTiles(
  options: RecognitionRunOptions,
  coordinates: RecognitionCoordinateMetadata,
  plan: NativeVerticalTilePlan,
): Promise<RecognitionRunResult> {
  throwIfAborted(options.signal);
  options.onProgress({
    stage: `Preparing ${plan.tiles.length} local sections`,
    value: 0,
    phase: "preparing",
    currentSection: 0,
    totalSections: plan.tiles.length,
  });
  const decoded = await decodeImage(options.file);
  const canvas = document.createElement("canvas");
  const candidates: MappedTileLine<OwnedLine>[] = [];
  const wordCandidates: MappedWordCandidate[] = [];
  const sections: RecognitionSectionMetadata[] = [];
  let totalPreparedPixels = 0;
  let peakPreparedSize = { width: 0, height: 0 };

  try {
    throwIfAborted(options.signal);
    for (const tile of plan.tiles) {
      throwIfAborted(options.signal);
      renderRecognitionTile(
        decoded,
        options.transform,
        coordinates.sourceCrop,
        tile.inputRect,
        canvas,
        options.previewPreparation.adaptivePlan,
      );
      throwIfAborted(options.signal);
      const response = await options.adapter.recognise(
        canvas,
        {
          contentMode: options.contentMode,
          languages: options.languages,
          autoDeskew: true,
          thresholdingMethod: options.previewPreparation.thresholdingMethod,
          includeWords: options.includeWordGeometry === true,
          includeLines: true,
          pageSegmentation: "single-block",
        },
        (progress) => {
          if (options.signal.aborted) return;
          options.onProgress(tileProgress(progress, tile.index, plan.tiles.length));
        },
      );
      throwIfAborted(options.signal);

      const preparedSize = { width: canvas.width, height: canvas.height };
      const section = sectionMetadata(
        tile,
        preparedSize,
        response.rotateRadians,
        options.previewPreparation,
      );
      sections.push(section);
      totalPreparedPixels += preparedSize.width * preparedSize.height;
      if (
        preparedSize.width * preparedSize.height >
        peakPreparedSize.width * peakPreparedSize.height
      ) {
        peakPreparedSize = preparedSize;
      }

      if (response.text.trim() && (!response.lines || response.lines.length === 0)) {
        throw new Error(
          "The local OCR engine did not return the line positions needed to combine this long document.",
        );
      }

      const responseLineKeys = new Set(
        (response.lines ?? []).map((line) => hierarchyKey(tile.index, line)),
      );
      if (
        options.includeWordGeometry &&
        (response.words ?? []).some(
          (word) => !responseLineKeys.has(hierarchyKey(tile.index, word)),
        )
      ) {
        throw new Error(
          "The local OCR engine returned a word without the line position needed for section ownership.",
        );
      }

      if (options.includeWordGeometry) {
        for (const [sourceOrder, word] of (response.words ?? []).entries()) {
          wordCandidates.push({
            hierarchyKey: hierarchyKey(tile.index, word),
            sourceOrder,
            geometry: mapEngineSectionWord(
              word,
              section,
              coordinates.orientedToSource,
            ),
          });
        }
      }

      for (const [sourceOrder, line] of (response.lines ?? []).entries()) {
        const bbox = mappedLineEnvelope(
          line,
          section.engineToPrepared,
          section.preparedToOriented,
        );
        const globalLine: OcrLine = {
          ...line,
          bbox: {
            x0: bbox.x,
            y0: bbox.y,
            x1: bbox.x + bbox.width,
            y1: bbox.y + bbox.height,
          },
          // Preserve hierarchy within a tile without accidentally merging two
          // unrelated Tesseract block IDs from different sections.
          blockIndex: tile.index * 1_000_000 + line.blockIndex,
        };
        candidates.push({
          tileIndex: tile.index,
          sourceOrder,
          bbox,
          line: {
            tileIndex: tile.index,
            sourceOrder,
            line: globalLine,
            hierarchyKey: hierarchyKey(tile.index, line),
          },
        });
      }

      // The same bounded canvas is reused sequentially. Resetting its width
      // releases the previous tile backing store before the next render.
      canvas.width = 0;
      canvas.height = 0;
    }

    throwIfAborted(options.signal);
    options.onProgress({
      stage: "Combining local sections",
      value: 1,
      phase: "combining",
      currentSection: plan.tiles.length,
      totalSections: plan.tiles.length,
    });
    const owned = assembleOwnedLines(plan, candidates).map(
      (candidate) => candidate.line,
    );
    const lines = owned.map((item) => item.line);
    const result: RecognitionRunResult = {
      raw: combinedRawText(owned),
      confidence: weightedConfidence(lines),
      // Fine rotation is section-local. A page-wide scalar would be misleading.
      rotateRadians: 0,
      lines,
      recognition: {
        strategy: "vertical-tiles",
        sourceDetail: "original",
        sectionCount: plan.tiles.length,
        totalPreparedPixels,
        peakPreparedSize,
        coordinates,
        sections,
      },
    };
    if (options.includeWordGeometry) {
      const candidatesByLine = new Map<string, MappedWordCandidate[]>();
      for (const candidate of wordCandidates) {
        const lineWords = candidatesByLine.get(candidate.hierarchyKey) ?? [];
        lineWords.push(candidate);
        candidatesByLine.set(candidate.hierarchyKey, lineWords);
      }
      result.words = owned.flatMap((line) =>
        (candidatesByLine.get(line.hierarchyKey) ?? [])
          .sort(
            (left, right) =>
              left.geometry.wordIndex - right.geometry.wordIndex ||
              left.sourceOrder - right.sourceOrder,
          )
          .map((candidate) => candidate.geometry),
      );
    }
    return result;
  } finally {
    clearCanvas(canvas);
    decoded.close();
  }
}

export async function runRecognition(
  options: RecognitionRunOptions,
): Promise<RecognitionRunResult> {
  const sourceCrop = cropToSourcePixels(
    options.transform.crop,
    options.sourceWidth,
    options.sourceHeight,
  );
  const coordinates = coordinateMetadata(
    options.sourceWidth,
    options.sourceHeight,
    sourceCrop,
    options.transform.rotation,
  );
  const pageSize = coordinates.orientedPageSize;
  const eligibility = nativeTilingEligibility({
    contentMode: options.contentMode,
    preset: options.transform.preset,
    orientedWidth: pageSize.width,
    orientedHeight: pageSize.height,
    wholePreparationAction: options.previewPreparation.scaleAction,
    sourceWidth: options.sourceWidth,
    sourceHeight: options.sourceHeight,
    sourceFileBytes: options.sourceFileBytes,
  });

  if (!eligibility.eligible) {
    return runSingleCanvas(options, coordinates);
  }
  return runNativeTiles(
    options,
    coordinates,
    planNativeVerticalTiles(pageSize.width, pageSize.height),
  );
}
