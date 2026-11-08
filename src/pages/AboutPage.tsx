import { Link } from "react-router";
import { productConfig, routes } from "../config/product";
import { SITE_AUTHOR_NAME } from "../config/site-author";
import { SupportLink } from "../components/SupportLink";
import { ToolDirectory } from "../components/ToolDirectory";
import { ContentPage } from "./ContentPage";

const sections = [
  { id: "about-who", label: "Who runs it" },
  { id: "about-why", label: "Why it exists" },
  { id: "about-tools", label: "The tools" },
  { id: "about-limits", label: "What it is not" },
  { id: "about-funding", label: "Funding" },
  { id: "about-source", label: "Source" },
  { id: "about-contact", label: "Contact" },
];

export function AboutPage() {
  return <ContentPage eyebrow="About" title={`About ${productConfig.name}`}
    introduction="A personal project for processing files on your own device, with privacy claims you can check."
    tableOfContents={sections}>
    <section className="content-section" aria-labelledby="about-who">
      <h2 id="about-who">Who runs it</h2>
      <p>I'm {SITE_AUTHOR_NAME}. My background is in cyber security, with a master's degree in the field, CISM certification and other certifications across different areas of cyber security. I bring that background to this project, while keeping its claims specific and open to checking.</p>
    </section>
    <section className="content-section" aria-labelledby="about-why">
      <h2 id="about-why">Why it exists</h2>
      <p>I built this after seeing the data loss risks of people uploading files to websites I did not trust or that were not approved for corporate use. A convenient tool can still be the wrong place for a work document.</p>
      <p>I wanted a tool that processes files on the user's device, can work offline after preparation, and lets people check the no-upload claim themselves. The <Link to={routes.verify}>browser verification steps</Link> explain how to do that and what those checks cannot prove. Using this site does not replace your organisation's approval process.</p>
    </section>
    <ToolDirectory id="about-tools" title="The tools" introduction="Each tool processes your file in this browser." compact />
    <section className="content-section" aria-labelledby="about-limits">
      <h2 id="about-limits">What it is not</h2>
      <p>This is a personal project, not a company or a document storage service. There are no accounts or ads. It is not a guarantee that your device, browser extensions or clipboard are secure.</p>
      <p>The production site may use aggregate Cloudflare Web Analytics, so I do not describe it as having no tracking. Selected files and extracted content must not enter analytics requests; the <Link to={routes.privacy}>privacy explanation</Link> covers hosting, analytics and local storage.</p>
    </section>
    <section className="content-section" aria-labelledby="about-funding">
      <h2 id="about-funding">Funding</h2>
      <p>The tools are free and I pay the small running costs myself. There are no ads, paid features or data sales. <Link to={routes.funding}>How this site is funded</Link> sets out the costs, how optional support and any affiliate links work, and what they can and cannot reveal.</p>
      <SupportLink placement="about" />
    </section>
    <section className="content-section" aria-labelledby="about-source">
      <h2 id="about-source">Source</h2>
      <p>The source is not public yet. You can inspect the code delivered to your browser and follow the <Link to={routes.verify}>network and storage checks</Link>, but these do not provide an independent source-to-build comparison.</p>
    </section>
    <section className="content-section" aria-labelledby="about-contact">
      <h2 id="about-contact">Contact</h2>
      <p>For feedback or questions, email <a href={`mailto:${productConfig.contactEmail}`}>{productConfig.contactEmail}</a>. Please avoid including sensitive documents or extracted content.</p>
    </section>
  </ContentPage>;
}
