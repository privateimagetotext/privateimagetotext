import { readFile } from "node:fs/promises";
import path from "node:path";
import { timestamp } from "./sitemap.mjs";

export function guideWordCount(guide) {
  const prose = [guide.introduction, ...guide.sections.flatMap((section) => [
    section.heading, ...(section.paragraphs ?? []), ...(section.steps ?? []),
    ...(section.bullets ?? []), section.callout ?? "",
    ...(section.figures ?? []).map((figure) => figure.caption),
    ...(section.table ? [section.table.caption, ...section.table.headers, ...section.table.rows.flat()] : []),
  ]), ...(guide.faqs ?? []).flatMap((faq) => [faq.question, faq.answer])];
  return prose.join(" ").trim().split(/\s+/u).filter(Boolean).length;
}

export function validateGuide(guide) {
  const fail = (message) => { throw new Error(`${guide.slug}: ${message}`); };
  if (!guide.dateModified) fail("updated date (dateModified) is required");
  timestamp(guide.dateModified);
  if (guideWordCount(guide) < 600) fail("guide must contain at least 600 words");
  const normalise = (text) => text.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
  const headings = guide.sections.map((section) => normalise(section.heading));
  if (headings.includes(normalise(guide.title))) fail("section heading duplicates the H1");
  if (new Set(headings).size !== headings.length) fail("duplicate section headings");
  if (new Set(guide.sections.map((section) => section.id)).size !== guide.sections.length) fail("duplicate section anchors");
  if (!headings.includes("before you rely on this")) fail("limitations block is required");
  const figures = guide.sections.flatMap((section) => section.figures ?? []);
  if (figures.length === 0) fail("at least one figure is required");
  for (const figure of figures) {
    if (!/^\/guides\/[a-z0-9-]+\/[a-z0-9-]+\.(webp|png)$/.test(figure.src)) fail("figure must be a local guide asset");
    if (!figure.alt?.trim() || !figure.caption?.trim()) fail("figure alt text and caption are required");
    if (![figure.width, figure.height].every((value) => Number.isInteger(value) && value > 0)) fail("explicit positive image dimensions are required");
  }
  return { slug: guide.slug, words: guideWordCount(guide), figures };
}

export async function validateGuideAssets(guides, dist) {
  for (const guide of guides) {
    const result = validateGuide(guide);
    for (const figure of result.figures) {
      const bytes = await readFile(path.join(dist, figure.src.slice(1)));
      if (bytes.length > 150_000) throw new Error(`${figure.src}: figure exceeds 150 KB`);
      const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
      const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      if (!(figure.src.endsWith(".webp") ? webp : png)) throw new Error(`${figure.src}: invalid image signature`);
    }
  }
}
