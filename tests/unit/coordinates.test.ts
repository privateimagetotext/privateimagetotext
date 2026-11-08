import { describe, expect, it } from "vitest";

import {
  compose,
  fineRotationAroundTileCenter,
  identity,
  invert,
  isFiniteAffineMatrix,
  isFinitePoint,
  isFinitePolygon,
  isFiniteRect,
  isInvertibleAffineMatrix,
  mapPoint,
  mapPolygon,
  mapRectEnvelope,
  orientedSize,
  orientedToPreparedTileTransform,
  orientedToPreparedTransform,
  polygonEnvelope,
  rectToPolygon,
  rotationAroundCenter,
  scaling,
  sourceToOrientedTransform,
  translation,
  type AffineMatrix,
  type ManualRotation,
  type PixelPoint,
  type PixelRect,
} from "../../src/features/image-editor/coordinates";

const sourceCrop: PixelRect = {
  x: 11,
  y: 13,
  width: 5,
  height: 7,
};

function expectPointClose(actual: PixelPoint, expected: PixelPoint) {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe("affine coordinate transforms", () => {
  it("composes transforms in traversal order", () => {
    const matrix = compose(translation(3, 4), scaling(2, 3));

    expect(mapPoint(matrix, { x: 1, y: 2 })).toEqual({ x: 8, y: 18 });
    expect(compose()).toEqual(identity());
  });

  it.each<{
    rotation: ManualRotation;
    size: { width: number; height: number };
    topLeft: PixelPoint;
    topRight: PixelPoint;
    bottomLeft: PixelPoint;
    bottomRight: PixelPoint;
    interior: PixelPoint;
  }>([
    {
      rotation: 0,
      size: { width: 5, height: 7 },
      topLeft: { x: 0, y: 0 },
      topRight: { x: 5, y: 0 },
      bottomLeft: { x: 0, y: 7 },
      bottomRight: { x: 5, y: 7 },
      interior: { x: 1.25, y: 2.5 },
    },
    {
      rotation: 90,
      size: { width: 7, height: 5 },
      topLeft: { x: 7, y: 0 },
      topRight: { x: 7, y: 5 },
      bottomLeft: { x: 0, y: 0 },
      bottomRight: { x: 0, y: 5 },
      interior: { x: 4.5, y: 1.25 },
    },
    {
      rotation: 180,
      size: { width: 5, height: 7 },
      topLeft: { x: 5, y: 7 },
      topRight: { x: 0, y: 7 },
      bottomLeft: { x: 5, y: 0 },
      bottomRight: { x: 0, y: 0 },
      interior: { x: 3.75, y: 4.5 },
    },
    {
      rotation: 270,
      size: { width: 7, height: 5 },
      topLeft: { x: 0, y: 5 },
      topRight: { x: 0, y: 0 },
      bottomLeft: { x: 7, y: 5 },
      bottomRight: { x: 7, y: 0 },
      interior: { x: 2.5, y: 3.75 },
    },
  ])(
    "maps the same odd, non-full source crop through a $rotation-degree turn",
    ({
      rotation,
      size,
      topLeft,
      topRight,
      bottomLeft,
      bottomRight,
      interior,
    }) => {
      const matrix = sourceToOrientedTransform(sourceCrop, rotation);

      expect(orientedSize(sourceCrop, rotation)).toEqual(size);
      expectPointClose(mapPoint(matrix, { x: 11, y: 13 }), topLeft);
      expectPointClose(mapPoint(matrix, { x: 16, y: 13 }), topRight);
      expectPointClose(mapPoint(matrix, { x: 11, y: 20 }), bottomLeft);
      expectPointClose(mapPoint(matrix, { x: 16, y: 20 }), bottomRight);
      expectPointClose(mapPoint(matrix, { x: 12.25, y: 15.5 }), interior);
      expect(mapRectEnvelope(matrix, sourceCrop)).toEqual({
        x: 0,
        y: 0,
        ...size,
      });
    },
  );

  it.each<ManualRotation>([0, 90, 180, 270])(
    "round-trips source points after a %s-degree turn",
    (rotation) => {
      const forward = sourceToOrientedTransform(sourceCrop, rotation);
      const backward = invert(forward);
      const sourcePoint = { x: 13.125, y: 18.75 };

      expectPointClose(
        mapPoint(backward, mapPoint(forward, sourcePoint)),
        sourcePoint,
      );
    },
  );

  it("uses all four corners when forming a rotated rectangle envelope", () => {
    const rootHalf = Math.SQRT1_2;
    const matrix = rotationAroundCenter(Math.PI / 4, { x: 0, y: 0 });

    const envelope = mapRectEnvelope(matrix, {
      x: 0,
      y: 0,
      width: 2,
      height: 1,
    });

    expect(envelope.x).toBeCloseTo(-rootHalf, 10);
    expect(envelope.y).toBeCloseTo(0, 10);
    expect(envelope.width).toBeCloseTo(3 * rootHalf, 10);
    expect(envelope.height).toBeCloseTo(3 * rootHalf, 10);
  });

  it("preserves a transformed rectangle as a four-corner polygon", () => {
    const rect = { x: 0, y: 0, width: 2, height: 1 };
    const polygon = rectToPolygon(rect);
    const mapped = mapPolygon([1, 0.5, 0.25, 1, 3, -2], polygon);

    expect(polygon).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(mapped).toEqual([
      { x: 3, y: -2 },
      { x: 5, y: -1 },
      { x: 5.25, y: 0 },
      { x: 3.25, y: -1 },
    ]);
    expect(polygonEnvelope(mapped)).toEqual({
      x: 3,
      y: -2,
      width: 2.25,
      height: 2,
    });
    expect(mapRectEnvelope([1, 0.5, 0.25, 1, 3, -2], rect)).toEqual(
      polygonEnvelope(mapped),
    );
  });

  it("uses exact independent ratios for rounded prepared dimensions", () => {
    const oriented = { width: 333, height: 257 };
    const prepared = { width: 1_000, height: 772 };
    const matrix = orientedToPreparedTransform(oriented, prepared);

    expect(matrix[0]).toBeCloseTo(1_000 / 333, 12);
    expect(matrix[3]).toBeCloseTo(772 / 257, 12);
    expect(matrix[0]).not.toBe(matrix[3]);
    expectPointClose(mapPoint(matrix, { x: 333, y: 257 }), {
      x: 1_000,
      y: 772,
    });
  });

  it("maps an offset oriented tile to a zero-origin prepared tile", () => {
    const matrix = orientedToPreparedTileTransform(
      { x: 101, y: 53, width: 333, height: 257 },
      { width: 1_000, height: 772 },
    );

    expectPointClose(mapPoint(matrix, { x: 101, y: 53 }), { x: 0, y: 0 });
    expectPointClose(mapPoint(matrix, { x: 434, y: 310 }), {
      x: 1_000,
      y: 772,
    });
  });

  it("fine-rotates around the same-size tile center and round-trips", () => {
    const size = { width: 101, height: 75 };
    const forward = fineRotationAroundTileCenter(Math.PI / 60, size);
    const backward = invert(forward);
    const center = { x: 50.5, y: 37.5 };
    const point = { x: 12.25, y: 64.5 };

    expectPointClose(mapPoint(forward, center), center);
    expectPointClose(
      mapPoint(backward, mapPoint(forward, point)),
      point,
    );
  });

  it("rejects singular matrices and fractional source crop edges", () => {
    const singular: AffineMatrix = [1, 2, 2, 4, 0, 0];
    expect(isInvertibleAffineMatrix(singular)).toBe(false);
    expect(() => invert(singular)).toThrow(/not invertible/i);
    expect(() =>
      sourceToOrientedTransform({ ...sourceCrop, x: 11.5 }, 0),
    ).toThrow(/integers/i);
  });

  it("rejects non-finite affine and polygon geometry", () => {
    const nonFiniteTranslation = translation(Number.POSITIVE_INFINITY, 0);
    const overflowingDeterminant: AffineMatrix = [
      Number.MAX_VALUE,
      0,
      0,
      Number.MAX_VALUE,
      0,
      0,
    ];
    const invalidRect = {
      x: 0,
      y: 0,
      width: Number.NaN,
      height: 1,
    };
    const invalidPolygon = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: Number.NEGATIVE_INFINITY },
    ];

    expect(isFiniteAffineMatrix(nonFiniteTranslation)).toBe(false);
    expect(isInvertibleAffineMatrix(nonFiniteTranslation)).toBe(false);
    expect(isFiniteAffineMatrix(overflowingDeterminant)).toBe(true);
    expect(isInvertibleAffineMatrix(overflowingDeterminant)).toBe(false);
    expect(isFinitePoint({ x: 0.25, y: 0.5 })).toBe(true);
    expect(isFiniteRect(invalidRect)).toBe(false);
    expect(isFinitePolygon(invalidPolygon)).toBe(false);
    expect(() => invert(nonFiniteTranslation)).toThrow(/finite/i);
    expect(() => invert(overflowingDeterminant)).toThrow(/not invertible/i);
    expect(() => mapPoint(nonFiniteTranslation, { x: 0, y: 0 })).toThrow(
      /finite/i,
    );
    expect(() => rectToPolygon(invalidRect)).toThrow(/finite/i);
    expect(() => polygonEnvelope(invalidPolygon)).toThrow(/finite/i);
    expect(() => polygonEnvelope([])).toThrow(/at least three/i);
  });
});
