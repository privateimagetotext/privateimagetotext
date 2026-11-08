import { Link } from "react-router";
import { otherTools } from "../config/tool-directory";

export type ToolDirectoryProps = {
  readonly id: string;
  /** The tool being shown, which is left out of the list. */
  readonly currentPath?: string;
  readonly eyebrow?: string;
  readonly title?: string;
  readonly introduction?: string;
  /** Renders as a content-page section (no eyebrow or full-width frame). */
  readonly compact?: boolean;
  /**
   * Opens each tool in a new tab so leaving does not discard unsaved work in
   * the current tool workspace (nothing is persisted between pages).
   */
  readonly newTab?: boolean;
};

/**
 * Plain internal links to the other browser-only tools. It never receives
 * workspace state and must stay outside every tool workspace.
 */
export function ToolDirectory({
  id,
  currentPath,
  eyebrow = "More private tools",
  title = "Other tools that keep your files in this browser",
  introduction,
  compact = false,
  newTab = false,
}: ToolDirectoryProps) {
  const tools = otherTools(currentPath);
  if (!tools.length) return null;
  return (
    <section
      className={compact ? "content-section tool-directory tool-directory--compact" : "guide-section tool-directory"}
      aria-labelledby={id}
    >
      {compact ? (
        <>
          <h2 id={id}>{title}</h2>
          {introduction ? <p>{introduction}</p> : null}
        </>
      ) : (
        <div className="section-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={id}>{title}</h2>
          {introduction ? <p>{introduction}</p> : null}
        </div>
      )}
      <ul className="tool-directory__list">
        {tools.map((tool) => (
          <li key={tool.path} className="tool-directory__item">
            <h3>{tool.name}</h3>
            <p>{tool.summary}</p>
            <Link
              to={tool.path}
              {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              <span>
                {tool.actionLabel} <span aria-hidden="true">→</span>
              </span>
              {newTab ? <span className="tool-directory__hint"> (opens in a new tab)</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A one-line list of the other tools, for a tool page's introduction. */
export function ToolStrip({ currentPath }: { readonly currentPath: string }) {
  const tools = otherTools(currentPath);
  if (!tools.length) return null;
  return (
    <nav className="tool-strip" aria-label="Other tools">
      <span className="tool-strip__label">Also private:</span>
      <ul>
        {tools.map((tool) => (
          <li key={tool.path}>
            {/* A new tab keeps work already started in this tool. */}
            <Link to={tool.path} target="_blank" rel="noopener noreferrer">
              {tool.name}
              <span className="sr-only"> (opens in a new tab)</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
