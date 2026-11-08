import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Run after changing public/icon.svg; commit the generated ICO with the artwork.
const svg = await readFile(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
try {
  const sizes = [16, 32, 48];
  const images = [];
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`);
    images.push(await page.screenshot({ omitBackground: true }));
    await page.close();
  }
  // ICO directory followed by three lossless PNG images (32-bit RGBA).
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    directory[entry] = size;
    directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  }
  await writeFile(new URL("../public/favicon.ico", import.meta.url), Buffer.concat([directory, ...images]));
  console.log("Generated public/favicon.ico: 16, 32 and 48 px from icon.svg");
} finally {
  await browser.close();
}
