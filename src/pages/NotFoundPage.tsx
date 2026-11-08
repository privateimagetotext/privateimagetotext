import { Link } from "react-router";
import { ToolDirectory } from "../components/ToolDirectory";
import { findGuideBySlug } from "../config/guides";
import { productConfig, routes } from "../config/product";
import { ContentPage } from "./ContentPage";

// One popular guide per tool, so a lost visitor can still reach every topic.
const popularGuideSlugs = [
  "screenshot-to-text",
  "pdf-to-text",
  "view-photo-metadata",
  "remove-photo-metadata-before-sharing",
  "hide-message-in-image",
] as const;

export function NotFoundPage() {
  const popularGuides = popularGuideSlugs
    .map((slug) => findGuideBySlug(slug))
    .filter((guide) => guide !== undefined);

  return (
    <ContentPage
      eyebrow="Page not found"
      title="There is no page at this address"
      introduction="The address may be mistyped, or the page may have moved. Choose a tool or guide below to carry on."
      actionLabel="Return to the OCR tool"
      className="not-found-page"
    >
      <ToolDirectory
        id="not-found-tools-title"
        title="Pick a tool"
        introduction="Each tool runs in your browser and does not upload your files."
        compact
      />

      <section className="content-section" aria-labelledby="not-found-guides-title">
        <h2 id="not-found-guides-title">Popular guides</h2>
        <ul className="not-found-page__guides">
          {popularGuides.map((guide) => (
            <li key={guide.slug}>
              <Link to={guide.path}>{guide.title}</Link>
            </li>
          ))}
        </ul>
        <Link className="text-action" to={routes.guides}>
          Browse all guides
          <span aria-hidden="true">→</span>
        </Link>
      </section>

      <section className="content-section" aria-labelledby="not-found-pages-title">
        <h2 id="not-found-pages-title">Other pages</h2>
        <nav className="not-found-page__links" aria-label="Useful pages">
          {productConfig.navigation.map((item) => (
            <Link key={item.to} to={item.to}>
              {item.label}
            </Link>
          ))}
          <Link to={routes.about}>About</Link>
        </nav>
        <p>Nothing was uploaded or searched for.</p>
      </section>
    </ContentPage>
  );
}
