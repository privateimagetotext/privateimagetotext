import PDFDocument from "pdfkit";
import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";

// Generated test material only. No user documents enter this fixture pipeline.
const directory = "tmp/pdf-improvements/fixtures";
await mkdir(directory, { recursive: true });
async function save(name, draw) {
  const doc = new PDFDocument({ autoFirstPage: false, compress: false });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", resolve);
    doc.on("error", reject);
  });
  draw(doc);
  doc.end();
  await done;
  await writeFile(`${directory}/${name}.pdf`, Buffer.concat(chunks));
}
await save("mixed-pages", (doc) => {
  doc.addPage({ size: [420, 600] }).fontSize(20).text("SYNTHETIC SOURCE PAGE ONE", 35, 60);
  doc.text("Review reference ORCHID-271828.");
  doc.addPage({ size: [600, 420] }).fontSize(20).text("SYNTHETIC SOURCE PAGE TWO", 35, 60);
  doc.text("Second page reference LIME-314159.");
  doc.addPage({ size: [400, 620] });
  doc.page.dictionary.data.Rotate = 90;
  doc.fontSize(20).text("SYNTHETIC ROTATED PAGE THREE", 35, 60);
});
await save("spanish-scan", (doc) => {
  doc.addPage({ size: [800, 600], margin: 30 });
  doc.image("e2e/fixtures/languages/spa.png", 30, 30, { fit: [740, 540] });
});
