import { describe, expect, it } from "vitest";
import {
  guideCategoryConfig,
  guideCategoryOrder,
  guides,
} from "../../src/config/guides";
import { fullGuides } from "../../src/config/guide-library";
import { publicRouteDocuments, routes } from "../../src/config/routes";

function expectUnique(values: readonly string[]) {
  expect(new Set(values).size).toBe(values.length);
}

describe("guide configuration", () => {
  it("keeps guide data and public guide routes in exact one-to-one agreement", () => {
    const guideRoutes = publicRouteDocuments.filter(
      (route) => route.routeType === "guide",
    );

    expect(guides).toHaveLength(guideRoutes.length);
    expect(new Set(guides.map((guide) => guide.path))).toEqual(
      new Set(guideRoutes.map((route) => route.path)),
    );

    for (const guide of fullGuides) {
      const route = guideRoutes.find((candidate) => candidate.path === guide.path);
      expect(route, guide.path).toBeDefined();
      expect(guide.path).toBe(`/guides/${guide.slug}`);
      expect(route?.heading).toBe(guide.title);
      expect(route).not.toHaveProperty("lastModified");
    }
  });

  it("uses unique route and guide identities", () => {
    expectUnique(guides.map((guide) => guide.slug));
    expectUnique(guides.map((guide) => guide.path));
    expectUnique(publicRouteDocuments.map((route) => route.path));
    expectUnique(publicRouteDocuments.map((route) => route.outputFile));
    expectUnique(publicRouteDocuments.map((route) => route.title));
    expectUnique(publicRouteDocuments.map((route) => route.description));
  });

  it("validates categories, tool actions, dates, section ids and related links", () => {
    const guideSlugs = new Set(guides.map((guide) => guide.slug));
    const validToolPaths = new Set<string>([
      routes.tool,
      routes.hideMessage,
      routes.mediaInspector,
      routes.stegoAnalysis,
      ...(routes.pdfToText ? [routes.pdfToText] : []),
    ]);

    expect(Object.keys(guideCategoryConfig)).toEqual([...guideCategoryOrder]);

    for (const categoryId of guideCategoryOrder) {
      const category = guideCategoryConfig[categoryId];
      expect(category.id).toBe(categoryId);
      expect(validToolPaths.has(category.actionPath)).toBe(true);
      expect(guides.some((guide) => guide.category === categoryId)).toBe(true);
    }

    for (const guide of fullGuides) {
      expect(guideCategoryConfig[guide.category]).toBeDefined();
      expect(validToolPaths.has(guide.primaryActionPath.split(/[?#]/, 1)[0])).toBe(
        true,
      );
      // A reviewed modification date does not establish a first deployment.
      if (guide.datePublished) expect(guide.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (guide.dateModified) expect(guide.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (guide.datePublished && guide.dateModified) {
        expect(guide.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(guide.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(guide.dateModified >= guide.datePublished).toBe(true);
      }
      expectUnique(guide.sections.map((section) => section.id));
      expect(guide.relatedGuideSlugs).toHaveLength(3);
      expectUnique(guide.relatedGuideSlugs);

      for (const relatedSlug of guide.relatedGuideSlugs) {
        expect(guideSlugs.has(relatedSlug)).toBe(true);
        expect(relatedSlug).not.toBe(guide.slug);
      }
    }
  });
});

describe("guide copy stays in sync with tool limits", () => {
  it("states the real per-image limits, formats and language count", async () => {
    const { FILE_LIMITS, OCR_IMAGE_FORMATS } = await import("../../src/config/product");
    const { OCR_LANGUAGES, MAX_OCR_LANGUAGES } = await import("../../src/config/ocr-languages");
    const text = (slug: string) => JSON.stringify(fullGuides.find((guide) => guide.slug === slug));
    const batch = text("batch-ocr-multiple-images");
    expect(batch).toContain(`${FILE_LIMITS.maxBytes / (1024 * 1024)} MiB and ${FILE_LIMITS.maxDecodedPixels / 1_000_000} megapixels`);
    for (const format of Object.values(OCR_IMAGE_FORMATS)) expect(batch).toContain(format.label);
    const languages = text("ocr-in-other-languages");
    expect(OCR_LANGUAGES).toHaveLength(12);
    expect(languages).toContain("in 12 languages");
    expect(MAX_OCR_LANGUAGES).toBe(3);
    for (const model of OCR_LANGUAGES) expect(languages).toContain(model.label);
  });
});

describe("search snippet lengths", () => {
  it("keeps every public route title within 60 characters and description within 160", () => {
    for (const route of publicRouteDocuments) {
      expect(route.title.length, `${route.path} title`).toBeLessThanOrEqual(60);
      expect(route.description.length, `${route.path} description`).toBeLessThanOrEqual(160);
    }
  });
});
