import { Link } from "react-router";
import { findGuideBySlug } from "../config/guides";

export type HelpfulGuidesProps = {
  readonly id: string;
  readonly guideSlugs: readonly string[];
  readonly eyebrow?: string;
  readonly title?: string;
  readonly linkLabels?: Readonly<Record<string, string>>;
};

export function HelpfulGuides({
  id,
  guideSlugs,
  eyebrow = "Helpful guides",
  title = "Learn the workflow and its limits",
  linkLabels,
}: HelpfulGuidesProps) {
  const selectedGuides = guideSlugs
    .map((slug) => findGuideBySlug(slug))
    .filter((guide) => guide !== undefined);

  return (
    <section className="guide-section helpful-guides" aria-labelledby={id}>
      <div className="section-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
      <div className="guide-grid">
        {selectedGuides.map((guide) => (
          <article key={guide.slug} className="guide-card">
            <p className="eyebrow">{guide.shortTitle}</p>
            <h3>{guide.title}</h3>
            <p>{guide.summary}</p>
            <Link to={guide.path}>
              {linkLabels?.[guide.slug] ?? `Read ${guide.shortTitle}`}{" "}
              <span aria-hidden="true">→</span>
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
