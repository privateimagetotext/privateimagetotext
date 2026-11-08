import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { classifyContentPixels, suggestContentDefaults } from "../../src/features/ocr/content-defaults";

function fixture(name: string) {
  const bmp = readFileSync(`tests/fixtures/content-defaults/${name}.bmp`);
  expect(bmp.toString("ascii", 0, 2)).toBe("BM");
  expect(bmp.readUInt32LE(10)).toBe(54);
  expect(bmp.readUInt16LE(28)).toBe(32);
  const width = bmp.readInt32LE(18);
  const height = -bmp.readInt32LE(22);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = bmp[56 + index]; data[index + 1] = bmp[55 + index];
    data[index + 2] = bmp[54 + index]; data[index + 3] = 255;
  }
  return { data, width, height };
}

describe("local content suggestions", () => {
  it.each([
    ["screenshot", "screenshot", "original", "interface"],
    ["phone-page", "document", "adaptive-document", "photograph"],
    ["terminal", "screenshot", "original", "interface"],
  ])("classifies the %s fixture", (name, contentMode, preset, reason) => {
    expect(classifyContentPixels(fixture(name))).toEqual({ contentMode, preset, reason });
  });

  it("uses clipboard provenance without reading pixels", () => {
    const createElement = vi.spyOn(document, "createElement");
    expect(suggestContentDefaults({} as HTMLCanvasElement, true)).toEqual({
      contentMode: "screenshot", preset: "original", reason: "clipboard",
    });
    expect(createElement).not.toHaveBeenCalled();
  });

  it("does not mistake a flat blank or transparent page for a screenshot", () => {
    for (const value of [0, 127, 255]) {
      const data = new Uint8ClampedArray(64 * 64 * 4).fill(value);
      expect(classifyContentPixels({ data, width: 64, height: 64 }).reason).toBe("ambiguous");
    }
  });

  it("does not mistake a plain text scan for UI without a long contrast edge", () => {
    const sample = fixture("terminal");
    // Remove the terminal chrome and invert to a white page with isolated text.
    const height = sample.height - 20;
    const data = sample.data.slice(20 * sample.width * 4);
    for (let offset = 0; offset < data.length; offset += 4) {
      const value = data[offset] > 90 ? 0 : 255;
      data[offset] = data[offset + 1] = data[offset + 2] = value;
    }
    expect(classifyContentPixels({ data, width: sample.width, height }).reason).toBe("ambiguous");
  });

  it("fails gently for unavailable readback and releases the temporary canvas", () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(document, "createElement").mockReturnValue(canvas);
    vi.spyOn(canvas, "getContext").mockImplementation(() => { throw new Error("readback denied"); });
    expect(suggestContentDefaults({ width: 4096, height: 2048 } as HTMLCanvasElement).reason).toBe("ambiguous");
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("rejects malformed or unbounded samples", () => {
    expect(classifyContentPixels({ data: new Uint8ClampedArray(4), width: 4096, height: 4096 }).reason).toBe("ambiguous");
    expect(classifyContentPixels({ data: new Uint8ClampedArray(), width: 0, height: 0 }).reason).toBe("ambiguous");
  });
});
