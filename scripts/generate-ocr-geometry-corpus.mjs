import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDirectory = path.join(
  repositoryRoot,
  "e2e",
  "fixtures",
  "ocr-geometry",
);
const fontPath = path.join(
  repositoryRoot,
  "node_modules",
  "@fontsource",
  "ibm-plex-mono",
  "files",
  "ibm-plex-mono-latin-600-normal.woff2",
);

const fullCrop = (width, height) => ({
  normalised: { x: 0, y: 0, width: 1, height: 1 },
  sourcePixelEdges: { x: 0, y: 0, width, height },
});

const cropFromEdges = (sourceWidth, sourceHeight, edges) => ({
  normalised: {
    x: edges.x / sourceWidth,
    y: edges.y / sourceHeight,
    width: edges.width / sourceWidth,
    height: edges.height / sourceHeight,
  },
  sourcePixelEdges: edges,
});

const rotationTokens = [
  ["AMBERCAT", "AMBERDOG", "AMBERFOX"],
  ["BRONZECAT", "BRONZEDOG", "BRONZEFOX"],
  ["COPPERCAT", "COPPERDOG", "COPPERFOX"],
  ["DENIMCAT", "DENIMDOG", "DENIMFOX"],
];

const rotationCases = [0, 90, 180, 270].map((manualRotation, index) => {
  const orientedWidth = 1501;
  const orientedHeight = 901;
  const swapsAxes = manualRotation === 90 || manualRotation === 270;
  const sourceWidth = swapsAxes ? orientedHeight : orientedWidth;
  const sourceHeight = swapsAxes ? orientedWidth : orientedHeight;
  return {
    id: `manual-rotation-${manualRotation}`,
    image: `manual-rotation-${manualRotation}.png`,
    sourceWidth,
    sourceHeight,
    orientedWidth,
    orientedHeight,
    crop: fullCrop(sourceWidth, sourceHeight),
    manualRotation,
    fineSkewDegrees: 0,
    contentMode: "document",
    enhancementPreset: "document",
    expectedTilingStrategy: "single-canvas",
    categoryTags: [
      "manual-rotation",
      `rotation-${manualRotation}`,
      swapsAxes ? "portrait-source" : "landscape-source",
    ],
    fastSmoke: manualRotation === 90,
    fontSize: 58,
    anchors: [
      { token: rotationTokens[index][0], x: 88, baselineY: 150, critical: true },
      { token: rotationTokens[index][1], x: 760, baselineY: 445, critical: true },
      { token: rotationTokens[index][2], x: 170, baselineY: 770, critical: true },
    ],
  };
});

const cases = [
  ...rotationCases,
  {
    id: "corner-and-centre-anchors",
    image: "corner-and-centre-anchors.png",
    sourceWidth: 1801,
    sourceHeight: 1201,
    orientedWidth: 1801,
    orientedHeight: 1201,
    crop: fullCrop(1801, 1201),
    manualRotation: 0,
    fineSkewDegrees: 0,
    contentMode: "document",
    enhancementPreset: "document",
    expectedTilingStrategy: "single-canvas",
    categoryTags: ["corner-anchors", "centre-anchor", "landscape-source"],
    fastSmoke: true,
    fontSize: 54,
    anchors: [
      { token: "TOPLEFT1", x: 42, baselineY: 92, critical: true },
      {
        token: "TOPRIGHT2",
        right: 1759,
        baselineY: 92,
        critical: true,
      },
      { token: "CENTER55", centreX: 900.5, baselineY: 625, critical: true },
      { token: "BOTLEFT3", x: 42, baselineY: 1160, critical: true },
      {
        token: "BOTRIGHT4",
        right: 1759,
        baselineY: 1160,
        critical: true,
      },
    ],
  },
  {
    id: "odd-crop-rounded-preview",
    image: "odd-crop-rounded-preview.png",
    sourceWidth: 5201,
    sourceHeight: 3503,
    orientedWidth: 4901,
    orientedHeight: 3003,
    crop: cropFromEdges(5201, 3503, {
      x: 137,
      y: 211,
      width: 4901,
      height: 3003,
    }),
    manualRotation: 0,
    fineSkewDegrees: 0,
    contentMode: "document",
    enhancementPreset: "document",
    expectedTilingStrategy: "single-canvas",
    categoryTags: [
      "odd-dimensions",
      "non-full-crop",
      "large-preview-reduction",
      "unequal-prepared-scale",
      "landscape-source",
    ],
    fastSmoke: false,
    fontSize: 92,
    anchors: [
      { token: "CROPUP11", x: 250, baselineY: 350, critical: true },
      { token: "CROPMID2", centreX: 2450.5, baselineY: 1530, critical: true },
      { token: "CROPDN33", x: 3650, baselineY: 2760, critical: true },
    ],
  },
  {
    id: "adaptive-enlargement",
    image: "adaptive-enlargement.png",
    sourceWidth: 701,
    sourceHeight: 503,
    orientedWidth: 701,
    orientedHeight: 503,
    crop: fullCrop(701, 503),
    manualRotation: 0,
    fineSkewDegrees: 0,
    contentMode: "document",
    enhancementPreset: "adaptive-document",
    expectedTilingStrategy: "single-canvas",
    categoryTags: ["adaptive-enlargement", "small-image", "landscape-source"],
    fastSmoke: true,
    fontSize: 31,
    anchors: [
      { token: "SMALLA11", x: 42, baselineY: 90, critical: true },
      { token: "CODE-42", x: 390, baselineY: 90, critical: false },
      { token: "SMALLB22", x: 250, baselineY: 245, critical: true },
      { token: "SMALLC33", x: 80, baselineY: 420, critical: true },
      { token: "RATE:100", x: 380, baselineY: 420, critical: false },
    ],
  },
  {
    id: "positive-fine-skew",
    image: "positive-fine-skew.png",
    sourceWidth: 1701,
    sourceHeight: 1103,
    orientedWidth: 1701,
    orientedHeight: 1103,
    crop: fullCrop(1701, 1103),
    manualRotation: 0,
    fineSkewDegrees: 3,
    contentMode: "document",
    enhancementPreset: "adaptive-document",
    expectedTilingStrategy: "single-canvas",
    categoryTags: ["fine-skew", "positive-skew", "landscape-source"],
    fastSmoke: true,
    fontSize: 58,
    anchors: [
      { token: "FALCONAA", x: 170, baselineY: 260, critical: true },
      { token: "BADGERBB", x: 760, baselineY: 545, critical: true },
      { token: "VECTORCC", x: 300, baselineY: 850, critical: true },
    ],
  },
  {
    id: "negative-fine-skew",
    image: "negative-fine-skew.png",
    sourceWidth: 1703,
    sourceHeight: 1101,
    orientedWidth: 1703,
    orientedHeight: 1101,
    crop: fullCrop(1703, 1101),
    manualRotation: 0,
    fineSkewDegrees: -3,
    contentMode: "document",
    enhancementPreset: "adaptive-document",
    expectedTilingStrategy: "single-canvas",
    categoryTags: ["fine-skew", "negative-skew", "landscape-source"],
    fastSmoke: false,
    fontSize: 58,
    anchors: [
      { token: "JAGUARAA", x: 170, baselineY: 260, critical: true },
      { token: "RAVENBBB", x: 760, baselineY: 545, critical: true },
      { token: "WAGONCCC", x: 300, baselineY: 850, critical: true },
    ],
  },
  {
    id: "native-tile-seams",
    image: "native-tile-seams.png",
    sourceWidth: 1501,
    sourceHeight: 7601,
    orientedWidth: 1501,
    orientedHeight: 7601,
    crop: fullCrop(1501, 7601),
    manualRotation: 0,
    fineSkewDegrees: 0,
    contentMode: "document",
    enhancementPreset: "adaptive-document",
    expectedTilingStrategy: "vertical-tiles",
    categoryTags: [
      "native-tiling",
      "tile-overlap",
      "tile-seam",
      "repeated-token",
      "portrait-source",
    ],
    fastSmoke: false,
    fontSize: 54,
    anchors: [
      { token: "PAGESTART", x: 90, baselineY: 150, critical: true },
      { token: "REPEATER", x: 180, baselineY: 1050, critical: true },
      { token: "UPPERMID", x: 740, baselineY: 3650, critical: true },
      { token: "SEAMWORD", x: 170, baselineY: 3800, critical: true },
      { token: "LOWERMID", x: 760, baselineY: 3950, critical: true },
      { token: "REPEATER", x: 760, baselineY: 6550, critical: true },
      { token: "PAGEEND9", x: 90, baselineY: 7480, critical: true },
    ],
  },
];

function sourceSizeForCase(fixture) {
  return { width: fixture.sourceWidth, height: fixture.sourceHeight };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

await mkdir(outputDirectory, { recursive: true });
const fontBytes = await readFile(fontPath);
const fontDataUrl = `data:font/woff2;base64,${fontBytes.toString("base64")}`;
if (process.argv.length > 2) {
  throw new Error(
    "Partial corpus generation is not supported because it can stale manifest geometry and hashes. Regenerate the complete corpus instead.",
  );
}
const browser = await chromium.launch();
const generatedFixtures = [];

try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const fixture of cases) {
    const { width, height } = sourceSizeForCase(fixture);
    await page.setViewportSize({ width, height: Math.min(height, 8000) });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      @font-face { font-family: GeometryMono; src: url(${fontDataUrl}) format("woff2"); font-weight: 600; }
      html, body { margin: 0; background: white; }
      canvas { display: block; }
    </style><canvas id="fixture" width="${width}" height="${height}"></canvas>`);

    const rendered = await page.evaluate(async (definition) => {
      await document.fonts.load(
        `600 ${definition.fontSize}px GeometryMono`,
      );
      const canvas = document.querySelector("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("Geometry fixture canvas was not created.");
      }
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas 2D is unavailable.");

      const multiply = (first, second) => {
        const [a1, b1, c1, d1, e1, f1] = first;
        const [a2, b2, c2, d2, e2, f2] = second;
        return [
          a2 * a1 + c2 * b1,
          b2 * a1 + d2 * b1,
          a2 * c1 + c2 * d1,
          b2 * c1 + d2 * d1,
          a2 * e1 + c2 * f1 + e2,
          b2 * e1 + d2 * f1 + f2,
        ];
      };
      const mapPoint = (matrix, point) => ({
        x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
        y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
      });
      const rotationAround = (radians, centre) => {
        const cosine = Math.cos(radians);
        const sine = Math.sin(radians);
        return multiply(
          multiply(
            [1, 0, 0, 1, -centre.x, -centre.y],
            [cosine, sine, -sine, cosine, 0, 0],
          ),
          [1, 0, 0, 1, centre.x, centre.y],
        );
      };
      const orientedToSource =
        definition.manualRotation === 0
          ? [1, 0, 0, 1, definition.crop.sourcePixelEdges.x, definition.crop.sourcePixelEdges.y]
          : definition.manualRotation === 90
            ? [
                0,
                -1,
                1,
                0,
                definition.crop.sourcePixelEdges.x,
                definition.crop.sourcePixelEdges.y + definition.crop.sourcePixelEdges.height,
              ]
            : definition.manualRotation === 180
              ? [
                  -1,
                  0,
                  0,
                  -1,
                  definition.crop.sourcePixelEdges.x + definition.crop.sourcePixelEdges.width,
                  definition.crop.sourcePixelEdges.y + definition.crop.sourcePixelEdges.height,
                ]
              : [
                  0,
                  1,
                  -1,
                  0,
                  definition.crop.sourcePixelEdges.x + definition.crop.sourcePixelEdges.width,
                  definition.crop.sourcePixelEdges.y,
                ];
      const fineRotation = rotationAround(
        (definition.fineSkewDegrees * Math.PI) / 180,
        {
          x: definition.orientedWidth / 2,
          y: definition.orientedHeight / 2,
        },
      );
      const renderTransform = multiply(fineRotation, orientedToSource);

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.setTransform(...renderTransform);
      context.fillStyle = "#111111";
      context.font = `600 ${definition.fontSize}px GeometryMono`;
      context.textBaseline = "alphabetic";
      context.textAlign = "left";

      const anchors = definition.anchors.map((anchor, index) => {
        const metrics = context.measureText(anchor.token);
        const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
        const x =
          typeof anchor.x === "number"
            ? anchor.x
            : typeof anchor.right === "number"
              ? anchor.right - width
              : anchor.centreX - width / 2;
        const left = x - metrics.actualBoundingBoxLeft;
        const right = x + metrics.actualBoundingBoxRight;
        const top = anchor.baselineY - metrics.actualBoundingBoxAscent;
        const bottom = anchor.baselineY + metrics.actualBoundingBoxDescent;
        const polygon = [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ].map((point) => mapPoint(renderTransform, point));
        context.fillText(anchor.token, x, anchor.baselineY);
        const xs = polygon.map((point) => point.x);
        const ys = polygon.map((point) => point.y);
        const minimumX = Math.min(...xs);
        const minimumY = Math.min(...ys);
        const maximumX = Math.max(...xs);
        const maximumY = Math.max(...ys);
        return {
          id: `${definition.id}-anchor-${index + 1}`,
          expectedToken: anchor.token,
          critical: anchor.critical,
          readingOrder: index,
          polygon,
          envelope: {
            x: minimumX,
            y: minimumY,
            width: maximumX - minimumX,
            height: maximumY - minimumY,
          },
        };
      });

      return {
        anchors,
        renderTransform,
        pngDataUrl: canvas.toDataURL("image/png"),
      };
    }, fixture);

    const imageBytes = Buffer.from(rendered.pngDataUrl.split(",")[1], "base64");
    await writeFile(path.join(outputDirectory, fixture.image), imageBytes);
    generatedFixtures.push({
      id: fixture.id,
      image: fixture.image,
      sourceSize: sourceSizeForCase(fixture),
      anchors: rendered.anchors,
      coordinateSpace: "source-image",
      pixelEdgeConvention:
        "top-left origin; floating-point pixel edges; right and bottom rectangle edges are exclusive",
      contentMode: fixture.contentMode,
      enhancementPreset: fixture.enhancementPreset,
      crop: fixture.crop,
      manualRotation: fixture.manualRotation,
      fineSkewDegrees: fixture.fineSkewDegrees,
      expectedTilingStrategy: fixture.expectedTilingStrategy,
      categoryTags: fixture.categoryTags,
      fastSmoke: fixture.fastSmoke,
      generator: {
        font: "IBM Plex Mono 600",
        fontSize: fixture.fontSize,
        renderTransform: rendered.renderTransform,
      },
      imageSha256: sha256(imageBytes),
    });
  }
} finally {
  await browser.close();
}

const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/generate-ocr-geometry-corpus.mjs",
    syntheticContentOnly: true,
    calibrationHistory: [
      {
        revision: 2,
        reason:
          "The first untouched-production baseline showed exact-token OCR ambiguity for 0/O, 1/l and REPEAT88 plus a non-spatial secondary-anchor order. Ambiguous critical strings and declared array order were revised; positions, transforms, rendering sizes, crop edges, tile seam geometry and metric tolerances were not changed. The baseline is rerun after this revision.",
      },
    ],
    coordinateSpaces: [
      "source-image",
      "oriented-page",
      "prepared-section",
      "engine-section",
    ],
    fixtures: generatedFixtures,
};
await writeFile(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(
  `Generated ${generatedFixtures.length} OCR geometry fixture${generatedFixtures.length === 1 ? "" : "s"}.`,
);
