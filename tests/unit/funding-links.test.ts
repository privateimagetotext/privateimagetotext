import { createElement } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { PairedTools } from "../../src/components/AffiliateLink";
import { SupportLink } from "../../src/components/SupportLink";
import { productConfig } from "../../src/config/product";
import {
  footerMayShowSupport,
  resolveAffiliateEntry,
  resolveAffiliateIds,
  resolveAffiliateRegistry,
  resolveSupportLink,
  type AffiliateEntry,
} from "../../src/lib/funding-links";

const validAffiliate: AffiliateEntry = {
  id: "example-pass",
  partner: "Example",
  product: "Example Pass",
  description: "An end-to-end encrypted password manager.",
  url: "https://go.partner.example/aff_c?offer_id=1&aff_id=2",
  host: "go.partner.example",
};

function withRouter(element: ReturnType<typeof createElement>) {
  return createElement(MemoryRouter, null, element);
}

describe("shipped defaults", () => {
  it("ships one valid Ko-fi support link and an empty affiliate registry", () => {
    expect(productConfig.monetisation.support.url).toBe("https://ko-fi.com/privateimagetotext82499");
    expect(productConfig.monetisation.affiliates).toEqual([]);
    expect(resolveSupportLink(productConfig.monetisation.support)).toEqual({
      platform: "ko-fi",
      platformName: "Ko-fi",
      href: "https://ko-fi.com/privateimagetotext82499",
    });
    expect(resolveAffiliateRegistry(productConfig.monetisation.affiliates).size).toBe(0);
  });

  it("renders nothing from an empty configuration", () => {
    for (const placement of ["footer", "about", "funding"] as const) {
      const { container } = render(createElement(SupportLink, { placement, config: { url: "" } }));
      expect(container).toBeEmptyDOMElement();
    }
    const { container } = render(
      withRouter(createElement(PairedTools, { ids: ["proton-pass", "example-pass"] })),
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("support link validation", () => {
  it.each([
    ["https://ko-fi.com/simon", "ko-fi", "Ko-fi"],
    ["https://ko-fi.com/simon_tools/", "ko-fi", "Ko-fi"],
    ["https://github.com/sponsors/example", "github-sponsors", "GitHub Sponsors"],
    ["https://buymeacoffee.com/simon", "buy-me-a-coffee", "Buy Me a Coffee"],
    ["https://www.buymeacoffee.com/simon", "buy-me-a-coffee", "Buy Me a Coffee"],
  ])("accepts %s", (url, platform, platformName) => {
    expect(resolveSupportLink({ url })).toEqual({ platform, platformName, href: url });
  });

  it.each([
    ["empty", ""],
    ["http", "http://ko-fi.com/simon"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,hi"],
    ["protocol-relative", "//ko-fi.com/simon"],
    ["unlisted host", "https://patreon.com/simon"],
    ["lookalike host", "https://ko-fi.com.evil.example/simon"],
    ["subdomain", "https://www.ko-fi.com/simon"],
    ["upper-case host", "https://Ko-fi.com/simon"],
    ["credentials", "https://user:pass@ko-fi.com/simon"],
    ["at-sign confusion", "https://ko-fi.com@evil.example/simon"],
    ["port", "https://ko-fi.com:8443/simon"],
    ["query string", "https://ko-fi.com/simon?ref=site"],
    ["fragment", "https://ko-fi.com/simon#tip"],
    ["nested path", "https://ko-fi.com/simon/shop"],
    ["host root", "https://ko-fi.com/"],
    ["GitHub non-sponsor page", "https://github.com/example"],
    ["GitHub sponsors root", "https://github.com/sponsors"],
    ["backslash", "https://ko-fi.com\\@evil.example/"],
    ["whitespace", " https://ko-fi.com/simon"],
    ["encoded path", "https://ko-fi.com/%2e%2e"],
    ["dot segment", "https://ko-fi.com/./simon"],
    ["bare query mark", "https://ko-fi.com/simon?"],
    ["bare fragment mark", "https://ko-fi.com/simon#"],
    ["GitHub trailing hyphen", "https://github.com/sponsors/example-"],
    ["GitHub double hyphen", "https://github.com/sponsors/ex--ample"],
  ])("rejects %s", (_label, url) => {
    expect(resolveSupportLink({ url })).toBeNull();
  });

  it("rejects missing or non-string configuration", () => {
    expect(resolveSupportLink(undefined)).toBeNull();
    expect(resolveSupportLink({ url: 42 as unknown as string })).toBeNull();
  });

  it("renders one plain anchor with safe attributes and no other elements", () => {
    const { container } = render(
      createElement(SupportLink, {
        placement: "footer",
        config: { url: "https://ko-fi.com/simon" },
      }),
    );
    const link = screen.getByRole("link", { name: /Support on Ko-fi/ });
    expect(link).toHaveAttribute("href", "https://ko-fi.com/simon");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("img, script, iframe, form, object, embed")).toBeNull();
  });
});

describe("footer route allowlist", () => {
  it("allows only content, guide-index and guide routes", () => {
    expect(["content", "guide-index", "guide"].every(footerMayShowSupport)).toBe(true);
    for (const type of ["tool", "not-found", "", undefined, "Content"]) {
      expect(footerMayShowSupport(type)).toBe(false);
    }
  });
});

describe("affiliate validation", () => {
  it("accepts a programme-issued URL with an encoded path and query", () => {
    const url = "https://go.partner.example/aff_c/%7Eoffer?offer_id=1&url_id=2&aff_sub=guide";
    expect(resolveAffiliateEntry({ ...validAffiliate, url })?.href).toBe(url);
  });

  it("accepts a complete entry whose URL uses its declared host", () => {
    expect(resolveAffiliateEntry(validAffiliate)).toEqual({
      id: validAffiliate.id,
      partner: validAffiliate.partner,
      product: validAffiliate.product,
      description: validAffiliate.description,
      href: validAffiliate.url,
    });
  });

  it.each<[string, Partial<AffiliateEntry>]>([
    ["host mismatch", { host: "partner.example" }],
    ["missing host", { host: "" }],
    ["wildcard host", { host: "*.partner.example" }],
    ["IP host", { host: "203.0.113.4", url: "https://203.0.113.4/x" }],
    ["http URL", { url: "http://go.partner.example/x" }],
    ["javascript URL", { url: "javascript:alert(1)" }],
    ["credentials", { url: "https://a:b@go.partner.example/x" }],
    ["port", { url: "https://go.partner.example:444/x" }],
    ["shortener", { host: "bit.ly", url: "https://bit.ly/abc" }],
    ["shortener subdomain", { host: "www.bit.ly", url: "https://www.bit.ly/abc" }],
    ["dot segments", { url: "https://go.partner.example/a/../b?x=1" }],
    ["backslash path", { url: "https://go.partner.example/x\\y" }],
    ["unencoded non-ASCII", { url: "https://go.partner.example/\u00e9" }],
    ["unencoded quote", { url: 'https://go.partner.example/x?q="><' }],
    ["trailing-dot host", { host: "go.partner.example.", url: "https://go.partner.example./x" }],
    ["upper-case URL host", { url: "https://GO.partner.example/x" }],
    ["first-party redirect", { host: "privateimagetotext.com", url: "https://privateimagetotext.com/go/x" }],
    ["first-party subdomain", { host: "go.privateimagetotext.com", url: "https://go.privateimagetotext.com/x" }],
    ["bad id", { id: "Example Pass" }],
    ["empty product", { product: "" }],
    ["empty partner", { partner: "" }],
    ["empty description", { description: "" }],
    ["markup in copy", { description: "<img src=x>" }],
    ["overlong copy", { description: "x".repeat(241) }],
  ])("rejects %s", (_label, change) => {
    expect(resolveAffiliateEntry({ ...validAffiliate, ...change })).toBeNull();
  });

  it("drops every entry that shares an id, and unknown or repeated references", () => {
    const other = { ...validAffiliate, id: "example-drive", product: "Example Drive" };
    expect(resolveAffiliateRegistry([validAffiliate, { ...validAffiliate }, other]).size).toBe(1);
    expect(resolveAffiliateIds(["missing", "example-drive", "example-drive"], [other]))
      .toEqual([expect.objectContaining({ id: "example-drive" })]);
    expect(resolveAffiliateIds(undefined, [other])).toEqual([]);
    expect(resolveAffiliateIds(["example-drive"], undefined)).toEqual([]);
  });

  it("renders nothing when every referenced entry is invalid", () => {
    const { container } = render(
      withRouter(createElement(PairedTools, {
        ids: ["example-pass"],
        registry: [{ ...validAffiliate, host: "other.example" }],
      })),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders each valid link with sponsored attributes and an adjacent disclosure", () => {
    const { container } = render(
      withRouter(createElement(PairedTools, {
        ids: ["example-pass"],
        registry: [validAffiliate],
      })),
    );
    const block = screen.getByRole("complementary", {
      name: "Privacy tools that pair well with this guide",
    });
    expect(block).toHaveTextContent(/these are affiliate links/);
    expect(block).toHaveTextContent(/may earn a commission/);
    const link = within(block).getByRole("link", { name: /Example Pass/ });
    expect(link).toHaveAttribute("href", validAffiliate.url);
    expect(link).toHaveAttribute("rel", "sponsored noopener noreferrer");
    expect(link.nextElementSibling).toHaveTextContent(
      "(paid link: this site may earn a commission if you sign up or buy)",
    );
    expect(within(block).getByRole("link", { name: "How this site is funded" }))
      .toHaveAttribute("href", "/funding");
    expect(container.querySelector("img, script, iframe, form, object, embed")).toBeNull();
  });
});

describe("placement boundary in source", () => {
  const sourceRoot = join(__dirname, "../../src");
  const files = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
    });
  const importers = (module: string) =>
    files(sourceRoot)
      .filter((file) =>
        new RegExp(`(?:from|import\\()\\s*["'][./]+(?:components/)?${module}(?:\\.tsx?)?["']`).test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(sourceRoot, file).replace(/\\/g, "/"))
      .sort();

  it("mounts affiliate links only from the guide page", () => {
    expect(importers("AffiliateLink")).toEqual(["pages/GuidePage.tsx"]);
  });

  it("mounts the support link only in the footer, About and funding pages", () => {
    expect(importers("SupportLink")).toEqual([
      "components/AppFooter.tsx",
      "pages/AboutPage.tsx",
      "pages/FundingPage.tsx",
    ]);
  });

  it("keeps funding code out of every tool feature module", () => {
    for (const file of files(join(sourceRoot, "features"))) {
      expect(readFileSync(file, "utf8")).not.toMatch(/funding-links|SupportLink|AffiliateLink/);
    }
  });
});
