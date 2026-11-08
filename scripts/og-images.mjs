import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { create } from "fontkit";
import { Resvg } from "@resvg/resvg-js";

const fontRoot = new URL("../node_modules/", import.meta.url);
const manrope = create(await readFile(new URL("@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2", fontRoot)));
const mono = create(await readFile(new URL("@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2", fontRoot)));

function textWidth(text, font, size) {
  return font.layout(text).positions.reduce((total, position) => total + position.xAdvance, 0) * size / font.unitsPerEm;
}

// Outline the already-bundled fonts. The PNG renderer needs no system fonts,
// browser installation, network access, or duplicated font binaries.
function outlinedText(text, font, size, x, baseline, fill) {
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  let advance = 0;
  return run.glyphs.map((glyph, index) => {
    const position = run.positions[index];
    const left = x + (advance + position.xOffset) * scale;
    const top = baseline - position.yOffset * scale;
    advance += position.xAdvance;
    return `<path fill="${fill}" transform="translate(${left} ${top}) scale(${scale} ${-scale})" d="${glyph.path.toSVG()}"/>`;
  }).join("");
}

function wrapTitle(title, size) {
  const lines = [];
  for (const word of title.split(/\s+/)) {
    if (textWidth(word, manrope, size) > 1032) throw new Error(`Unbreakable social title word: ${word}`);
    const index = lines.length - 1;
    if (index < 0 || textWidth(`${lines[index]} ${word}`, manrope, size) > 1032) lines.push(word);
    else lines[index] += ` ${word}`;
  }
  return lines;
}

export async function generateSocialImages({ pages, dist }) {
  for (const page of pages) {
    let size = 64;
    let lines = wrapTitle(page.title, size);
    while (lines.length > 3 && size > 44) { size -= 2; lines = wrapTitle(page.title, size); }
    if (lines.length > 3) throw new Error(`Social image title does not fit: ${page.title}`);
    const titleTop = 252 - ((lines.length - 1) * size * 1.22) / 2;
    const eyebrowSize = Math.min(19, 1032 / Math.max(1, textWidth(page.eyebrow.toUpperCase(), mono, 1)));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="#11120f"/>
      <rect x="32" y="32" width="1136" height="566" rx="24" fill="#181a16" stroke="#34372f"/>
      <path d="M84 110h56M84 124h35" stroke="#8ea8ff" stroke-width="5"/>
      ${outlinedText(page.eyebrow.toUpperCase(), mono, eyebrowSize, 164, 123, "#8ea8ff")}
      ${lines.map((line, index) => outlinedText(line, manrope, size, 84, titleTop + index * size * 1.22 + size, "#f5f3ec")).join("")}
      <path d="M84 466h1032" stroke="#34372f"/>
      ${outlinedText("Private Image to Text", manrope, 28, 84, 524, "#f5f3ec")}
      ${outlinedText("PRIVATEIMAGETOTEXT.COM", mono, 17, 84, 555, "#bbb9af")}
      <circle cx="1060" cy="526" r="27" fill="#26315a"/>
      <path d="M1047 526h25m-10-10 10 10-10 10" fill="none" stroke="#8ea8ff" stroke-width="3"/>
    </svg>`;
    const png = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
    const output = path.join(dist, page.imagePath.slice(1));
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, png);
  }
}
