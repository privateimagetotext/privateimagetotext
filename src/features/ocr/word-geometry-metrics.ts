import {
  mapPoint,
  type AffineMatrix,
  type PixelPoint,
  type PixelRect,
} from "../image-editor/coordinates";

export type GeometryPolygon = readonly PixelPoint[];

export type GeometrySummary = {
  mean: number;
  median: number;
  percentile95: number;
  maximum: number;
};

export type ExpectedWordAnchor = {
  id: string;
  expectedToken: string;
  polygon: GeometryPolygon;
  critical: boolean;
  readingOrder: number;
};

export type ObservedWordAnchor = {
  text: string;
  polygon: GeometryPolygon;
  sourceOrder: number;
};

export type AnchorMatch = {
  expected: ExpectedWordAnchor;
  observed: ObservedWordAnchor;
  centreError: number;
};

export type DuplicateAnchor = {
  expectedAnchorId: string;
  observed: ObservedWordAnchor;
};

export type ExactAnchorAssociation = {
  matches: readonly AnchorMatch[];
  missing: readonly ExpectedWordAnchor[];
  duplicates: readonly DuplicateAnchor[];
  unmatchedObserved: readonly ObservedWordAnchor[];
};

export type ReadingOrderError = {
  earlierExpectedAnchorId: string;
  laterExpectedAnchorId: string;
};

export function rectCentre(rect: PixelRect): PixelPoint {
  assertFiniteRect(rect);
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

/** Returns the area centroid of a finite, non-degenerate polygon. */
export function polygonCentre(polygon: GeometryPolygon): PixelPoint {
  assertValidPolygon(polygon);

  let twiceArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    weightedX += (current.x + next.x) * cross;
    weightedY += (current.y + next.y) * cross;
  }
  return {
    x: weightedX / (3 * twiceArea),
    y: weightedY / (3 * twiceArea),
  };
}

export function euclideanCentreError(
  expected: GeometryPolygon | PixelRect,
  observed: GeometryPolygon | PixelRect,
) {
  const expectedCentre = isPolygon(expected)
    ? polygonCentre(expected)
    : rectCentre(expected);
  const observedCentre = isPolygon(observed)
    ? polygonCentre(observed)
    : rectCentre(observed);
  return Math.hypot(
    observedCentre.x - expectedCentre.x,
    observedCentre.y - expectedCentre.y,
  );
}

/**
 * Uses the mean length of opposite height edges for a four-corner word box.
 * Other polygons use their axis-aligned envelope height.
 */
export function expectedWordHeight(polygon: GeometryPolygon) {
  assertValidPolygon(polygon);
  if (polygon.length === 4) {
    const left = Math.hypot(
      polygon[3].x - polygon[0].x,
      polygon[3].y - polygon[0].y,
    );
    const right = Math.hypot(
      polygon[2].x - polygon[1].x,
      polygon[2].y - polygon[1].y,
    );
    return (left + right) / 2;
  }
  return axisAlignedEnvelope(polygon).height;
}

export function normalisedCentreError(
  expected: GeometryPolygon,
  observed: GeometryPolygon,
) {
  const height = expectedWordHeight(expected);
  if (!Number.isFinite(height) || height <= Number.EPSILON) {
    throw new Error("Expected word height must be a positive finite number.");
  }
  return euclideanCentreError(expected, observed) / height;
}

export function axisAlignedEnvelope(polygon: GeometryPolygon): PixelRect {
  assertValidPolygon(polygon);
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function envelopeIntersectionOverUnion(
  first: GeometryPolygon | PixelRect,
  second: GeometryPolygon | PixelRect,
) {
  const firstRect = isPolygon(first) ? axisAlignedEnvelope(first) : first;
  const secondRect = isPolygon(second) ? axisAlignedEnvelope(second) : second;
  assertFiniteRect(firstRect);
  assertFiniteRect(secondRect);
  const intersectionWidth = Math.max(
    0,
    Math.min(firstRect.x + firstRect.width, secondRect.x + secondRect.width) -
      Math.max(firstRect.x, secondRect.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(firstRect.y + firstRect.height, secondRect.y + secondRect.height) -
      Math.max(firstRect.y, secondRect.y),
  );
  const intersection = intersectionWidth * intersectionHeight;
  const union =
    firstRect.width * firstRect.height +
    secondRect.width * secondRect.height -
    intersection;
  return union <= 0 ? 0 : intersection / union;
}

function pointOnSegment(point: PixelPoint, start: PixelPoint, end: PixelPoint) {
  const squaredLength =
    (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (squaredLength <= Number.EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y) <= 1e-9;
  }
  const cross =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-9) return false;
  const dot =
    (point.x - start.x) * (end.x - start.x) +
    (point.y - start.y) * (end.y - start.y);
  if (dot < 0) return false;
  return dot <= squaredLength;
}

/** Boundary points count as contained. */
export function containsPoint(
  polygon: GeometryPolygon,
  point: PixelPoint,
) {
  assertValidPolygon(polygon);
  assertFinitePoint(point);
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous];
    const end = polygon[index];
    if (pointOnSegment(point, start, end)) return true;
    const crosses =
      start.y > point.y !== end.y > point.y &&
      point.x <
        ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) +
          start.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Associates only byte-for-byte equal tokens. Repeated tokens are paired by
 * minimum centre distance without collapsing legitimate spatial repeats.
 */
export function associateExactTokens(
  expected: readonly ExpectedWordAnchor[],
  observed: readonly ObservedWordAnchor[],
): ExactAnchorAssociation {
  expected.forEach((anchor) => assertValidPolygon(anchor.polygon));
  observed.forEach((word) => assertValidPolygon(word.polygon));
  const expectedIndexes = new Map<string, number[]>();
  for (const [index, anchor] of expected.entries()) {
    const indexes = expectedIndexes.get(anchor.expectedToken) ?? [];
    indexes.push(index);
    expectedIndexes.set(anchor.expectedToken, indexes);
  }

  const assignedExpected = new Set<number>();
  const assignedObserved = new Set<number>();
  const matches: AnchorMatch[] = [];
  for (const [token, tokenExpectedIndexes] of expectedIndexes) {
    const tokenObservedIndexes = observed
      .map((word, index) => ({ word, index }))
      .filter(({ word }) => word.text === token)
      .map(({ index }) => index);
    for (const candidate of minimumCostTokenPairs(
      tokenExpectedIndexes,
      tokenObservedIndexes,
      expected,
      observed,
    )) {
      assignedExpected.add(candidate.expectedIndex);
      assignedObserved.add(candidate.observedIndex);
      matches.push({
        expected: expected[candidate.expectedIndex],
        observed: observed[candidate.observedIndex],
        centreError: candidate.centreError,
      });
    }
  }

  const missing = expected.filter((_, index) => !assignedExpected.has(index));
  const duplicates: DuplicateAnchor[] = [];
  const unmatchedObserved: ObservedWordAnchor[] = [];
  for (const [observedIndex, word] of observed.entries()) {
    if (assignedObserved.has(observedIndex)) continue;
    const possibleExpected = expected
      .filter((anchor) => anchor.expectedToken === word.text)
      .map((anchor) => ({
        anchor,
        distance: euclideanCentreError(anchor.polygon, word.polygon),
      }))
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          left.anchor.readingOrder - right.anchor.readingOrder,
      );
    if (possibleExpected.length > 0) {
      duplicates.push({
        expectedAnchorId: possibleExpected[0].anchor.id,
        observed: word,
      });
    } else {
      unmatchedObserved.push(word);
    }
  }

  matches.sort(
    (left, right) =>
      left.expected.readingOrder - right.expected.readingOrder,
  );
  return { matches, missing, duplicates, unmatchedObserved };
}

type IndexedAnchorPair = {
  expectedIndex: number;
  observedIndex: number;
  centreError: number;
};

/** Minimum-cost maximum-cardinality assignment for one exact token. */
function minimumCostTokenPairs(
  expectedIndexes: readonly number[],
  observedIndexes: readonly number[],
  expected: readonly ExpectedWordAnchor[],
  observed: readonly ObservedWordAnchor[],
): readonly IndexedAnchorPair[] {
  if (expectedIndexes.length === 0 || observedIndexes.length === 0) return [];

  const rowsAreExpected = expectedIndexes.length <= observedIndexes.length;
  const rowIndexes = rowsAreExpected ? expectedIndexes : observedIndexes;
  const columnIndexes = rowsAreExpected ? observedIndexes : expectedIndexes;
  const costs = rowIndexes.map((rowIndex) =>
    columnIndexes.map((columnIndex) => {
      const expectedIndex = rowsAreExpected ? rowIndex : columnIndex;
      const observedIndex = rowsAreExpected ? columnIndex : rowIndex;
      const cost = euclideanCentreError(
        expected[expectedIndex].polygon,
        observed[observedIndex].polygon,
      );
      if (!Number.isFinite(cost)) {
        throw new Error("Anchor centre distances must be finite.");
      }
      return cost;
    }),
  );

  // Rectangular Hungarian assignment. The smaller side is always the row side,
  // so every possible match is retained while total centre error is minimised.
  const rowPotentials = Array(rowIndexes.length + 1).fill(0) as number[];
  const columnPotentials = Array(columnIndexes.length + 1).fill(0) as number[];
  const matchedRowByColumn = Array(columnIndexes.length + 1).fill(0) as number[];
  const predecessorColumn = Array(columnIndexes.length + 1).fill(0) as number[];

  for (let row = 1; row <= rowIndexes.length; row += 1) {
    matchedRowByColumn[0] = row;
    const minimumReducedCost = Array(columnIndexes.length + 1).fill(
      Number.POSITIVE_INFINITY,
    ) as number[];
    const usedColumn = Array(columnIndexes.length + 1).fill(false) as boolean[];
    let currentColumn = 0;
    do {
      usedColumn[currentColumn] = true;
      const currentRow = matchedRowByColumn[currentColumn];
      let delta = Number.POSITIVE_INFINITY;
      let nextColumn = 0;
      for (let column = 1; column <= columnIndexes.length; column += 1) {
        if (usedColumn[column]) continue;
        const reducedCost =
          costs[currentRow - 1][column - 1] -
          rowPotentials[currentRow] -
          columnPotentials[column];
        if (reducedCost < minimumReducedCost[column]) {
          minimumReducedCost[column] = reducedCost;
          predecessorColumn[column] = currentColumn;
        }
        if (minimumReducedCost[column] < delta) {
          delta = minimumReducedCost[column];
          nextColumn = column;
        }
      }
      for (let column = 0; column <= columnIndexes.length; column += 1) {
        if (usedColumn[column]) {
          rowPotentials[matchedRowByColumn[column]] += delta;
          columnPotentials[column] -= delta;
        } else {
          minimumReducedCost[column] -= delta;
        }
      }
      currentColumn = nextColumn;
    } while (matchedRowByColumn[currentColumn] !== 0);

    do {
      const previousColumn = predecessorColumn[currentColumn];
      matchedRowByColumn[currentColumn] = matchedRowByColumn[previousColumn];
      currentColumn = previousColumn;
    } while (currentColumn !== 0);
  }

  return matchedRowByColumn
    .map((matchedRow, column) => ({ matchedRow, column }))
    .filter(({ matchedRow, column }) => column > 0 && matchedRow > 0)
    .map(({ matchedRow, column }) => {
      const rowIndex = rowIndexes[matchedRow - 1];
      const columnIndex = columnIndexes[column - 1];
      const expectedIndex = rowsAreExpected ? rowIndex : columnIndex;
      const observedIndex = rowsAreExpected ? columnIndex : rowIndex;
      return {
        expectedIndex,
        observedIndex,
        centreError: costs[matchedRow - 1][column - 1],
      };
    });
}

/** Reports every inversion in the observed order of matched anchors. */
export function readingOrderErrors(
  matches: readonly AnchorMatch[],
): readonly ReadingOrderError[] {
  const observedOrder = [...matches].sort(
    (left, right) => left.observed.sourceOrder - right.observed.sourceOrder,
  );
  const errors: ReadingOrderError[] = [];
  for (let left = 0; left < observedOrder.length; left += 1) {
    for (let right = left + 1; right < observedOrder.length; right += 1) {
      if (
        observedOrder[left].expected.readingOrder >
        observedOrder[right].expected.readingOrder
      ) {
        errors.push({
          earlierExpectedAnchorId: observedOrder[right].expected.id,
          laterExpectedAnchorId: observedOrder[left].expected.id,
        });
      }
    }
  }
  return errors;
}

export function matrixRoundTripError(
  forward: AffineMatrix,
  inverse: AffineMatrix,
  points: readonly PixelPoint[],
) {
  assertFiniteNonSingularMatrix(forward);
  assertFiniteNonSingularMatrix(inverse);
  if (points.length === 0) return 0;
  return Math.max(
    ...points.map((point) => {
      assertFinitePoint(point);
      const roundTrip = mapPoint(inverse, mapPoint(forward, point));
      return Math.hypot(roundTrip.x - point.x, roundTrip.y - point.y);
    }),
  );
}

export function assertFiniteNonSingularMatrix(matrix: AffineMatrix) {
  if (!matrix.every(Number.isFinite)) {
    throw new Error("Affine matrix values must be finite.");
  }
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON) {
    throw new Error("Affine matrix must be non-singular.");
  }
}

export function summariseGeometryValues(
  values: readonly number[],
): GeometrySummary {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Geometry summaries require finite values.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  const percentileIndex = Math.max(
    0,
    Math.ceil(sorted.length * 0.95) - 1,
  );
  return {
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median,
    percentile95: sorted[percentileIndex],
    maximum: sorted.at(-1) ?? 0,
  };
}

function assertFinitePoint(point: PixelPoint) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error("Geometry points must be finite.");
  }
}

function isPolygon(
  geometry: GeometryPolygon | PixelRect,
): geometry is GeometryPolygon {
  return Array.isArray(geometry);
}

function assertValidPolygon(polygon: GeometryPolygon) {
  polygon.forEach(assertFinitePoint);
  if (polygon.length < 3) {
    throw new Error("Geometry polygons must contain at least three points.");
  }
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) <= Number.EPSILON) {
    throw new Error("Geometry polygons must be finite and non-degenerate.");
  }
}

function assertFiniteRect(rect: PixelRect) {
  assertFinitePoint(rect);
  if (
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    throw new Error("Geometry rectangles must have finite non-negative dimensions.");
  }
}
