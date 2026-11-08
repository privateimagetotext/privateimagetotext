import { guides, type GuideContent, type GuideMeta } from "./guides";
import { guideContentsSnapshot } from "./guide-content-store";
import { productConfig, PUBLIC_TOOL_TERMS } from "./product";
import { publicRouteDocuments, routes, SITE_ORIGIN } from "./routes";
import { hideMessageCopy, mediaInspectorCopy, pdfCopy, stegoAnalysisCopy } from "./tool-copy";
import { ocrToolFeatures } from "./ocr-tool-facts";
import { toolDirectory } from "./tool-directory";
import { homepageFaqs, faqAnswerText } from "./homepage-faq";
import { SITE_AUTHOR_NAME } from "./site-author";

export type StructuredDataDates = Readonly<Record<string, string>>;
type SchemaNode = Record<string, unknown>;
const absolute = (path: string) => new URL(path, SITE_ORIGIN).href;
const organization = { "@id": absolute("/#organization") };

// Steps come from the guide body. Before the guide route has loaded its
// content (client navigation only), the node is a plain Article; the server
// render and hydration always have the content.
export function guideStructuredData(guide: GuideMeta & Partial<Pick<GuideContent, "sections">>, lastModified?: string): SchemaNode {
  const sections = (guide.sections ?? []).filter((section) => section.steps?.length);
  const steps = (section: (typeof sections)[number]) => section.steps!.map((text, index) => ({
    "@type": "HowToStep",
    position: index + 1,
    text,
    url: absolute(`${guide.path}#${section.id}-step-${index + 1}`),
  }));
  return {
    "@type": sections.length ? "HowTo" : "Article",
    "@id": absolute(`${guide.path}#guide`),
    url: absolute(guide.path),
    name: guide.title,
    description: guide.summary,
    inLanguage: "en-AU",
    author: organization,
    publisher: organization,
    ...(guide.datePublished ? { datePublished: guide.datePublished } : {}),
    ...(lastModified || guide.dateModified ? { dateModified: lastModified ?? guide.dateModified } : {}),
    ...(sections.length ? {
      step: sections.length === 1 ? steps(sections[0]) : sections.map((section, index) => ({
        "@type": "HowToSection",
        name: section.heading,
        position: index + 1,
        itemListElement: steps(section),
      })),
    } : {}),
  };
}

export function breadcrumbsForPath(pathname: string) {
  const guide = guides.find((item) => item.path === pathname);
  if (guide) return [
    { name: "Guides", path: routes.guides },
    { name: guide.shortTitle, path: guide.path },
  ];
  const route = publicRouteDocuments.find((item) => item.path === pathname);
  if (route && pathname.endsWith("/technical")) {
    const parent = publicRouteDocuments.find((item) => item.path === pathname.replace(/\/technical$/, ""));
    if (parent) return [
      { name: parent.heading, path: parent.path },
      { name: route.heading, path: route.path },
    ];
  }
  return [];
}

export function structuredDataForPath(
  pathname: string,
  dates: StructuredDataDates = {},
  contents: ReadonlyMap<string, GuideContent> = guideContentsSnapshot(),
) {
  const graph: SchemaNode[] = [
    {
      "@type": "WebSite", "@id": absolute("/#website"),
      name: productConfig.name, url: absolute("/"), inLanguage: "en-AU", publisher: organization,
    },
    {
      "@type": "Organization", ...organization,
      name: productConfig.name, url: absolute("/"), logo: absolute("/icon.svg"),
      contactPoint: { "@type": "ContactPoint", email: productConfig.contactEmail },
    },
  ];
  const route = publicRouteDocuments.find((item) => item.path === pathname);
  const copy = pathname === routes.hideMessage ? hideMessageCopy
    : pathname === routes.mediaInspector ? mediaInspectorCopy
    : pathname === routes.stegoAnalysis ? stegoAnalysisCopy
    : pathname === routes.pdfToText ? pdfCopy : undefined;
  if (route && (pathname === routes.tool || copy)) {
    graph.push({
      // browserRequirements belongs to WebApplication, a SoftwareApplication subtype.
      "@type": ["SoftwareApplication", "WebApplication"],
      "@id": absolute(`${pathname}#application`),
      // The product's own tool name; the search-oriented <title> stays in metadata.
      name: pathname === routes.tool ? productConfig.name
        : toolDirectory.find((tool) => tool.path === pathname)?.name ?? route.title,
      description: route.description, url: absolute(pathname),
      applicationCategory: "UtilitiesApplication", operatingSystem: "Any (web browser)",
      browserRequirements: "Modern browser with WebAssembly",
      offers: { "@type": "Offer", price: PUBLIC_TOOL_TERMS.price, priceCurrency: PUBLIC_TOOL_TERMS.priceCurrency },
      featureList: copy ? [copy.introduction, ...copy.facts] : ocrToolFeatures,
      publisher: organization,
    });
  }
  const guide = guides.find((item) => item.path === pathname);
  if (guide) graph.push(guideStructuredData({ ...guide, ...contents.get(guide.slug) }, dates[pathname]));
  const breadcrumbs = breadcrumbsForPath(pathname);
  if (breadcrumbs.length) graph.push({
    "@type": "BreadcrumbList", "@id": absolute(`${pathname}#breadcrumbs`),
    itemListElement: breadcrumbs.map((crumb, index) => ({
      "@type": "ListItem", position: index + 1, name: crumb.name, item: absolute(crumb.path),
    })),
  });
  if (pathname === routes.about) {
    const person = { "@id": absolute(`${routes.about}#author`) };
    graph[1].founder = person;
    graph.push({ "@type": "Person", ...person, name: SITE_AUTHOR_NAME });
  }
  if (pathname === routes.tool) graph.push({
    "@type": "FAQPage", "@id": absolute("/#faq"),
    mainEntity: homepageFaqs.map((faq) => ({
      "@type": "Question", name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faqAnswerText(faq) },
    })),
  });
  return { "@context": "https://schema.org", "@graph": graph };
}

export function serializeStructuredData(value: unknown) {
  // A JSON string must never be able to close the HTML script data block.
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
