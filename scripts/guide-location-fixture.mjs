// Builds a synthetic, clearly labelled JPEG with EXIF GPS coordinates for the
// location guide figures. The pixels are the licensed libjpeg test photograph;
// the coordinates point at a public park (Kings Park, Perth), not a private place.

const ASCII = 2, SHORT = 3, LONG = 4, RATIONAL = 5, BYTE = 1, UNDEFINED = 7;
const TYPE_SIZE = { [BYTE]: 1, [ASCII]: 1, [UNDEFINED]: 1, [SHORT]: 2, [LONG]: 4, [RATIONAL]: 8 };

function ascii(text) { return { type: ASCII, values: [...Buffer.from(`${text}\0`, "latin1")] }; }
function rationals(...pairs) { return { type: RATIONAL, values: pairs }; }

// Serialises IFDs in order; `pointers` names tags whose LONG value is the
// offset of another IFD in the list.
function tiff(ifds) {
  const header = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]);
  for (const ifd of ifds) {
    for (const tag of Object.keys(ifd.pointers ?? {})) ifd.entries[tag] = { type: LONG, values: [0] };
  }
  const sizes = ifds.map((ifd) => {
    const extra = Object.values(ifd.entries).reduce((sum, entry) => {
      const bytes = TYPE_SIZE[entry.type] * entry.values.length;
      return sum + (bytes > 4 ? bytes + (bytes % 2) : 0);
    }, 0);
    return 2 + Object.keys(ifd.entries).length * 12 + 4 + extra;
  });
  const offsets = [];
  let cursor = 8;
  for (const size of sizes) { offsets.push(cursor); cursor += size; }
  const out = Buffer.alloc(cursor);
  header.copy(out);
  ifds.forEach((ifd, index) => {
    for (const [tag, target] of Object.entries(ifd.pointers ?? {})) {
      ifd.entries[tag] = { type: LONG, values: [offsets[target]] };
    }
    const tags = Object.keys(ifd.entries).map(Number).sort((a, b) => a - b);
    let position = offsets[index];
    let data = position + 2 + tags.length * 12 + 4;
    out.writeUInt16BE(tags.length, position); position += 2;
    for (const tag of tags) {
      const entry = ifd.entries[tag];
      const bytes = TYPE_SIZE[entry.type] * entry.values.length;
      out.writeUInt16BE(tag, position);
      out.writeUInt16BE(entry.type, position + 2);
      out.writeUInt32BE(entry.values.length, position + 4);
      let target = position + 8;
      if (bytes > 4) { out.writeUInt32BE(data, position + 8); target = data; data += bytes + (bytes % 2); }
      for (const value of entry.values) {
        if (entry.type === RATIONAL) { out.writeUInt32BE(value[0], target); out.writeUInt32BE(value[1], target + 4); target += 8; }
        else if (entry.type === LONG) { out.writeUInt32BE(value, target); target += 4; }
        else if (entry.type === SHORT) { out.writeUInt16BE(value, target); target += 2; }
        else { out.writeUInt8(value, target); target += 1; }
      }
      position += 12;
    }
    out.writeUInt32BE(0, position);
  });
  return out;
}

export function locationExampleJpeg(sourceJpeg) {
  const exif = tiff([
    { entries: {
      0x010f: ascii("Guide example camera"),
      0x0110: ascii("Synthetic sample"),
      0x0132: ascii("2026:11:06 09:15:00"),
    }, pointers: { 0x8769: 1, 0x8825: 2 } },
    { entries: { 0x9000: { type: UNDEFINED, values: [...Buffer.from("0232", "ascii")] }, 0x9003: ascii("2026:11:06 09:15:00") } },
    { entries: {
      0x0000: { type: BYTE, values: [2, 3, 0, 0] },
      0x0001: ascii("S"),
      0x0002: rationals([31, 1], [57, 1], [38, 1]),
      0x0003: ascii("E"),
      0x0004: rationals([115, 1], [50, 1], [52, 1]),
    } },
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), exif]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  if (sourceJpeg[0] !== 0xff || sourceJpeg[1] !== 0xd8 || sourceJpeg[2] !== 0xff || sourceJpeg[3] !== 0xe0) throw new Error("Expected a JFIF JPEG");
  const app0End = 4 + sourceJpeg.readUInt16BE(4);
  return Buffer.concat([sourceJpeg.subarray(0, app0End), app1, payload, sourceJpeg.subarray(app0End)]);
}
