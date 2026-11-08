import { productConfig, type SupportConfig } from "../config/product";
import { resolveSupportLink } from "../lib/funding-links";

export type SupportLinkProps = {
  /** Where the link appears. Tool workspaces are deliberately not an option. */
  readonly placement: "footer" | "about" | "funding";
  /** Test seam only; production always reads the reviewed product config. */
  readonly config?: SupportConfig;
};

const leadCopy: Record<SupportLinkProps["placement"], string> = {
  footer: "Free to use. Optional support:",
  about: "If the tools are useful to you, you can support the project:",
  funding: "Optional support goes towards the domain and ongoing work:",
};

/**
 * One plain outbound support link. It is an ordinary anchor: no script,
 * widget, image, iframe or request runs on this site, and it carries no
 * tool state. Renders nothing unless the configured URL validates.
 */
export function SupportLink({ placement, config }: SupportLinkProps) {
  const link = resolveSupportLink(config ?? productConfig.monetisation.support);
  if (!link) return null;

  return (
    <p className={`support-link support-link--${placement}`} data-funding-link="support">
      <span>{leadCopy[placement]}</span>{" "}
      <a href={link.href} rel="noopener noreferrer" target="_blank">
        Support on {link.platformName}
        <span className="sr-only"> (opens {link.platformName} in a new tab)</span>
      </a>
    </p>
  );
}
