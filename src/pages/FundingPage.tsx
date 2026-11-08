import { Link } from "react-router";
import { SupportLink } from "../components/SupportLink";
import { productConfig, routes } from "../config/product";
import {
  resolveAffiliateRegistry,
  resolveSupportLink,
} from "../lib/funding-links";
import { ContentPage } from "./ContentPage";

const sections = [
  { id: "funding-costs", label: "What it costs" },
  { id: "funding-not", label: "What does not pay for it" },
  { id: "funding-support", label: "Optional support" },
  { id: "funding-affiliates", label: "Affiliate links in guides" },
  { id: "funding-partners", label: "What a partner can learn" },
  { id: "funding-status", label: "Current status" },
];

export function FundingPage() {
  const support = resolveSupportLink(productConfig.monetisation.support);
  const affiliates = [
    ...resolveAffiliateRegistry(productConfig.monetisation.affiliates).values(),
  ];

  return (
    <ContentPage
      eyebrow="Funding"
      title="How this site is funded"
      introduction="The tools are free, with no ads, accounts or paid tiers. This page sets out what the site costs, how it could cover those costs, and what each option can and cannot learn about you."
      actionLabel="Read the privacy explanation"
      actionTo={routes.privacy}
      tableOfContents={sections}
    >
      <section className="content-section" aria-labelledby="funding-costs">
        <h2 id="funding-costs">What it costs</h2>
        <p>
          Running costs are small. The site is static files, and the tools
          run in your browser, so there is no processing server to pay for.
        </p>
        <p>
          The larger cost is time: building, testing and documenting the
          tools, and writing the guides. I do that unpaid. The aim is for the
          site to cover its costs and a little of that time, not to grow into
          a business that needs your data.
        </p>
      </section>

      <section className="content-section" aria-labelledby="funding-not">
        <h2 id="funding-not">What does not pay for it</h2>
        <ul>
          <li>No advertising, ad networks or sponsored placements in the tools.</li>
          <li>No sale, rental or sharing of visitor data, and no data broker relationships.</li>
          <li>No accounts, subscriptions, paid features or upgrade prompts.</li>
          <li>No third-party scripts, widgets, tracking pixels or embedded payment forms for funding.</li>
        </ul>
        <p>
          The production site uses aggregate Cloudflare Web Analytics to count
          page views. That is not a funding source and is not shared with any
          partner. The <Link to={routes.privacy}>privacy explanation</Link>{" "}
          describes it.
        </p>
      </section>

      <section className="content-section" aria-labelledby="funding-support">
        <h2 id="funding-support">Optional support</h2>
        <p>
          If the tools help you, you can choose to support the project through
          one plain link to a support page on Ko-fi, GitHub Sponsors or Buy Me
          a Coffee. It appears only in the footer of content and guide pages,
          on the About page and on this page. It never appears on the Extract
          text, PDF to text, Hide message or Media Inspector pages.
        </p>
        <p>
          It is an ordinary link. Nothing from the support platform loads on
          this site, and nothing happens until you choose to follow it. Once
          you do, you are on the platform&apos;s site, under its own privacy
          policy and fees. What I see about a supporter depends on that
          platform and on what you choose to enter there, such as a name or a
          message.
        </p>
        <p>Support is entirely optional. Every tool stays free either way.</p>
      </section>

      <section className="content-section" aria-labelledby="funding-affiliates">
        <h2 id="funding-affiliates">Affiliate links in guides</h2>
        <p>
          Some guides may recommend a privacy product, such as a password
          manager or encrypted storage, through an affiliate link. If you sign
          up or buy through that link, the partner may pay this site a
          commission. These rules apply:
        </p>
        <ul>
          <li>Affiliate links appear only inside guide articles, never in a tool or its results.</li>
          <li>Each one is labelled as a paid link right beside the link, not only on this page.</li>
          <li>Each link is marked <code>rel=&quot;sponsored&quot;</code> so search engines can treat it as a paid link.</li>
          <li>A product is included only when it genuinely suits the guide&apos;s reader. A commission does not change what a guide says about the tools here or how a task should be done.</li>
          <li>Links go straight to the partner or its affiliate programme&apos;s own tracking address. This site uses no link shorteners or redirect pages of its own.</li>
        </ul>
      </section>

      <section className="content-section" aria-labelledby="funding-partners">
        <h2 id="funding-partners">What a partner can learn</h2>
        <p>
          An affiliate link contains an identifier for this site, so the
          partner can tell that you arrived through it. This site also asks
          your browser not to tell the partner which page on this site you
          clicked from.
        </p>
        <p>
          The partner learns nothing from the tools. Your files, filenames,
          recognised text, metadata, messages and passwords stay in your
          browser and are never part of a link. Links are fixed in the
          site&apos;s published configuration and are the same for every
          visitor.
        </p>
        <p>
          After you arrive, the partner&apos;s own site, cookies and privacy
          policy apply. Affiliate programmes usually give me aggregate reports,
          such as numbers of clicks, sign-ups and commissions. Some report
          individual orders. None of that comes from the tools here.
        </p>
      </section>

      <section className="content-section" aria-labelledby="funding-status">
        <h2 id="funding-status">Current status</h2>
        {support ? (
          <p>A support link through {support.platformName} is available.</p>
        ) : (
          <p>There is no support link yet.</p>
        )}
        {affiliates.length ? (
          <p>
            Guides may contain affiliate links for:{" "}
            {affiliates.map((link) => link.product).join(", ")}.
          </p>
        ) : (
          <p>There are currently no affiliate links on this site.</p>
        )}
        <SupportLink placement="funding" />
        <p>
          Questions about funding are welcome at{" "}
          <a href={`mailto:${productConfig.contactEmail}`}>{productConfig.contactEmail}</a>.
        </p>
      </section>

      <nav className="related-links" aria-label="Funding next steps">
        <h2>Check the privacy boundary</h2>
        <div>
          <Link to={routes.privacy}>Read the plain-language Privacy page</Link>
          <Link to={routes.privacyTechnical}>Read the technical privacy architecture</Link>
          <Link to={routes.verify}>Verify that your files are not uploaded</Link>
          <Link to={routes.about}>About this project</Link>
        </div>
      </nav>
    </ContentPage>
  );
}
