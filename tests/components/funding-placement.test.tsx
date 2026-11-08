import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import App from "../../src/App";
import { AppFooter } from "../../src/components/AppFooter";
import { findFullGuide } from "../../src/config/guide-library";
import { productConfig, type MonetisationConfig } from "../../src/config/product";
import { AboutPage } from "../../src/pages/AboutPage";
import { FundingPage } from "../../src/pages/FundingPage";
import { GuidePage } from "../../src/pages/GuidePage";

const original = productConfig.monetisation;
const mutableConfig = productConfig as unknown as { monetisation: MonetisationConfig };
// GuidePage renders the complete guide (metadata joined with its body).
const guide = findFullGuide("remove-photo-metadata-before-sharing") as unknown as {
  pairedTools?: readonly string[];
};
const originalPairedTools = guide.pairedTools;

const affiliate = {
  id: "example-drive",
  partner: "Example",
  product: "Example Drive",
  description: "End-to-end encrypted cloud storage for the original photos.",
  url: "https://go.partner.example/aff?offer=1",
  host: "go.partner.example",
};

function configure(change: Partial<MonetisationConfig>) {
  mutableConfig.monetisation = { ...original, ...change };
}

function renderAt(path: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/guides/:guideSlug" element={element} />
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

const FUNDING = '[data-funding-link], [data-funding-block], .paired-tools, .support-link, a[rel~="sponsored"]';

function StubWorkspace() {
  return <main id="main-content">Tool workspace</main>;
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App
        ToolRoute={StubWorkspace}
        HideMessageRoute={StubWorkspace}
        MediaInspectorRoute={StubWorkspace}
        PdfOcrRoute={StubWorkspace}
        GuideRoute={GuidePage}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  mutableConfig.monetisation = original;
  guide.pairedTools = originalPairedTools;
});

describe("funding link placement", () => {
  it("shows the paired-tools block on a guide only when it references a valid entry", () => {
    configure({ affiliates: [affiliate] });
    guide.pairedTools = undefined;
    const { unmount } = renderAt("/guides/remove-photo-metadata-before-sharing", <GuidePage />);
    expect(document.querySelector('[data-funding-block], [rel~="sponsored"]')).toBeNull();
    unmount();

    guide.pairedTools = ["example-drive"];
    renderAt("/guides/remove-photo-metadata-before-sharing", <GuidePage />);
    const block = screen.getByRole("complementary", {
      name: "Privacy tools that pair well with this guide",
    });
    expect(within(block).getByRole("link", { name: /Example Drive/ }))
      .toHaveAttribute("rel", "sponsored noopener noreferrer");
    expect(block.closest("main article")).not.toBeNull();
  });

  it("shows the support link in the footer and About page only when configured", () => {
    configure({ support: { url: "" } });
    const { unmount } = render(<MemoryRouter><AppFooter /><AboutPage /></MemoryRouter>);
    expect(document.querySelector('[data-funding-link="support"]')).toBeNull();
    expect(screen.getAllByRole("link", { name: "How this site is funded" }).length)
      .toBeGreaterThanOrEqual(2);
    unmount();

    configure({ support: { url: "https://github.com/sponsors/example" } });
    render(<MemoryRouter><AppFooter showSupport /><AboutPage /></MemoryRouter>);
    const links = screen.getAllByRole("link", { name: /Support on GitHub Sponsors/ });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "https://github.com/sponsors/example");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(within(screen.getByRole("contentinfo")).getAllByRole("link", { name: /Support on/ }))
      .toHaveLength(1);
  });

  it("states the current funding status from the validated configuration", () => {
    configure({ support: { url: "" } });
    const { unmount } = render(<MemoryRouter><FundingPage /></MemoryRouter>);
    expect(screen.getByText("There is no support link yet.")).toBeInTheDocument();
    expect(screen.getByText("There are currently no affiliate links on this site.")).toBeInTheDocument();
    unmount();

    configure({
      support: { url: "https://ko-fi.com/example" },
      affiliates: [affiliate, { ...affiliate, id: "broken", host: "elsewhere.example" }],
    });
    render(<MemoryRouter><FundingPage /></MemoryRouter>);
    expect(screen.getByText("A support link through Ko-fi is available.")).toBeInTheDocument();
    expect(screen.getByText(/Guides may contain affiliate links for: Example Drive\./)).toBeInTheDocument();
    // The funding page explains affiliates but never renders one itself.
    expect(document.querySelector('[rel~="sponsored"]')).toBeNull();
  });

  it.each(["/", "/hide-message", "/media-inspector", "/pdf-to-text", "/steganography-analysis", "/no-such-page"])(
    "renders no funding component anywhere on %s, even with everything configured",
    (path) => {
      configure({ support: { url: "https://ko-fi.com/example" }, affiliates: [affiliate] });
      guide.pairedTools = ["example-drive"];
      const { unmount } = renderApp(path);
      expect(document.querySelector(FUNDING)).toBeNull();
      expect(document.body.textContent).not.toMatch(/Support on Ko-fi|paid link/);
      // The internal funding page link is plain site navigation and stays.
      expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "How this site is funded" }))
        .toHaveAttribute("href", "/funding");
      unmount();
    },
  );

  it("shows the footer support link on content and guide routes when configured", () => {
    configure({ support: { url: "https://ko-fi.com/example" }, affiliates: [affiliate] });
    guide.pairedTools = ["example-drive"];
    for (const path of ["/privacy", "/guides", "/guides/remove-photo-metadata-before-sharing"]) {
      const { unmount } = renderApp(path);
      expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: /Support on Ko-fi/ }))
        .toHaveAttribute("href", "https://ko-fi.com/example");
      const sponsored = document.querySelectorAll('a[rel~="sponsored"]');
      if (path.startsWith("/guides/")) {
        expect(sponsored).toHaveLength(1);
        expect(sponsored[0].closest("main article")).not.toBeNull();
      } else {
        expect(sponsored).toHaveLength(0);
      }
      unmount();
    }
  });

  it("keeps the footer support link off unless the shell allows it", () => {
    configure({ support: { url: "https://ko-fi.com/example" } });
    render(<MemoryRouter><AppFooter /></MemoryRouter>);
    expect(document.querySelector(FUNDING)).toBeNull();
  });
});
