/**
 * Coordinate-space contract for future tiled OCR and word geometry.
 *
 * Source image pixels --crop/quarter-turn--> oriented crop pixels
 * --tile/scale--> prepared tile pixels --fine rotation--> recognition pixels.
 * Rectangles describe pixel edges, so a 5-pixel-wide image spans x = 0..5.
 * Every step has an invertible matrix; callers should retain the exact matrix
 * instead of reconstructing geometry from rounded dimensions or nominal scale.
 */

/**
 * A point in a named pixel coordinate space.
 *
 * Original raster edges are integers, but affine mapping intentionally retains
 * floating-point coordinates instead of rounding transformed geometry.
 */
export type PixelPoint = Readonly<{
  x: number;
  y: number;
}>;

/** The extent of a pixel coordinate space. */
export type PixelSize = Readonly<{
  width: number;
  height: number;
}>;

/** An axis-aligned rectangle expressed using pixel-edge coordinates. */
export type PixelRect = PixelPoint & PixelSize;

/** A floating-point polygon in one named pixel coordinate space. */
export type PixelPolygon = readonly PixelPoint[];

/**
 * The four corners of a rectangle in perimeter order. Transforming the quad
 * preserves the word shape even when its axis-aligned envelope becomes larger.
 */
export type PixelQuad = readonly [
  PixelPoint,
  PixelPoint,
  PixelPoint,
  PixelPoint,
];

/**
 * A two-dimensional affine matrix in Canvas/DOMMatrix order.
 *
 * A point is mapped as:
 *
 *   x' = a * x + c * y + e
 *   y' = b * x + d * y + f
 */
export type AffineMatrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

export type ManualRotation = 0 | 90 | 180 | 270;

export function isFinitePoint(point: PixelPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function isFiniteRect(rect: PixelRect) {
  return (
    isFinitePoint(rect) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

export function isFinitePolygon(polygon: PixelPolygon) {
  return polygon.length >= 3 && polygon.every(isFinitePoint);
}

export function isFiniteAffineMatrix(matrix: AffineMatrix) {
  return matrix.every(Number.isFinite);
}

export function isInvertibleAffineMatrix(matrix: AffineMatrix) {
  if (!isFiniteAffineMatrix(matrix)) return false;
  const [a, b, c, d] = matrix;
  const determinant = a * d - b * c;
  return (
    Number.isFinite(determinant) &&
    Math.abs(determinant) > Number.EPSILON
  );
}

export function identity(): AffineMatrix {
  return [1, 0, 0, 1, 0, 0];
}

export function translation(x: number, y: number): AffineMatrix {
  return [1, 0, 0, 1, x, y];
}

export function scaling(scaleX: number, scaleY = scaleX): AffineMatrix {
  return [scaleX, 0, 0, scaleY, 0, 0];
}

/**
 * Composes matrices in the order that coordinate spaces are traversed.
 * `compose(sourceToCrop, cropToPrepared)` applies `sourceToCrop` first and
 * `cropToPrepared` second. An empty composition is the identity transform.
 */
export function compose(...matrices: readonly AffineMatrix[]): AffineMatrix {
  return matrices.reduce<AffineMatrix>((first, second) => {
    assertFiniteAffineMatrix(first);
    assertFiniteAffineMatrix(second);
    const [a1, b1, c1, d1, e1, f1] = first;
    const [a2, b2, c2, d2, e2, f2] = second;
    const composed: AffineMatrix = [
      a2 * a1 + c2 * b1,
      b2 * a1 + d2 * b1,
      a2 * c1 + c2 * d1,
      b2 * c1 + d2 * d1,
      a2 * e1 + c2 * f1 + e2,
      b2 * e1 + d2 * f1 + f2,
    ];
    assertFiniteAffineMatrix(composed);
    return composed;
  }, identity());
}

export function invert(matrix: AffineMatrix): AffineMatrix {
  assertFiniteAffineMatrix(matrix);
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (
    !Number.isFinite(determinant) ||
    Math.abs(determinant) <= Number.EPSILON
  ) {
    throw new Error("The affine transform is not invertible.");
  }

  const inverse: AffineMatrix = [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
  assertFiniteAffineMatrix(inverse);
  return inverse;
}

export function mapPoint(
  matrix: AffineMatrix,
  point: PixelPoint,
): PixelPoint {
  assertFiniteAffineMatrix(matrix);
  assertFinitePoint(point);
  const [a, b, c, d, e, f] = matrix;
  const mapped = {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f,
  };
  assertFinitePoint(mapped);
  return mapped;
}

/** Returns rectangle corners clockwise from the top-left pixel edge. */
export function rectToPolygon(rect: PixelRect): PixelQuad {
  assertFiniteRect(rect);
  const polygon: PixelQuad = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  assertFinitePolygon(polygon);
  return polygon;
}

export function mapPolygon(
  matrix: AffineMatrix,
  polygon: PixelQuad,
): PixelQuad;
export function mapPolygon(
  matrix: AffineMatrix,
  polygon: PixelPolygon,
): PixelPolygon;
export function mapPolygon(
  matrix: AffineMatrix,
  polygon: PixelPolygon,
): PixelPolygon {
  assertFiniteAffineMatrix(matrix);
  assertFinitePolygon(polygon);
  return polygon.map((point) => mapPoint(matrix, point));
}

/** Returns the axis-aligned envelope without replacing the source polygon. */
export function polygonEnvelope(polygon: PixelPolygon): PixelRect {
  assertFinitePolygon(polygon);
  let left = polygon[0].x;
  let top = polygon[0].y;
  let right = left;
  let bottom = top;

  for (const point of polygon.slice(1)) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }

  const envelope = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
  assertFiniteRect(envelope);
  return envelope;
}

/** Maps every corner and returns the axis-aligned envelope in the new space. */
export function mapRectEnvelope(
  matrix: AffineMatrix,
  rect: PixelRect,
): PixelRect {
  return polygonEnvelope(mapPolygon(matrix, rectToPolygon(rect)));
}

/**
 * Returns a Canvas-compatible rotation about `center`. With screen coordinates
 * (positive y points down), a positive angle appears clockwise.
 */
export function rotationAroundCenter(
  radians: number,
  center: PixelPoint,
): AffineMatrix {
  if (!Number.isFinite(radians)) {
    throw new Error("The rotation angle must be a finite number.");
  }
  assertFinitePoint(center);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return compose(
    translation(-center.x, -center.y),
    [cosine, sine, -sine, cosine, 0, 0],
    translation(center.x, center.y),
  );
}

export function orientedSize(
  sourceCropSize: PixelSize,
  rotation: ManualRotation,
): PixelSize {
  assertPositiveSize(sourceCropSize, "Source crop");
  return rotation === 90 || rotation === 270
    ? { width: sourceCropSize.height, height: sourceCropSize.width }
    : { width: sourceCropSize.width, height: sourceCropSize.height };
}

/**
 * Maps source-image pixel edges into the positive, quarter-turn-oriented crop
 * space. `sourceCrop` must contain the exact integer edges used to render the
 * crop; coordinates are not reconstructed from percentages.
 */
export function sourceToOrientedTransform(
  sourceCrop: PixelRect,
  rotation: ManualRotation,
): AffineMatrix {
  assertIntegerSourceCrop(sourceCrop);
  const sourceToCrop = translation(-sourceCrop.x, -sourceCrop.y);
  const width = sourceCrop.width;
  const height = sourceCrop.height;

  const cropToOriented: AffineMatrix =
    rotation === 0
      ? identity()
      : rotation === 90
        ? [0, 1, -1, 0, height, 0]
        : rotation === 180
          ? [-1, 0, 0, -1, width, height]
          : [0, -1, 1, 0, 0, width];

  return compose(sourceToCrop, cropToOriented);
}

/**
 * Maps the full oriented crop to its prepared canvas. The independent ratios
 * preserve exact geometry when integer canvas rounding makes scaleX != scaleY.
 */
export function orientedToPreparedTransform(
  sourceSize: PixelSize,
  preparedSize: PixelSize,
): AffineMatrix {
  assertPositiveSize(sourceSize, "Oriented source");
  assertPositiveSize(preparedSize, "Prepared canvas");
  return scaling(
    preparedSize.width / sourceSize.width,
    preparedSize.height / sourceSize.height,
  );
}

/**
 * Maps an oriented-space tile rectangle to a zero-origin prepared tile canvas.
 * This is the tiled equivalent of `orientedToPreparedTransform` and likewise
 * uses the exact horizontal and vertical ratios after canvas rounding.
 */
export function orientedToPreparedTileTransform(
  orientedTile: PixelRect,
  preparedTileSize: PixelSize,
): AffineMatrix {
  assertFiniteRect(orientedTile);
  assertPositiveSize(orientedTile, "Oriented tile");
  assertPositiveSize(preparedTileSize, "Prepared tile");
  return compose(
    translation(-orientedTile.x, -orientedTile.y),
    scaling(
      preparedTileSize.width / orientedTile.width,
      preparedTileSize.height / orientedTile.height,
    ),
  );
}

/** Maps a prepared tile into Tesseract's same-size fine-rotated tile space. */
export function fineRotationAroundTileCenter(
  radians: number,
  tileSize: PixelSize,
): AffineMatrix {
  assertPositiveSize(tileSize, "Prepared tile");
  return rotationAroundCenter(radians, {
    x: tileSize.width / 2,
    y: tileSize.height / 2,
  });
}

function assertPositiveSize(size: PixelSize, label: string) {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new Error(`${label} dimensions must be positive finite numbers.`);
  }
}

function assertFinitePoint(point: PixelPoint) {
  if (!isFinitePoint(point)) {
    throw new Error("Pixel coordinates must be finite numbers.");
  }
}

function assertFiniteRect(rect: PixelRect) {
  if (!isFiniteRect(rect)) {
    throw new Error("Pixel rectangle coordinates and dimensions must be finite numbers.");
  }
}

function assertFinitePolygon(polygon: PixelPolygon) {
  if (polygon.length < 3) {
    throw new Error("A pixel polygon must contain at least three points.");
  }
  if (!polygon.every(isFinitePoint)) {
    throw new Error("Pixel polygon coordinates must be finite numbers.");
  }
}

function assertFiniteAffineMatrix(matrix: AffineMatrix) {
  if (!isFiniteAffineMatrix(matrix)) {
    throw new Error("The affine transform must contain only finite numbers.");
  }
}

function assertIntegerSourceCrop(crop: PixelRect) {
  assertPositiveSize(crop, "Source crop");
  if (
    !Number.isInteger(crop.x) ||
    !Number.isInteger(crop.y) ||
    !Number.isInteger(crop.width) ||
    !Number.isInteger(crop.height)
  ) {
    throw new Error("Source crop edges must be integers.");
  }
}
