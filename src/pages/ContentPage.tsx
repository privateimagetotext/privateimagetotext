import type { ReactNode } from "react";
import { Link } from "react-router";
import { routes } from "../config/product";

export type ContentPageProps = {
  readonly eyebrow: string;
  readonly title: string;
  readonly introduction: string;
  readonly children: ReactNode;
  readonly actionLabel?: string;
  readonly actionTo?: string;
  readonly className?: string;
  readonly tableOfContents?: readonly TableOfContentsItem[];
  readonly beforeHeader?: ReactNode;
  readonly articleMetadata?: ArticleMetadata;
};

export type ArticleMetadata = {
  readonly datePublished: string | undefined;
  readonly dateModified: string | undefined;
  readonly authorName: string;
};

export type TableOfContentsItem = {
  readonly id: string;
  readonly label: string;
};

function TableOfContents({
  items,
  mobile = false,
}: {
  readonly items: readonly TableOfContentsItem[];
  readonly mobile?: boolean;
}) {
  const links = (
    <ol>
      {items.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`}>{item.label}</a>
        </li>
      ))}
    </ol>
  );

  if (mobile) {
    return (
      <details className="content-page__toc-mobile">
        <summary>On this page</summary>
        <nav aria-label="On this page">{links}</nav>
      </details>
    );
  }

  return (
    <aside className="content-page__toc-desktop">
      <nav aria-label="On this page">
        <p>On this page</p>
        {links}
      </nav>
    </aside>
  );
}

export function ContentPage({
  eyebrow,
  title,
  introduction,
  children,
  actionLabel = "Open the OCR tool",
  actionTo = routes.tool,
  className = "",
  tableOfContents,
  beforeHeader,
  articleMetadata,
}: ContentPageProps) {
  const hasTableOfContents = Boolean(tableOfContents?.length);
  const formatContentDate = (date: string) => {
    const [year, month, day] = date.split("-");
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return `${Number(day)} ${monthNames[Number(month) - 1]} ${year}`;
  };
  const content = (
    <>
      {beforeHeader}
      <header className="content-page__header">
        <p className="content-page__eyebrow">{eyebrow}</p>
        <h1
          className="content-page__title"
        >
          {title}
        </h1>
        <p
          className="content-page__introduction"
        >
          {introduction}
        </p>
        {articleMetadata ? (
          <p className="content-page__publication">
            <span>{articleMetadata.authorName}</span>
            {articleMetadata.datePublished ? (
              <>
                <span aria-hidden="true"> · </span>
                <time
                  data-article-date="datePublished"
                  dateTime={articleMetadata.datePublished}
                >
                  Published {formatContentDate(articleMetadata.datePublished)}
                </time>
              </>
            ) : <><span aria-hidden="true"> · </span><span>Publication date not recorded</span></>}
            {articleMetadata.dateModified ? (
              <>
                <span aria-hidden="true"> · </span>
                <time
                  data-article-date="dateModified"
                  dateTime={articleMetadata.dateModified}
                >
                  Updated {formatContentDate(articleMetadata.dateModified)}
                </time>
              </>
            ) : null}
          </p>
        ) : null}
        <Link className="text-action" to={actionTo}>
          {actionLabel}
          <span aria-hidden="true">→</span>
        </Link>
      </header>
      {tableOfContents ? (
        <TableOfContents items={tableOfContents} mobile />
      ) : null}
      <div className="content-page__layout">
        <div className="content-page__body">{children}</div>
        {tableOfContents ? (
          <TableOfContents items={tableOfContents} />
        ) : null}
      </div>
    </>
  );

  return (
    <main
      id="main-content"
      className={`content-page${hasTableOfContents ? " content-page--with-toc" : ""}${className ? ` ${className}` : ""}`}
      tabIndex={-1}
    >
      {articleMetadata ? (
        <article>
          {content}
        </article>
      ) : (
        content
      )}
    </main>
  );
}
