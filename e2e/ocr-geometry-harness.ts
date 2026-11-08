import {
  clearCanvas,
  readImageDimensions,
  renderWorkingImage,
} from "../src/features/image-editor/image";
import { runRecognition } from "../src/features/ocr/recognition-runner";
import { LocalTesseractAdapter } from "../src/features/ocr/tesseract-adapter";
import type {
  EnhancementPreset,
  ImageTransform,
  OcrContentMode,
  RecognitionRequest,
  RecognitionSectionMetadata,
  RecognitionWordGeometry,
} from "../src/features/ocr/types";

export type GeometryHarnessFixture = {
  id: string;
  image: string;
  sourceSize: { width: number; height: number };
  crop: {
    normalised: ImageTransform["crop"];
    sourcePixelEdges: { x: number; y: number; width: number; height: number };
  };
  manualRotation: ImageTransform["rotation"];
  fineSkewDegrees: number;
  contentMode: OcrContentMode;
  enhancementPreset: EnhancementPreset;
  expectedTilingStrategy: "single-canvas" | "vertical-tiles";
};

export type HarnessWordGeometry = RecognitionWordGeometry;

export type HarnessWordSection = RecognitionSectionMetadata & {
  recognitionRequest: RecognitionRequest;
};

function recognitionRequestForSection(
  fixture: GeometryHarnessFixture,
  strategy: "single-canvas" | "vertical-tiles",
  thresholdingMethod: 0 | 1 | 2,
): RecognitionRequest {
  if (strategy === "vertical-tiles") {
    return {
      contentMode: fixture.contentMode,
      autoDeskew: true,
      thresholdingMethod,
      includeWords: true,
      includeLines: true,
      pageSegmentation: "single-block",
    };
  }
  return {
    contentMode: fixture.contentMode,
    autoDeskew:
      fixture.enhancementPreset === "adaptive-document" &&
      fixture.contentMode !== "single-line",
    thresholdingMethod,
    includeWords: true,
    includeLines: fixture.enhancementPreset === "adaptive-document",
  };
}

export async function runGeometryFixtures(
  fixtures: readonly GeometryHarnessFixture[],
) {
  const adapter = new LocalTesseractAdapter();
  const results = [];
  try {
    for (const fixture of fixtures) {
      const response = await fetch(
        `/e2e/fixtures/ocr-geometry/${encodeURIComponent(fixture.image)}`,
      );
      if (!response.ok) {
        throw new Error(`Could not load geometry fixture ${fixture.image}.`);
      }
      const blob = await response.blob();
      const decodedSize = await readImageDimensions(blob);
      if (
        decodedSize.width !== fixture.sourceSize.width ||
        decodedSize.height !== fixture.sourceSize.height
      ) {
        throw new Error(`Geometry fixture dimensions changed for ${fixture.id}.`);
      }
      const file = new File([blob], fixture.image, { type: "image/png" });
      const transform: ImageTransform = {
        rotation: fixture.manualRotation,
        crop: fixture.crop.normalised,
        preset: fixture.enhancementPreset,
      };
      const prepared = await renderWorkingImage(file, transform);
      const started = performance.now();
      try {
        const recognised = await runRecognition({
          adapter,
          file,
          sourceWidth: fixture.sourceSize.width,
          sourceHeight: fixture.sourceSize.height,
          sourceFileBytes: file.size,
          transform,
          contentMode: fixture.contentMode,
          previewCanvas: prepared.canvas,
          previewPreparation: prepared.metadata,
          signal: new AbortController().signal,
          onProgress: () => {},
          includeWordGeometry: true,
        });
        const recognitionRequest = recognitionRequestForSection(
          fixture,
          recognised.recognition.strategy,
          prepared.metadata.thresholdingMethod,
        );
        results.push({
          id: fixture.id,
          runtimeMs: performance.now() - started,
          preparation: prepared.metadata,
          raw: recognised.raw,
          runnerRotateRadians: recognised.rotateRadians,
          recognition: recognised.recognition,
          wordSections: recognised.recognition.sections.map((section) => ({
            ...section,
            recognitionRequest,
          })),
          words: recognised.words ?? [],
        });
      } finally {
        clearCanvas(prepared.canvas);
      }
    }
  } finally {
    await adapter.dispose();
  }
  return results;
}
