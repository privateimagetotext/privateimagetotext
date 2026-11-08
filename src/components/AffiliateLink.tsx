import { useId } from "react";
import { Link } from "react-router";
import { productConfig, routes, type AffiliateEntry } from "../config/product";
import {
  resolveAffiliateIds,
  type ResolvedAffiliateLink,
} from "../lib/funding-links";

export type AffiliateLinkProps = {
  readonly link: ResolvedAffiliateLink;
};

/**
 * An inline affiliate link with its disclosure directly beside it. The
 * disclosure is visible text, not a tooltip or footnote, and the link is a
 * plain anchor with rel="sponsored noopener noreferrer".
 */
export function AffiliateLink({ link }: AffiliateLinkProps) {
  const disclosureId = useId();
  return (
    <span className="affiliate-link" data-funding-link="affiliate">
      <a
        href={link.href}
        rel="sponsored noopener noreferrer"
        target="_blank"
        aria-describedby={disclosureId}
      >
        {link.product}
        <span className="sr-only"> (opens {link.partner} in a new tab)</span>
      </a>{" "}
      <span className="affiliate-link__disclosure" id={disclosureId}>
        (paid link: this site may earn a commission if you sign up or buy)
      </span>
    </span>
  );
}

export type PairedToolsProps = {
  /** Affiliate registry ids from the guide's `pairedTools` field. */
  readonly ids: readonly string[] | undefined;
  /** Test seam only; production always reads the reviewed product config. */
  readonly registry?: readonly AffiliateEntry[];
};

/**
 * "Privacy tools that pair well with this guide". Guide content only: it is
 * rendered by GuidePage and nowhere else. Renders nothing unless at least one
 * referenced registry entry validates.
 */
export function PairedTools({ ids, registry }: PairedToolsProps) {
  const links = resolveAffiliateIds(
    ids,
    registry ?? productConfig.monetisation.affiliates,
  );
  if (!links.length) return null;

  return (
    <aside
      className="paired-tools"
      aria-labelledby="paired-tools-title"
      data-funding-block="paired-tools"
    >
      <h2 id="paired-tools-title">Privacy tools that pair well with this guide</h2>
      <p className="paired-tools__disclosure">
        <strong>Paid links:</strong> these are affiliate links. If you sign up
        or buy through one, this site may earn a commission. The partner learns
        that you arrived through the link, not anything you did in these tools.{" "}
        <Link to={routes.funding}>How this site is funded</Link>
      </p>
      <ul>
        {links.map((link) => (
          <li key={link.id}>
            <AffiliateLink link={link} />
            <span className="paired-tools__description">{link.description}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
