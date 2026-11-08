import { describe, expect, it } from "vitest";

import { invert, type AffineMatrix } from "../../src/features/image-editor/coordinates";
import type {
  EngineSectionWord,
  RecognitionSectionMetadata,
} from "../../src/features/ocr/types";
import { mapEngineSectionWord } from "../../src/features/ocr/word-geometry";

const identity: AffineMatrix = [1, 0, 0, 1, 0, 0];

function section(
  engineToPrepared: AffineMatrix,
  preparedToOriented: AffineMatrix,
): RecognitionSectionMetadata {
  return {
    id: "section-2",
    index: 1,
    inputRect: { x: 100, y: 200, width: 300, height: 400 },
    coreRect: { x: 100, y: 220, width: 300, height: 360 },
    preparedSize: { width: 600, height: 800 },
    orientedToPrepared: invert(preparedToOriented),
    preparedToOriented,
    preparedToEngine: invert(engineToPrepared),
    engineToPrepared,
    rotateRadians: 0,
    thresholdingMethod: 2,
    polarityInverted: false,
  };
}

function engineWord(
  overrides: Partial<EngineSectionWord> = {},
): EngineSectionWord {
  return {
    text: "ANCHOR",
    confidence: 92,
    bbox: { x0: 10, y0: 20, x1: 30, y1: 40 },
    blockIndex: 2,
    paragraphIndex: 3,
    lineIndex: 4,
    wordIndex: 5,
    ...overrides,
  };
}

describe("recognition word coordinate mapping", () => {
  it("retains the engine box and maps its corners through every named space", () => {
    const engineToPrepared: AffineMatrix = [1, 0, 0, 1, -5, -7];
    const preparedToOriented: AffineMatrix = [0.5, 0, 0, 2, 100, 200];
    const orientedToSource: AffineMatrix = [0, -1, 1, 0, 10, 500];

    const mapped = mapEngineSectionWord(
      engineWord(),
      section(engineToPrepared, preparedToOriented),
      orientedToSource,
    );

    expect(mapped).toMatchObject({
      text: "ANCHOR",
      confidence: 92,
      blockIndex: 2,
      paragraphIndex: 3,
      lineIndex: 4,
      wordIndex: 5,
      sectionId: "section-2",
      sectionIndex: 1,
      engineSection: {
        space: "engine-section",
        rect: { x0: 10, y0: 20, x1: 30, y1: 40 },
        envelope: { x: 10, y: 20, width: 20, height: 20 },
      },
      preparedSection: {
        space: "prepared-section",
        envelope: { x: 5, y: 13, width: 20, height: 20 },
      },
      orientedPage: {
        space: "oriented-page",
        envelope: { x: 102.5, y: 226, width: 10, height: 40 },
      },
      sourceImage: {
        space: "source-image",
        envelope: { x: 236, y: 387.5, width: 40, height: 10 },
      },
    });
    expect(mapped.sourceImage.polygon).toEqual([
      { x: 236, y: 397.5 },
      { x: 236, y: 387.5 },
      { x: 276, y: 387.5 },
      { x: 276, y: 397.5 },
    ]);
  });

  it("preserves a rotated quadrilateral separately from its envelope", () => {
    const quarterTurn: AffineMatrix = [0, -1, 1, 0, 0, 100];
    const mapped = mapEngineSectionWord(
      engineWord({ bbox: { x0: 10, y0: 20, x1: 30, y1: 50 } }),
      section(quarterTurn, identity),
      identity,
    );

    expect(mapped.preparedSection.polygon).toEqual([
      { x: 20, y: 90 },
      { x: 20, y: 70 },
      { x: 50, y: 70 },
      { x: 50, y: 90 },
    ]);
    expect(mapped.preparedSection.envelope).toEqual({
      x: 20,
      y: 70,
      width: 30,
      height: 20,
    });
  });

  it("rejects invalid engine boxes, hierarchy and transforms", () => {
    expect(() =>
      mapEngineSectionWord(
        engineWord({ bbox: { x0: 30, y0: 20, x1: 10, y1: 40 } }),
        section(identity, identity),
        identity,
      ),
    ).toThrow(/ordered pixel edges/i);
    expect(() =>
      mapEngineSectionWord(
        engineWord({ bbox: { x0: 10, y0: 20, x1: 10, y1: 40 } }),
        section(identity, identity),
        identity,
      ),
    ).toThrow(/strictly ordered pixel edges/i);
    expect(() =>
      mapEngineSectionWord(
        engineWord({ wordIndex: -1 }),
        section(identity, identity),
        identity,
      ),
    ).toThrow(/hierarchy indices/i);
    expect(() =>
      mapEngineSectionWord(
        engineWord(),
        section(identity, identity),
        [1, 0, 0, 0, 0, 0],
      ),
    ).toThrow(/invertible affine/i);
  });
});
