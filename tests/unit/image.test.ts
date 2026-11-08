import { describe, expect, it, vi } from "vitest";

import {
  clearCanvas,
  cropToSourcePixels,
  normaliseCrop,
  renderRecognitionTile,
  setCropEdge,
} from "../../src/features/image-editor/image";
import type { CropRect } from "../../src/features/ocr/types";

describe("crop helpers", () => {
  it("clamps crop coordinates and dimensions to the image bounds", () => {
    expect(
      normaliseCrop({
        x: -0.25,
        y: 0.2,
        width: 1.5,
        height: 0.9,
      }),
    ).toEqual({
      x: 0,
      y: 0.2,
      width: 1,
      height: 0.8,
    });
  });

  it("enforces the requested minimum crop size", () => {
    const crop = normaliseCrop(
      { x: 0.4, y: 0.4, width: 0, height: 0 },
      0.1,
    );

    expect(crop.width).toBeCloseTo(0.1);
    expect(crop.height).toBeCloseTo(0.1);
  });

  it.each([
    ["left", 0.95, { x: 0.76, y: 0.2, width: 0.04, height: 0.6 }],
    ["top", 0.95, { x: 0.2, y: 0.76, width: 0.6, height: 0.04 }],
    ["right", 0.1, { x: 0.2, y: 0.2, width: 0.04, height: 0.6 }],
    ["bottom", 0.1, { x: 0.2, y: 0.2, width: 0.6, height: 0.04 }],
  ] as const)(
    "keeps the %s edge within bounds and preserves the minimum size",
    (edge, value, expected) => {
      const crop: CropRect = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
      const next = setCropEdge(crop, edge, value);

      expect(next.x).toBeCloseTo(expected.x);
      expect(next.y).toBeCloseTo(expected.y);
      expect(next.width).toBeCloseTo(expected.width);
      expect(next.height).toBeCloseTo(expected.height);
      expect(crop).toEqual({ x: 0.2, y: 0.2, width: 0.6, height: 0.6 });
    },
  );

  it("clamps right and bottom edges to the far image boundary", () => {
    const crop: CropRect = { x: 0.2, y: 0.3, width: 0.4, height: 0.4 };

    expect(setCropEdge(crop, "right", 2)).toEqual({
      x: 0.2,
      y: 0.3,
      width: 0.8,
      height: 0.4,
    });
    expect(setCropEdge(crop, "bottom", 2)).toEqual({
      x: 0.2,
      y: 0.3,
      width: 0.4,
      height: 0.7,
    });
  });

  it("rounds absolute crop edges without reading beyond odd-sized sources", () => {
    expect(
      cropToSourcePixels(
        { x: 0.3, y: 0.2, width: 0.7, height: 0.8 },
        5,
        7,
      ),
    ).toEqual({ x: 2, y: 1, width: 3, height: 6 });
    expect(
      cropToSourcePixels(
        { x: 0, y: 0, width: 1, height: 1 },
        5,
        7,
      ),
    ).toEqual({ x: 0, y: 0, width: 5, height: 7 });
  });
});

describe("clearCanvas", () => {
  it("clears existing pixels and releases the backing dimensions", () => {
    const clearRect = vi.fn();
    const getContext = vi.fn(() => ({ clearRect }));
    const canvas = {
      width: 320,
      height: 180,
      getContext,
    } as unknown as HTMLCanvasElement;

    clearCanvas(canvas);

    expect(getContext).toHaveBeenCalledWith("2d");
    expect(clearRect).toHaveBeenCalledWith(0, 0, 320, 180);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("still releases dimensions when a 2D context is unavailable", () => {
    const canvas = {
      width: 10,
      height: 20,
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement;

    clearCanvas(canvas);

    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("accepts a missing canvas during cleanup", () => {
    expect(() => clearCanvas(null)).not.toThrow();
  });
});

describe("native recognition tile rendering", () => {
  it("renders an oriented crop tile directly from the reusable decoded source", () => {
    const setTransform = vi.fn();
    const drawImage = vi.fn();
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      setTransform,
      drawImage,
      fillStyle: "",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;
    const source = {} as CanvasImageSource;

    renderRecognitionTile(
      { source, width: 101, height: 203, close: vi.fn() },
      {
        crop: { x: 0, y: 0, width: 1, height: 1 },
        rotation: 90,
        preset: "original",
      },
      { x: 11, y: 13, width: 5, height: 7 },
      { x: 1, y: 2, width: 4, height: 3 },
      canvas,
    );

    expect(canvas.width).toBe(4);
    expect(canvas.height).toBe(3);
    // Source -> crop -> 90° oriented -> zero-origin tile.
    expect(setTransform).toHaveBeenCalledWith(0, 1, -1, 0, 19, -13);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0);
  });

  it("rejects fractional or empty tile edges", () => {
    const canvas = document.createElement("canvas");
    const decoded = {
      source: {} as CanvasImageSource,
      width: 10,
      height: 10,
      close: vi.fn(),
    };
    const transform = {
      crop: { x: 0, y: 0, width: 1, height: 1 },
      rotation: 0 as const,
      preset: "original" as const,
    };

    expect(() =>
      renderRecognitionTile(
        decoded,
        transform,
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 0.5, y: 0, width: 5, height: 5 },
        canvas,
      ),
    ).toThrow(/integer/i);
  });
});
