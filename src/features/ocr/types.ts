export type WorkflowStatus =
  | "idle"
  | "decoding"
  | "imageReady"
  | "editingImage"
  | "loadingOcr"
  | "recognising"
  | "complete"
  | "cancelled"
  | "error";

export type EnhancementPreset =
  | "original"
  | "document"
  | "adaptive-document"
  | "high-contrast"
  | "inverted";

export type OcrContentMode =
  | "document"
  | "columns"
  | "screenshot"
  | "code"
  | "sparse"
  | "single-line";

export type ResultView = "raw" | "cleaned" | "markdown" | "edited";

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageTransform = {
  rotation: 0 | 90 | 180 | 270;
  crop: CropRect;
  preset: EnhancementPreset;
};

export type ImageSource = {
  intakeSource?: "file" | "clipboard" | "sample";
  file: File;
  objectUrl: string;
  name: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  willDownscale: boolean;
};

export type OcrProgress = {
  stage: string;
  value: number | null;
  phase?: "loading-assets" | "preparing" | "recognising" | "combining";
  currentSection?: number;
  totalSections?: number;
};

export type ThresholdingMethod = 0 | 1 | 2;

export type PreparationMetadata = {
  scale: number;
  /** Exact horizontal prepared/oriented ratio after integer canvas rounding. */
  scaleX: number;
  /** Exact vertical prepared/oriented ratio after integer canvas rounding. */
  scaleY: number;
  scaleAction: "original" | "enlarged" | "reduced";
  profile: EnhancementPreset;
  thresholdingMethod: ThresholdingMethod;
  polarityInverted: boolean;
  sourceWidth: number;
  sourceHeight: number;
  preparedWidth: number;
  preparedHeight: number;
  adaptivePlan?: {
    low: number;
    high: number;
    stretchApplied: boolean;
    polarityInverted: boolean;
  };
};

export type PixelPointMetadata = {
  x: number;
  y: number;
};

/**
 * A rectangle expressed with pixel-edge coordinates. `x1` and `y1` are the
 * right and bottom edges and are exclusive for an untransformed raster box.
 */
export type PixelEdgeRectMetadata = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/** Four transformed rectangle corners in source-corner order. */
export type PixelPolygonMetadata = readonly [
  PixelPointMetadata,
  PixelPointMetadata,
  PixelPointMetadata,
  PixelPointMetadata,
];

/** A half-open axis-aligned pixel-edge rectangle. */
export type PixelRectMetadata = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PixelSizeMetadata = {
  width: number;
  height: number;
};

export type RecognitionWordHierarchyMetadata = {
  blockIndex: number;
  paragraphIndex: number;
  lineIndex: number;
  wordIndex: number;
};

/** Minimal optional Tesseract word output, still local to one engine section. */
export type EngineSectionWord = RecognitionWordHierarchyMetadata & {
  text: string;
  confidence: number | null;
  /** Engine-section pixel edges, after any Tesseract fine rotation. */
  bbox: PixelEdgeRectMetadata;
};

export type OcrLine = {
  text: string;
  confidence: number | null;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  blockIndex: number;
  paragraphIndex: number;
  lineIndex: number;
};

export type RecognitionRequest = {
  languages?: readonly string[];
  contentMode: OcrContentMode;
  autoDeskew: boolean;
  thresholdingMethod: ThresholdingMethod;
  includeWords?: boolean;
  includeLines?: boolean;
  /** Optional bounded-section layout override; ordinary runs keep mode defaults. */
  pageSegmentation?: "mode-default" | "single-block";
};

export type RecognitionResponse = {
  text: string;
  confidence: number | null;
  rotateRadians: number;
  words?: readonly EngineSectionWord[];
  lines?: readonly OcrLine[];
};

/** Canvas-style affine tuple: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type AffineMatrixMetadata = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export type RecognitionCoordinateMetadata = {
  version: 1;
  sourceSize: PixelSizeMetadata;
  sourceCrop: PixelRectMetadata;
  orientedPageSize: PixelSizeMetadata;
  sourceToOriented: AffineMatrixMetadata;
  orientedToSource: AffineMatrixMetadata;
};

export type RecognitionSectionMetadata = {
  id: string;
  index: number;
  inputRect: PixelRectMetadata;
  coreRect: PixelRectMetadata;
  preparedSize: PixelSizeMetadata;
  orientedToPrepared: AffineMatrixMetadata;
  preparedToOriented: AffineMatrixMetadata;
  preparedToEngine: AffineMatrixMetadata;
  engineToPrepared: AffineMatrixMetadata;
  rotateRadians: number;
  thresholdingMethod: ThresholdingMethod;
  polarityInverted: boolean;
};

export type RecognitionWordCoordinateSpaceName =
  | "engine-section"
  | "prepared-section"
  | "oriented-page"
  | "source-image";

export type RecognitionWordSpaceGeometry<
  TSpace extends RecognitionWordCoordinateSpaceName = RecognitionWordCoordinateSpaceName,
> = {
  space: TSpace;
  polygon: PixelPolygonMetadata;
  envelope: PixelRectMetadata;
};

/**
 * One recognised word mapped through every coordinate space needed by future
 * geometry consumers. Section and hierarchy indices are provenance only; they
 * do not imply text-based deduplication or a visible overlay.
 */
export type RecognitionWordGeometry = RecognitionWordHierarchyMetadata & {
  text: string;
  confidence: number | null;
  sectionId: string;
  sectionIndex: number;
  engineSection: RecognitionWordSpaceGeometry<"engine-section"> & {
    /** Exact Tesseract rectangle before any inverse coordinate mapping. */
    rect: PixelEdgeRectMetadata;
  };
  preparedSection: RecognitionWordSpaceGeometry<"prepared-section">;
  orientedPage: RecognitionWordSpaceGeometry<"oriented-page">;
  sourceImage: RecognitionWordSpaceGeometry<"source-image">;
};

export type RecognitionSummary = {
  strategy: "single-canvas" | "vertical-tiles";
  sourceDetail: "original" | "reduced" | "enlarged";
  sectionCount: number;
  totalPreparedPixels: number;
  peakPreparedSize: PixelSizeMetadata;
  coordinates: RecognitionCoordinateMetadata;
  sections: readonly RecognitionSectionMetadata[];
};

export type OcrResult = {
  languages?: readonly string[];
  raw: string;
  cleaned: string;
  markdown: string;
  edited: string;
  confidence: number | null;
  elapsedMs: number;
  rotateRadians: number;
  preparation: PreparationMetadata;
  recognition: RecognitionSummary;
  words?: readonly RecognitionWordGeometry[];
};

export type OcrErrorType =
  | "asset-load"
  | "image-decode"
  | "initialisation"
  | "recognition"
  | "clipboard"
  | "download"
  | "unsupported";

export type OcrError = {
  type: OcrErrorType;
  message: string;
};

export type OcrState = {
  defaultsApplied: boolean;
  suggestedContentMode: OcrContentMode | null;
  status: WorkflowStatus;
  currentOperationId: number;
  image: ImageSource | null;
  transform: ImageTransform;
  contentMode: OcrContentMode;
  preparation: PreparationMetadata | null;
  progress: OcrProgress | null;
  result: OcrResult | null;
  resultView: ResultView;
  error: OcrError | null;
};

export const fullCrop: CropRect = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

export const defaultTransform: ImageTransform = {
  rotation: 0,
  crop: fullCrop,
  preset: "original",
};

export const initialOcrState: OcrState = {
  defaultsApplied: false,
  suggestedContentMode: null,
  status: "idle",
  currentOperationId: 0,
  image: null,
  transform: defaultTransform,
  contentMode: "document",
  preparation: null,
  progress: null,
  result: null,
  resultView: "cleaned",
  error: null,
};
