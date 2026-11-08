import { describe, expect, it } from "vitest";

import { cropPointFromClient } from "../../src/features/image-editor/crop-coordinates";

const bounds = {
  left: 100,
  top: 200,
  width: 400,
  height: 800,
};

describe("crop pointer coordinates", () => {
  it("maps client coordinates into the image-relative unit interval", () => {
    expect(cropPointFromClient(200, 400, bounds)).toEqual({
      x: 0.25,
      y: 0.25,
    });
  });

  it("clamps pointer coordinates outside the rendered image", () => {
    expect(cropPointFromClient(-50, 1_200, bounds)).toEqual({
      x: 0,
      y: 1,
    });
    expect(cropPointFromClient(600, 100, bounds)).toEqual({
      x: 1,
      y: 0,
    });
  });

  it("returns finite origin coordinates for empty bounds", () => {
    expect(
      cropPointFromClient(200, 400, {
        left: 100,
        top: 200,
        width: 0,
        height: 0,
      }),
    ).toEqual({ x: 0, y: 0 });
  });
});
