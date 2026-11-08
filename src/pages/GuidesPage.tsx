import { Link } from "react-router";
import { MonetisationSlot } from "../components/MonetisationSlot";
import {
  getGuidesByCategory,
  guideCategoryConfig,
  guideCategoryOrder,
  routes,
} from "../config/product";
import { ContentPage } from "./ContentPage";

export function GuidesPage() {
  return (
    <ContentPage
      eyebrow="Practical guides"
      title="Private OCR, Steganography and Media Metadata Guides"
      introduction="Learn how to turn images into editable text, hide and reveal messages, inspect media metadata, remove supported privacy-sensitive fields and interpret origin clues. Each guide explains what stays in your browser and what the result cannot prove."
      actionLabel="Open Extract text"
      actionTo={routes.tool}
      className="guides-page"
    >
      {guideCategoryOrder.map((categoryId) => {
        const category = guideCategoryConfig[categoryId];
        const categoryGuides = getGuidesByCategory(categoryId);

        return (
          <section
            className="guide-category"
            key={category.id}
            aria-labelledby={`guide-category-${category.id}`}
          >
            <header className="guide-category__header">
              <div>
                <p className="eyebrow">{category.label}</p>
                <h2 id={`guide-category-${category.id}`}>{category.heading}</h2>
                <p>{category.introduction}</p>
              </div>
              <Link className="text-action" to={category.actionPath}>
                {category.actionLabel} <span aria-hidden="true">→</span>
              </Link>
            </header>
            <div className="guide-grid">
              {categoryGuides.map((guide, index) => (
                <article className="guide-card" key={guide.slug}>
                  <p className="guide-card__index">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3>{guide.title}</h3>
                  <p>{guide.summary}</p>
                  <Link to={guide.path}>
                    Read guide
                    <span aria-hidden="true">→</span>
                  </Link>
                </article>
              ))}
            </div>
          </section>
        );
      })}
      <nav className="guide-page__next" aria-label="Guide tools">
        <Link to={routes.tool}>Open Extract text</Link>
        <Link to={routes.hideMessage}>Open Hide message</Link>
        <Link className="primary-action" to={routes.mediaInspector}>
          Open Media Inspector
          <span aria-hidden="true">→</span>
        </Link>
      </nav>
      <MonetisationSlot placement="guide" />
    </ContentPage>
  );
}
