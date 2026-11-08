import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppHeader } from "../../src/components/AppHeader";
import { AppFooter } from "../../src/components/AppFooter";
import { LocalProcessingBadge } from "../../src/components/LocalProcessingBadge";
import { MonetisationSlot } from "../../src/components/MonetisationSlot";
import { ThemeToggle } from "../../src/components/ThemeToggle";
import { GuidePage } from "../../src/pages/GuidePage";
import { ContentPage } from "../../src/pages/ContentPage";
import { GuidesPage } from "../../src/pages/GuidesPage";
import { PrivacyPage } from "../../src/pages/PrivacyPage";
import { TechnicalHowItWorksPage } from "../../src/pages/TechnicalHowItWorksPage";
import { TechnicalPrivacyPage } from "../../src/pages/TechnicalPrivacyPage";
import { VerifyPage } from "../../src/pages/VerifyPage";

function renderHeader() {
  return render(
    <MemoryRouter>
      <AppHeader localStatus="local-processing" />
      <main>Page content</main>
      <footer className="app-footer">Footer content</footer>
    </MemoryRouter>,
  );
}

describe("application chrome", () => {
  it.each(["datePublished", "dateModified"] as const)("renders the known article date %s independently", (property) => {
    const unknown = property === "datePublished" ? "dateModified" : "datePublished";
    render(<MemoryRouter><ContentPage eyebrow="Guide" title="Dated content" introduction="Example"
      articleMetadata={{ authorName: "Test author", datePublished: undefined, dateModified: undefined, [property]: "2026-09-06" }}>
      <p>Example content</p>
    </ContentPage></MemoryRouter>);
    expect(document.querySelector(`[data-article-date="${property}"]`)).toHaveAttribute("datetime", "2026-09-06");
    expect(document.querySelector(`[data-article-date="${unknown}"]`)).not.toBeInTheDocument();
    expect(screen.getByText(`${property === "datePublished" ? "Published" : "Updated"} 6 September 2026`)).toBeInTheDocument();
  });

  it("opens an accessible navigation modal, makes the page inert, and closes on Escape", async () => {
    const user = userEvent.setup();
    renderHeader();
    const menuButton = screen.getByRole("button", {
      name: "Open navigation menu",
    });

    await user.click(menuButton);

    const dialog = screen.getByRole("dialog", { name: "Navigation menu" });
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    expect(
      within(dialog).getByRole("navigation", {
        name: "Primary navigation",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "Privacy" }),
    ).toHaveAttribute("href", "/privacy");
    expect(screen.getByText("Page content").closest("main")?.inert).toBe(true);
    expect(document.querySelector<HTMLElement>(".app-footer")?.inert).toBe(true);
    expect(document.body).toHaveClass("is-menu-open");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", {
          name: "Close navigation menu",
        }),
      ).toHaveFocus(),
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", { name: "Navigation menu" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open navigation menu" }),
    ).toHaveFocus();
    expect(document.body).not.toHaveClass("is-menu-open");
  });

  it("keeps theme controls synchronised and cycles system, light, dark", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ThemeToggle />
        <ThemeToggle />
      </>,
    );

    const systemButtons = screen.getAllByRole("button", {
      name: "Theme: System. Switch to light theme.",
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themePreference).toBe("system");

    await user.click(systemButtons[0]);

    expect(
      screen.getAllByRole("button", {
        name: "Theme: Light. Switch to dark theme.",
      }),
    ).toHaveLength(2);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themePreference).toBe("light");

    await user.click(
      screen.getAllByRole("button", {
        name: "Theme: Light. Switch to dark theme.",
      })[0],
    );
    expect(
      screen.getAllByRole("button", {
        name: "Theme: Dark. Switch to system theme.",
      }),
    ).toHaveLength(2);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("dark");

    await user.click(
      screen.getAllByRole("button", {
        name: "Theme: Dark. Switch to system theme.",
      })[0],
    );
    expect(
      screen.getAllByRole("button", {
        name: "Theme: System. Switch to light theme.",
      }),
    ).toHaveLength(2);
  });

  it("renders truthful local-processing status labels and descriptions", () => {
    const { rerender } = render(
      <LocalProcessingBadge status="local-processing" />,
    );
    expect(screen.getByText("Local processing").closest("[data-status]"))
      .toHaveAttribute("title", "This site processes your selected files and content in this browser.");

    rerender(<LocalProcessingBadge status="preparing-offline-app" />);
    expect(screen.getByText("Preparing offline app").closest("[data-status]"))
      .toHaveAttribute(
        "title",
        "The browser is saving the site files needed for offline use.",
      );

    rerender(<LocalProcessingBadge status="offline-app-ready" compact />);
    const badge = screen.getByText("Site available offline").closest("[data-status]");
    expect(badge).toHaveAttribute("data-status", "offline-app-ready");
    expect(badge).toHaveAttribute(
      "title",
      "The site files needed for offline use have been saved in this browser.",
    );
    expect(badge).toHaveClass("local-processing-badge--compact");

    rerender(<LocalProcessingBadge status="offline" />);
    expect(screen.getByText("Offline").closest("[data-status]")).toHaveAttribute(
      "title",
      "The browser is offline and this site is using saved site files.",
    );
  });

  it("keeps technical links in the footer rather than primary navigation", () => {
    render(
      <MemoryRouter>
        <AppFooter buildVersion="test-build" />
      </MemoryRouter>,
    );

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(/Free browser tools for extracting text, inspecting media/i))
      .toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Verify privacy" }))
      .toHaveAttribute("href", "/verify");
    expect(within(footer).getByRole("link", { name: "Technical documentation" }))
      .toHaveAttribute("href", "/how-it-works/technical");
    expect(within(footer).getByRole("link", { name: "Technical privacy architecture" }))
      .toHaveAttribute("href", "/privacy/technical");
    expect(within(footer).getByRole("link", { name: "contact@privateimagetotext.com" }))
      .toHaveAttribute("href", "mailto:contact@privateimagetotext.com");
    expect(within(footer).getByText("Version test-build")).toBeInTheDocument();
  });
});

describe("content and guide routes", () => {
  it("renders the privacy route with its local-tool action and content structure", () => {
    render(
      <MemoryRouter initialEntries={["/privacy"]}>
        <Routes>
          <Route path="/privacy" element={<PrivacyPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Your files and content stay in your browser.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /open extract text/i })
        .every((link) => link.getAttribute("href") === "/"),
    ).toBe(true);
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "The tools are separate",
      }),
    ).toBeInTheDocument();
    expect(document.querySelector("#main-content")).toHaveClass(
      "content-page",
      "content-page--with-toc",
      "privacy-page",
    );
    const onThisPage = screen.getAllByRole("navigation", { name: "On this page" });
    expect(onThisPage).toHaveLength(2);
    for (const navigation of onThisPage) {
      expect(within(navigation).getByRole("link", { name: "The short version" }))
        .toHaveAttribute("href", "#privacy-short-title");
      expect(within(navigation).getByRole("link", { name: "Hosting and traffic analytics" }))
        .toHaveAttribute("href", "#privacy-services-title");
      expect(within(navigation).getByRole("link", { name: "Contact" }))
        .toHaveAttribute("href", "#privacy-contact-title");
    }
    expect(screen.getByRole("link", { name: "contact@privateimagetotext.com" }))
      .toHaveAttribute("href", "mailto:contact@privateimagetotext.com");
  });

  it("renders the three supporting routes with one H1 and reciprocal links", () => {
    const pages = [
      {
        path: "/verify",
        element: <VerifyPage />,
        heading: "Check that your file is not uploaded",
        link: "Read the technical privacy architecture",
      },
      {
        path: "/privacy/technical",
        element: <TechnicalPrivacyPage />,
        heading: "Technical privacy architecture",
        link: "Read the plain-language Privacy page",
      },
      {
        path: "/how-it-works/technical",
        element: <TechnicalHowItWorksPage />,
        heading: "Technical documentation for OCR, media inspection and image steganography",
        link: "Read the plain How it works page",
      },
    ];

    for (const page of pages) {
      const view = render(
        <MemoryRouter initialEntries={[page.path]}>
          {page.element}
        </MemoryRouter>,
      );
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 1, name: page.heading }))
        .toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: page.link }).length).toBeGreaterThan(0);
      if (page.path === "/privacy/technical") {
        expect(screen.getByRole("link", { name: "contact@privateimagetotext.com" }))
          .toHaveAttribute("href", "mailto:contact@privateimagetotext.com");
      }
      view.unmount();
    }
  });

  it("uses full descriptive titles on guide cards", () => {
    render(
      <MemoryRouter>
        <GuidesPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", {
      level: 1,
      name: "Private OCR, Steganography and Media Metadata Guides",
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      level: 3,
      name: "How to extract text from a screenshot without uploading it",
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      level: 3,
      name: "Private OCR for sensitive documents: what browser-only means",
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      level: 2,
      name: "Extract text and OCR",
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      level: 2,
      name: "Hide and reveal messages",
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      level: 2,
      name: "Media metadata and origin clues",
    })).toBeInTheDocument();
  });

  it("renders configured guides, guide actions, and no monetisation while it is off", () => {
    render(
      <MemoryRouter initialEntries={["/guides/screenshot-to-text"]}>
        <Routes>
          <Route path="/guides" element={<GuidesPage />} />
          <Route path="/guides/:guideSlug" element={<GuidePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "How to extract text from a screenshot without uploading it",
      }),
    ).toBeInTheDocument();
    const guideActions = screen.getByRole("navigation", {
      name: "Guide actions",
    });
    expect(
      within(guideActions).getByRole("link", { name: "View all guides" }),
    ).toHaveAttribute("href", "/guides");
    expect(
      within(guideActions).getByRole("link", { name: /open extract text/i }),
    ).toHaveAttribute("href", "/");
    expect(screen.getByRole("heading", {
      level: 2,
      name: "Choose the image and recognition settings",
    })).toHaveAttribute("id", "screenshot-extract-review");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }))
      .toHaveTextContent("GuidesScreenshot to text");
    expect(document.querySelector('article'))
      .toBeInTheDocument();
    expect(screen.getByText(/Published 8 August 2026/)).toBeInTheDocument();
    const onThisPage = screen.getAllByRole("navigation", { name: "On this page" });
    expect(onThisPage).toHaveLength(2);
    for (const navigation of onThisPage) {
      expect(within(navigation).getByRole("link", { name: "Choose the image and recognition settings" }))
        .toHaveAttribute("href", "#screenshot-extract-review");
    }
    expect(screen.getByRole("link", { name: /Improve OCR accuracy/ }))
      .toHaveAttribute("href", "/guides/improve-ocr-accuracy");
    expect(screen.queryByRole("complementary", { name: "Sponsor" }))
      .not.toBeInTheDocument();
  });

  it("renders provenance limits, a real figure and a tool-specific guide action", () => {
    render(
      <MemoryRouter initialEntries={["/guides/check-image-ai-metadata-content-credentials"]}>
        <Routes>
          <Route path="/guides/:guideSlug" element={<GuidePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", {
      level: 1,
      name: "How to check an image for AI metadata and Content Credentials",
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      level: 2,
      name: "A missing credential proves nothing",
    })).toBeInTheDocument();
    expect(document.querySelector("figure img[alt][width][height]"))
      .toBeInTheDocument();
    expect(screen.queryByText("Publication date set on first deployment"))
      .not.toBeInTheDocument();
    expect(document.querySelector(".content-page__publication"))
      .toHaveTextContent(/Private Image to Text.*Updated 6 November 2026/);
    expect(document.querySelector('[data-article-date="datePublished"]'))
      .not.toBeInTheDocument();
    expect(document.querySelector('[data-article-date="dateModified"]')).toHaveAttribute("datetime", "2026-11-06");
    expect(
      screen
        .getAllByRole("link", { name: /Open Media Inspector/i })
        .every((link) => link.getAttribute("href") === "/media-inspector"),
    ).toBe(true);
  });

  it("renders the local not-found UI for an unknown guide slug", () => {
    render(
      <MemoryRouter initialEntries={["/guides/unknown"]}>
        <Routes>
          <Route path="/guides/:guideSlug" element={<GuidePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "There is no page at this address",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Useful pages" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing was uploaded or searched for/i))
      .toBeInTheDocument();
  });

  it("does not reserve a sponsor surface when monetisation is disabled", () => {
    const { container } = render(
      <MemoryRouter>
        <MonetisationSlot placement="guide" />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(vi.isMockFunction(MonetisationSlot)).toBe(false);
  });
});
