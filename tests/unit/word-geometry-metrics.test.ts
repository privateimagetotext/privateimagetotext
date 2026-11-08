import { describe, expect, it } from "vitest";

import {
  associateExactTokens,
  axisAlignedEnvelope,
  containsPoint,
  envelopeIntersectionOverUnion,
  euclideanCentreError,
  expectedWordHeight,
  matrixRoundTripError,
  normalisedCentreError,
  polygonCentre,
  readingOrderErrors,
  rectCentre,
  summariseGeometryValues,
} from "../../src/features/ocr/word-geometry-metrics";

const box = (x: number, y: number, width = 10, height = 4) => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
] as const;

describe("word geometry metrics", () => {
  it("calculates rectangle and polygon centres", () => {
    expect(rectCentre({ x: 4, y: 8, width: 10, height: 6 })).toEqual({
      x: 9,
      y: 11,
    });
    expect(polygonCentre(box(4, 8, 10, 6))).toEqual({ x: 9, y: 11 });
  });

  it("measures source-pixel and height-normalised centre error", () => {
    expect(euclideanCentreError(box(0, 0), box(3, 4))).toBe(5);
    expect(expectedWordHeight(box(0, 0))).toBe(4);
    expect(normalisedCentreError(box(0, 0), box(3, 4))).toBe(1.25);
  });

  it("uses axis-aligned envelopes for IoU", () => {
    expect(axisAlignedEnvelope(box(2, 3))).toEqual({
      x: 2,
      y: 3,
      width: 10,
      height: 4,
    });
    expect(envelopeIntersectionOverUnion(box(0, 0), box(5, 0))).toBeCloseTo(
      1 / 3,
    );
    expect(envelopeIntersectionOverUnion(box(0, 0), box(20, 0))).toBe(0);
  });

  it("contains interior and boundary points but rejects exterior points", () => {
    const polygon = box(2, 3);
    expect(containsPoint(polygon, { x: 7, y: 5 })).toBe(true);
    expect(containsPoint(polygon, { x: 2, y: 3 })).toBe(true);
    expect(containsPoint(polygon, { x: 1.99, y: 5 })).toBe(false);
  });

  it("associates exact repeated tokens spatially and reports extras", () => {
    const expected = [
      {
        id: "first-repeat",
        expectedToken: "REPEAT88",
        polygon: box(0, 0),
        critical: true,
        readingOrder: 0,
      },
      {
        id: "unique",
        expectedToken: "UNIQUE11",
        polygon: box(0, 20),
        critical: true,
        readingOrder: 1,
      },
      {
        id: "second-repeat",
        expectedToken: "REPEAT88",
        polygon: box(0, 40),
        critical: true,
        readingOrder: 2,
      },
    ];
    const observed = [
      { text: "REPEAT88", polygon: box(1, 41), sourceOrder: 2 },
      { text: "REPEAT88", polygon: box(1, 1), sourceOrder: 0 },
      { text: "REPEAT88", polygon: box(2, 2), sourceOrder: 1 },
      { text: "NOISE", polygon: box(0, 60), sourceOrder: 3 },
    ];
    const association = associateExactTokens(expected, observed);

    expect(association.matches.map((match) => match.expected.id)).toEqual([
      "first-repeat",
      "second-repeat",
    ]);
    expect(association.missing.map((anchor) => anchor.id)).toEqual(["unique"]);
    expect(association.duplicates).toHaveLength(1);
    expect(association.duplicates[0].expectedAnchorId).toBe("first-repeat");
    expect(association.unmatchedObserved.map((word) => word.text)).toEqual([
      "NOISE",
    ]);
  });

  it("minimises total distance when repeated-token greedy matching is suboptimal", () => {
    const expected = [
      {
        id: "left",
        expectedToken: "REPEAT",
        polygon: box(0, 0),
        critical: true,
        readingOrder: 0,
      },
      {
        id: "right",
        expectedToken: "REPEAT",
        polygon: box(10, 0),
        critical: true,
        readingOrder: 1,
      },
    ];
    const observed = [
      { text: "REPEAT", polygon: box(6, 0), sourceOrder: 0 },
      { text: "REPEAT", polygon: box(100, 0), sourceOrder: 1 },
    ];

    const association = associateExactTokens(expected, observed);

    expect(
      association.matches.map((match) => ({
        expected: match.expected.id,
        observedX: polygonCentre(match.observed.polygon).x,
      })),
    ).toEqual([
      { expected: "left", observedX: 11 },
      { expected: "right", observedX: 105 },
    ]);
    expect(
      association.matches.reduce((sum, match) => sum + match.centreError, 0),
    ).toBe(96);
  });

  it("reports exact-token reading-order inversions", () => {
    const expected = [
      {
        id: "first",
        expectedToken: "FIRST",
        polygon: box(0, 0),
        critical: true,
        readingOrder: 0,
      },
      {
        id: "second",
        expectedToken: "SECOND",
        polygon: box(0, 20),
        critical: true,
        readingOrder: 1,
      },
    ];
    const association = associateExactTokens(expected, [
      { text: "FIRST", polygon: box(0, 0), sourceOrder: 2 },
      { text: "SECOND", polygon: box(0, 20), sourceOrder: 1 },
    ]);
    expect(readingOrderErrors(association.matches)).toEqual([
      {
        earlierExpectedAnchorId: "first",
        laterExpectedAnchorId: "second",
      },
    ]);
  });

  it("measures affine round trips and rejects invalid geometry", () => {
    const forward = [2, 0, 0, 3, 7, -5] as const;
    const inverse = [0.5, 0, 0, 1 / 3, -3.5, 5 / 3] as const;
    expect(
      matrixRoundTripError(forward, inverse, [
        { x: 0, y: 0 },
        { x: 11.25, y: -7.5 },
      ]),
    ).toBeLessThan(1e-12);
    expect(() =>
      matrixRoundTripError([1, 0, 0, 0, 0, 0], inverse, [{ x: 0, y: 0 }]),
    ).toThrow(/non-singular/i);
    expect(() => polygonCentre([{ x: Number.NaN, y: 0 }])).toThrow(/finite/i);
    expect(() => rectCentre({ x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1 })).toThrow(
      /finite/i,
    );
    expect(() => containsPoint([{ x: 0, y: 0 }], { x: 100, y: 100 })).toThrow(
      /at least three/i,
    );
    expect(() =>
      polygonCentre([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toThrow(/non-degenerate/i);
  });

  it("summarises mean, median, nearest-rank p95 and maximum", () => {
    expect(summariseGeometryValues([1, 2, 3, 4, 100])).toEqual({
      mean: 22,
      median: 3,
      percentile95: 100,
      maximum: 100,
    });
  });
});
