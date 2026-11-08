import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGuide, guideWordCount } from "../scripts/guide-quality.mjs";

const valid = {
  slug: "example", title: "Example guide", introduction: "A useful introduction.", dateModified: "2026-09-16",
  sections: [{ id: "steps", heading: "Do the work", paragraphs: ["word ".repeat(610)], figures: [{ src: "/guides/example/result.webp", alt: "Result panel", caption: "The actual result.", width: 800, height: 450 }] }, { id: "limits", heading: "Before you rely on this", callout: "Check the result." }],
};
test("guide quality rejects incomplete editorial content", () => {
  assert.ok(guideWordCount(valid) >= 600);
  assert.doesNotThrow(() => validateGuide(valid));
  assert.throws(() => validateGuide({ ...valid, dateModified: undefined }), /updated date/);
  assert.throws(() => validateGuide({ ...valid, sections: valid.sections.slice(1) }), /600 words/);
  assert.throws(() => validateGuide({ ...valid, title: "Do the work" }), /duplicates the H1/);
  assert.throws(() => validateGuide({ ...valid, sections: [valid.sections[0]] }), /limitations block/);
});
test("guide quality rejects missing or unbounded figures", () => {
  const change = (figures) => ({ ...valid, sections: [{ ...valid.sections[0], figures }, valid.sections[1]] });
  const figure = valid.sections[0].figures[0];
  assert.throws(() => validateGuide(change([])), /at least one figure/);
  assert.throws(() => validateGuide(change([{ ...figure, src: "https://example.com/image.webp" }])) , /local guide asset/);
  assert.throws(() => validateGuide(change([{ ...figure, width: undefined }])) , /dimensions/);
  assert.throws(() => validateGuide(change([{ ...figure, alt: "" }])) , /alt text/);
});
