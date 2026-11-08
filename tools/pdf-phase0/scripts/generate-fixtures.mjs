import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import PDFDocument from "pdfkit";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const fixtureDirectory = path.join(repositoryRoot, "tmp", "pdf-phase0", "fixtures");
const cyrillicFont = path.join(
  repositoryRoot,
  "node_modules",
  "pdfjs-dist",
  "standard_fonts",
  "LiberationSans-Regular.ttf",
);

const TEST_PASSWORD = "phase0-only";
const PAGE_WIDTH = 1_275;
const PAGE_HEIGHT = 1_650;

const glyphs = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00001", "00001", "00001", "00001", "10001", "10001", "01110"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function drawText(pixels, text, x, y, scale) {
  for (const [characterIndex, character] of [...text].entries()) {
    const glyph = glyphs[character];
    if (!glyph) throw new Error(`Missing synthetic glyph: ${character}`);
    for (const [row, values] of glyph.entries()) {
      for (const [column, value] of [...values].entries()) {
        if (value !== "1") continue;
        const left = x + characterIndex * scale * 6 + column * scale;
        const top = y + row * scale;
        for (let py = top; py < top + scale; py += 1) {
          for (let px = left; px < left + scale; px += 1) {
            const index = (py * PAGE_WIDTH + px) * 4;
            pixels[index] = 12;
            pixels[index + 1] = 18;
            pixels[index + 2] = 24;
          }
        }
      }
    }
  }
}

function scannedPagePixels(pageNumber) {
  const pixels = Buffer.alloc(PAGE_WIDTH * PAGE_HEIGHT * 4, 255);
  drawText(pixels, "PDF SCAN PAGE", 115, 260, 12);
  drawText(pixels, String(pageNumber).padStart(2, "0"), 535, 390, 12);
  drawText(pixels, "SENTINEL", 260, 610, 14);
  drawText(pixels, "314159", 350, 780, 14);
  drawText(pixels, "LOCAL BROWSER OCR", 125, 1_050, 10);
  return pixels;
}

function scannedPagePng(pageNumber) {
  const pixels = scannedPagePixels(pageNumber);
  const raw = Buffer.alloc(PAGE_HEIGHT * (PAGE_WIDTH * 4 + 1));
  for (let row = 0; row < PAGE_HEIGHT; row += 1) {
    const destination = row * (PAGE_WIDTH * 4 + 1);
    raw[destination] = 0;
    pixels.copy(raw, destination + 1, row * PAGE_WIDTH * 4, (row + 1) * PAGE_WIDTH * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(PAGE_WIDTH, 0);
  header.writeUInt32BE(PAGE_HEIGHT, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function createPdf(filename, options, draw) {
  const chunks = [];
  const document = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    info: {
      Title: "Synthetic PDF OCR Phase 0 fixture",
      Author: "LocalOCR test generator",
      CreationDate: new Date("2026-08-09T00:00:00.000Z"),
      ModDate: new Date("2026-08-09T00:00:00.000Z"),
    },
    ...options,
  });
  const completed = new Promise((resolve, reject) => {
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", resolve);
    document.on("error", reject);
  });
  await draw(document);
  document.end();
  await completed;
  const contents = Buffer.concat(chunks);
  await writeFile(path.join(fixtureDirectory, filename), contents);
  return {
    file: filename,
    bytes: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

async function createRawPdf(filename, objects) {
  const parts = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "binary")];
  const offsets = [0];
  let offset = parts[0].length;
  for (const [index, object] of objects.entries()) {
    const body = Buffer.isBuffer(object) ? object : Buffer.from(object, "binary");
    const bytes = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
      body,
      Buffer.from("\nendobj\n", "ascii"),
    ]);
    offsets.push(offset);
    parts.push(bytes);
    offset += bytes.length;
  }
  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join("\n");
  parts.push(Buffer.from(xref, "ascii"));
  const contents = Buffer.concat(parts);
  await writeFile(path.join(fixtureDirectory, filename), contents);
  return {
    file: filename,
    bytes: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

async function createCMapPdf() {
  const content = [
    "BT /FH 18 Tf 72 700 Td (CMAP SUPPORT SENTINEL 97531) Tj ET",
    "BT /FJ 24 Tf 72 640 Td <93FA967B> Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /FJ 5 0 R /FH 8 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /90ms-RKSJ-H /DescendantFonts [6 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 7 0 R /DW 1000 >>",
    "<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 752 /Descent -271 /CapHeight 737 /StemV 80 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  return createRawPdf("cmap-font.pdf", objects);
}

async function createBenchmarkPdf(pageCount) {
  const imageObjectNumber = 3 + pageCount * 2;
  const pageObjectNumbers = Array.from(
    { length: pageCount },
    (_, index) => 3 + index * 2,
  );
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageCount} >>`,
  ];
  const drawing = "q 306 0 0 396 0 0 cm /Im0 Do Q";
  for (const pageObjectNumber of pageObjectNumbers) {
    const contentObjectNumber = pageObjectNumber + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 306 396] /Resources << /XObject << /Im0 ${imageObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      `<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}\nendstream`,
    );
  }
  const rgba = scannedPagePixels(1);
  const greyscale = Buffer.alloc(PAGE_WIDTH * PAGE_HEIGHT);
  for (let index = 0; index < greyscale.length; index += 1) {
    greyscale[index] = rgba[index * 4];
  }
  const compressed = deflateSync(greyscale, { level: 9 });
  objects.push(
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
        "ascii",
      ),
      compressed,
      Buffer.from("\nendstream", "ascii"),
    ]),
  );
  return createRawPdf(`benchmark-${pageCount}.pdf`, objects);
}

function addSelectablePage(document, heading, body) {
  document.addPage({ size: "LETTER", margin: 54 });
  document.font("Helvetica-Bold").fontSize(22).text(heading);
  document.moveDown().font("Helvetica").fontSize(15).text(body);
}

function addScannedPage(document, pageNumber, rotate = 0) {
  // The raster is 150 DPI at 612 x 792 points, but the PDF page is deliberately
  // half that physical size so the harness's 300-DPI render reproduces the
  // 1,275 x 1,650 source pixels without an unnecessary 2x upsample.
  document.addPage({ size: [306, 396], margin: 0 });
  if (rotate) document.page.dictionary.data.Rotate = rotate;
  document.image(scannedPagePng(pageNumber), 0, 0, { width: 306, height: 396 });
}

await mkdir(fixtureDirectory, { recursive: true });
await readFile(cyrillicFont);
const inventory = [];

inventory.push(
  await createPdf("selectable.pdf", {}, async (document) => {
    addSelectablePage(
      document,
      "PDF PHASE ZERO SELECTABLE 271828",
      "Selectable text line one. Unicode: café — résumé.",
    );
    addSelectablePage(document, "SECOND SELECTABLE PAGE", "Line ending sentinel 161803.");
  }),
);
inventory.push(
  await createPdf("scanned.pdf", {}, async (document) => addScannedPage(document, 1)),
);
inventory.push(
  await createPdf("mixed.pdf", {}, async (document) => {
    addSelectablePage(document, "MIXED SELECTABLE PAGE 112358", "The next page is raster only.");
    addScannedPage(document, 2);
  }),
);
inventory.push(
  await createPdf(
    "password.pdf",
    {
      // PDF 1.3 uses PDFKit's deterministic RC4 fixture path. This is
      // intentionally weak test-only encryption, never a production choice.
      pdfVersion: "1.3",
      userPassword: TEST_PASSWORD,
      ownerPassword: "phase0-owner-only",
      permissions: { copying: false, modifying: false, printing: "lowResolution" },
    },
    async (document) =>
      addSelectablePage(
        document,
        "PASSWORD FIXTURE OPEN 424242",
        "This synthetic password is test-only and short-lived.",
      ),
  ),
);
inventory.push(
  await createPdf("embedded-font.pdf", {}, async (document) => {
    document.addPage({ size: "LETTER", margin: 54 });
    document.font(cyrillicFont).fontSize(24).text("ПДФ ФАЗА НОЛЬ 24680");
    document.font(cyrillicFont).fontSize(16).text("ПРИВЕТ ЛОКАЛЬНЫЙ БРАУЗЕР");
  }),
);
inventory.push(await createCMapPdf());
inventory.push(
  await createPdf("rotated.pdf", {}, async (document) => addScannedPage(document, 3, 90)),
);

for (const pageCount of [1, 10, 25, 26]) {
  inventory.push(await createBenchmarkPdf(pageCount));
}

await writeFile(
  path.join(fixtureDirectory, "inventory.json"),
  `${JSON.stringify({ generatedAt: "2026-08-09", inventory }, null, 2)}\n`,
);
process.stdout.write(`Generated ${inventory.length} synthetic PDF fixtures.\n`);
