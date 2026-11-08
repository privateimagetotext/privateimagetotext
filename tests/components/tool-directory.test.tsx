import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ToolDirectory, ToolStrip } from "../../src/components/ToolDirectory";
import { guides } from "../../src/config/guides";
import { isPublicDocumentRoute, publicRouteDocuments } from "../../src/config/routes";
import { otherTools, toolDirectory } from "../../src/config/tool-directory";
import { NotFoundPage } from "../../src/pages/NotFoundPage";

const publicTools = publicRouteDocuments.filter((route) => route.routeType === "tool");

describe("tool directory", () => {
  it("lists every public tool route exactly once", () => {
    expect(toolDirectory.map((tool) => tool.path).sort())
      .toEqual(publicTools.map((route) => route.path).sort());
    for (const tool of toolDirectory) expect(isPublicDocumentRoute(tool.path)).toBe(true);
  });

  it("never describes capabilities the product does not claim", () => {
    const copy = toolDirectory.map((tool) => `${tool.name} ${tool.summary} ${tool.actionLabel}`).join(" ");
    expect(copy).not.toMatch(/undetectable|secure deletion|AI detector|detects AI|guarantee|100%/i);
  });

  it.each(toolDirectory.map((tool) => tool.path))("leaves out the current tool %s", (path) => {
    expect(otherTools(path).map((tool) => tool.path)).not.toContain(path);
    expect(otherTools(path)).toHaveLength(toolDirectory.length - 1);
  });

  it("opens other tools in a new tab from a workspace page so unsaved work is kept", () => {
    render(<MemoryRouter><ToolDirectory id="other" currentPath="/hide-message" newTab /></MemoryRouter>);
    const section = screen.getByRole("region", { name: "Other tools that keep your files in this browser" });
    const links = within(section).getAllByRole("link");
    expect(links).toHaveLength(toolDirectory.length - 1);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveAccessibleName(/\(opens in a new tab\)$/);
      expect(link).not.toHaveAttribute("href", "/hide-message");
    }
  });

  it("uses ordinary same-tab links when nothing would be lost", () => {
    render(<MemoryRouter><ToolDirectory id="all" compact /></MemoryRouter>);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(toolDirectory.length);
    for (const link of links) {
      expect(link).not.toHaveAttribute("target");
      expect(link.textContent).not.toMatch(/new tab/);
    }
  });

  it("renders a labelled strip of the other tools", () => {
    render(<MemoryRouter><ToolStrip currentPath="/" /></MemoryRouter>);
    const strip = screen.getByRole("navigation", { name: "Other tools" });
    const links = within(strip).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href")))
      .toEqual(otherTools("/").map((tool) => tool.path));
    // The strip sits above the workspace, so it must not discard started work.
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveAccessibleName(/\(opens in a new tab\)$/);
    }
  });
});

describe("not-found page", () => {
  it("routes a lost visitor to every tool, popular guides and the main pages", () => {
    render(<MemoryRouter initialEntries={["/missing"]}><NotFoundPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "There is no page at this address" })).toBeInTheDocument();
    const tools = screen.getByRole("region", { name: "Pick a tool" });
    expect(within(tools).getAllByRole("link").map((link) => link.getAttribute("href")))
      .toEqual(toolDirectory.map((tool) => tool.path));

    const popular = screen.getByRole("region", { name: "Popular guides" });
    const guideLinks = within(popular).getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(guideLinks.length).toBeGreaterThanOrEqual(4);
    const guidePaths = new Set<string>(guides.map((guide) => guide.path));
    for (const href of guideLinks.filter((href) => href !== "/guides")) {
      expect(guidePaths.has(href!)).toBe(true);
    }
    expect(screen.getByRole("navigation", { name: "Useful pages" })).toBeInTheDocument();
    expect(screen.queryByText(/local build|local application/i)).not.toBeInTheDocument();
  });
});
