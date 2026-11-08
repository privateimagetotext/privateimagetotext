import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fullGuides as guides } from "../../src/config/guide-library";
import { guideStructuredData, serializeStructuredData, structuredDataForPath } from "../../src/config/structured-data";

describe("structured data", () => {
  it("uses Article for a guide without ordered steps and never invents dates", () => {
    const article = guideStructuredData({ ...guides[0], datePublished: undefined, dateModified: undefined,
      sections: [{ id: "explanation", heading: "Explanation", paragraphs: ["Plain article content."] }] });
    expect(article["@type"]).toBe("Article");
    expect(article).not.toHaveProperty("step");
    expect(article).not.toHaveProperty("datePublished");
    expect(article).not.toHaveProperty("dateModified");
    const html = renderToStaticMarkup(createElement("script", { type: "application/ld+json",
      dangerouslySetInnerHTML: { __html: serializeStructuredData({ "@context": "https://schema.org", "@graph": [article] }) } }));
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(JSON.parse(container.querySelector("script")!.textContent!)["@graph"][0]).toEqual(article);
  });

  it("keeps multiple ordered procedures in their named sections", () => {
    const guide = guides.find((item) => item.sections.filter((section) => section.steps?.length).length > 1)!;
    const schema = guideStructuredData(guide);
    expect(schema.step).toEqual(guide.sections.filter((section) => section.steps?.length).map((section, index) => ({
      "@type": "HowToSection", name: section.heading, position: index + 1,
      itemListElement: section.steps!.map((text, position) => expect.objectContaining({ "@type": "HowToStep", text, position: position + 1 })),
    })));
  });

  it("round-trips script-closing and HTML-sensitive text without executable markup", () => {
    const value = { text: '</script><script>alert("x")</script>&\u2028\u2029' };
    const serialized = serializeStructuredData(value);
    expect(serialized).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it("uses the loaded guide body for steps and stays a plain Article until it arrives", async () => {
    const { guideContentsSnapshot, registerGuideContents } = await import("../../src/config/guide-content-store");
    const guide = guides.find((item) => item.sections.some((section) => section.steps?.length))!;
    const node = (contents: ReadonlyMap<string, unknown>) => structuredDataForPath(guide.path, {}, contents as never)["@graph"]
      .find((item: Record<string, unknown>) => item["@id"] === `https://privateimagetotext.com${guide.path}#guide`);
    // Before the guide chunk loads (client navigation only): no steps yet.
    expect(node(new Map())).toMatchObject({ "@type": "Article", name: guide.title });
    expect(node(new Map())).not.toHaveProperty("step");
    // Importing the guide library registers every body for the shell.
    expect(guideContentsSnapshot().get(guide.slug)).toBeDefined();
    expect(node(guideContentsSnapshot())?.["@type"]).toBe("HowTo");
    const listener = vi.fn();
    const { subscribeGuideContents } = await import("../../src/config/guide-content-store");
    const unsubscribe = subscribeGuideContents(listener);
    const current = guideContentsSnapshot();
    registerGuideContents(new Map(current));
    registerGuideContents(current);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("unknown routes contain only the shared site and organization", () => {
    expect(structuredDataForPath("/missing")["@graph"].map((node) => node["@type"]))
      .toEqual(["WebSite", "Organization"]);
  });
});
