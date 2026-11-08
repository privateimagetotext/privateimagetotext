import {
  isFiniteRect,
  isInvertibleAffineMatrix,
  mapPolygon,
  polygonEnvelope,
  rectToPolygon,
  type AffineMatrix,
  type PixelQuad,
  type PixelRect,
} from "../image-editor/coordinates";
import type {
  EngineSectionWord,
  PixelPolygonMetadata,
  RecognitionSectionMetadata,
  RecognitionWordGeometry,
  RecognitionWordSpaceGeometry,
} from "./types";

function engineRect(word: EngineSectionWord): PixelRect {
  const rect = {
    x: word.bbox.x0,
    y: word.bbox.y0,
    width: word.bbox.x1 - word.bbox.x0,
    height: word.bbox.y1 - word.bbox.y0,
  };
  if (!isFiniteRect(rect) || rect.width <= 0 || rect.height <= 0) {
    throw new Error(
      "OCR word boxes must contain finite, strictly ordered pixel edges.",
    );
  }
  return rect;
}

function assertHierarchy(word: EngineSectionWord) {
  for (const index of [
    word.blockIndex,
    word.paragraphIndex,
    word.lineIndex,
    word.wordIndex,
  ]) {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new Error("OCR word hierarchy indices must be non-negative integers.");
    }
  }
}

function assertTransform(matrix: AffineMatrix, label: string) {
  if (!isInvertibleAffineMatrix(matrix)) {
    throw new Error(`${label} must be a finite invertible affine transform.`);
  }
}

function spaceGeometry<TSpace extends RecognitionWordSpaceGeometry["space"]>(
  space: TSpace,
  polygon: PixelQuad,
): RecognitionWordSpaceGeometry<TSpace> {
  return {
    space,
    polygon: polygon as PixelPolygonMetadata,
    envelope: polygonEnvelope(polygon),
  };
}

/**
 * Maps one engine-local Tesseract box through every retained inverse transform.
 * The four corners remain floating point; envelopes are derived only for
 * comparisons and never replace the transformed polygon.
 */
export function mapEngineSectionWord(
  word: EngineSectionWord,
  section: RecognitionSectionMetadata,
  orientedToSource: AffineMatrix,
): RecognitionWordGeometry {
  assertHierarchy(word);
  if (!section.id || !Number.isSafeInteger(section.index) || section.index < 0) {
    throw new Error("Recognition word sections require stable non-negative provenance.");
  }
  assertTransform(section.engineToPrepared, "Engine-to-prepared mapping");
  assertTransform(section.preparedToOriented, "Prepared-to-oriented mapping");
  assertTransform(orientedToSource, "Oriented-to-source mapping");

  const rect = engineRect(word);
  const enginePolygon = rectToPolygon(rect);
  const preparedPolygon = mapPolygon(
    section.engineToPrepared,
    enginePolygon,
  );
  const orientedPolygon = mapPolygon(
    section.preparedToOriented,
    preparedPolygon,
  );
  const sourcePolygon = mapPolygon(orientedToSource, orientedPolygon);

  return {
    text: word.text,
    confidence: word.confidence,
    blockIndex: word.blockIndex,
    paragraphIndex: word.paragraphIndex,
    lineIndex: word.lineIndex,
    wordIndex: word.wordIndex,
    sectionId: section.id,
    sectionIndex: section.index,
    engineSection: {
      ...spaceGeometry("engine-section", enginePolygon),
      rect: word.bbox,
    },
    preparedSection: spaceGeometry("prepared-section", preparedPolygon),
    orientedPage: spaceGeometry("oriented-page", orientedPolygon),
    sourceImage: spaceGeometry("source-image", sourcePolygon),
  };
}
