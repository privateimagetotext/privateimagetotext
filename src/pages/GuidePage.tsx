import { Link, useParams } from "react-router";
import { PairedTools } from "../components/AffiliateLink";
import { MonetisationSlot } from "../components/MonetisationSlot";
import { PageBreadcrumbs } from "../components/PageBreadcrumbs";
import { findFullGuide } from "../config/guide-library";
import {
  getRelatedGuides,
  productConfig,
  routes,
} from "../config/product";
import { ContentPage } from "./ContentPage";
import { NotFoundPage } from "./NotFoundPage";

export function GuidePage() {
  const { guideSlug } = useParams<{ guideSlug: string }>();
  const guide = findFullGuide(guideSlug);

  if (!guide) {
    return <NotFoundPage />;
  }

  const relatedGuides = getRelatedGuides(guide).slice(0, 3);
  const tableOfContents = guide.sections.map((section) => ({
    id: section.id,
    label: section.heading,
  }));

  return (
    <ContentPage
      eyebrow={guide.eyebrow}
      title={guide.title}
      introduction={guide.introduction}
      actionLabel="Open the tool"
      actionTo={guide.primaryActionPath}
      className="guide-page"
      tableOfContents={tableOfContents}
      articleMetadata={{
        datePublished: guide.datePublished,
        dateModified: guide.dateModified,
        authorName: productConfig.name,
      }}
      beforeHeader={<PageBreadcrumbs />}
    >
      {guide.sections.map((section, index) => (
        <section
          className={`content-section${section.heading === "Before you rely on this" ? " guide-limitations" : ""}`}
          key={section.id}
          aria-labelledby={section.id}
        >
          <div className="content-section__heading">
            <p className="section-index">
              {String(index + 1).padStart(2, "0")}
            </p>
            <h2 id={section.id}>{section.heading}</h2>
          </div>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.figures?.length ? (
            <div className={`guide-figures${section.figureLayout === "pair" ? " guide-figures--pair" : ""}`}>
              {section.figures.map((figure) => (
                <figure key={figure.src}>
                  <img src={figure.src} alt={figure.alt} width={figure.width} height={figure.height} loading="lazy" decoding="async" />
                  <figcaption>{figure.caption}</figcaption>
                </figure>
              ))}
            </div>
          ) : null}
          {section.table ? (
            <div className="guide-table" role="region" aria-label={section.table.caption} tabIndex={0}>
              <table>
                <caption>{section.table.caption}</caption>
                <thead><tr>{section.table.headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead>
                <tbody>{section.table.rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => index === 0 ? <th scope="row" key={index}>{cell}</th> : <td key={index}>{cell}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : null}
          {section.steps ? (
            <ol>
              {section.steps.map((step, stepIndex) => (
                <li key={step} id={`${section.id}-step-${stepIndex + 1}`}>{step}</li>
              ))}
            </ol>
          ) : null}
          {section.bullets ? (
            <ul>
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
          {section.callout ? (
            <aside className="limitation-callout">
              <p>{section.callout}</p>
            </aside>
          ) : null}
          {section.links?.length ? (
            <p className="guide-section__links">
              {section.links.map((link) => (
                <Link key={link.to} to={link.to}>
                  {link.label} <span aria-hidden="true">→</span>
                </Link>
              ))}
            </p>
          ) : null}
        </section>
      ))}

      <PairedTools ids={"pairedTools" in guide ? guide.pairedTools : undefined} />

      {guide.faqs?.length ? (
        <section className="content-section guide-faqs" aria-labelledby="guide-faqs-title">
          <div className="content-section__heading">
            <p className="section-index">FAQ</p>
            <h2 id="guide-faqs-title">Frequently asked questions</h2>
          </div>
          <div className="guide-faqs__list">
            {guide.faqs.map((faq) => (
              <div key={faq.question}>
                <h3>{faq.question}</h3>
                <p>{faq.answer}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className="content-section guide-related"
        aria-labelledby="related-guides-title"
      >
        <div className="content-section__heading">
          <p className="section-index">Next</p>
          <h2 id="related-guides-title">Related guides</h2>
        </div>
        <div className="guide-related__links">
          {relatedGuides.map((relatedGuide) => (
            <Link key={relatedGuide.slug} to={relatedGuide.path}>
              <span>{relatedGuide.shortTitle}</span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      </section>

      <MonetisationSlot placement="guide" />

      <nav className="guide-page__next" aria-label="Guide actions">
        <Link to={routes.guides}>View all guides</Link>
        <Link to={routes.privacy}>Read the privacy explanation</Link>
        <Link to={routes.verify}>Verify the privacy boundary</Link>
        <Link className="primary-action" to={guide.primaryActionPath}>
          {guide.primaryActionLabel}
          <span aria-hidden="true">→</span>
        </Link>
      </nav>
    </ContentPage>
  );
}

export default GuidePage;
