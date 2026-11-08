import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(currentDirectory, "../e2e/fixtures");

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createCropFixture(width, height) {
  const boundaryX = width / 4;
  const boundaryY = height / 4;
  const outside = [210, 40, 80];
  const selected = [30, 180, 90];
  const rows = Buffer.alloc((width * 3 + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    rows[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const colour = x >= boundaryX && y >= boundaryY ? selected : outside;
      const pixelStart = rowStart + 1 + x * 3;
      rows[pixelStart] = colour[0];
      rows[pixelStart + 1] = colour[1];
      rows[pixelStart + 2] = colour[2];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(outputDirectory, { recursive: true });
for (const fixture of [
  { filename: "crop-portrait.png", width: 320, height: 640 },
  { filename: "crop-landscape.png", width: 800, height: 400 },
]) {
  writeFileSync(
    path.join(outputDirectory, fixture.filename),
    createCropFixture(fixture.width, fixture.height),
  );
}
