import { Link } from "react-router";
import { productConfig, routes } from "../config/product";
import { ContentPage } from "./ContentPage";

const privacyTableOfContents = [
  { id: "privacy-short-title", label: "The short version" },
  { id: "privacy-separate-title", label: "The tools are separate" },
  { id: "privacy-offline-title", label: "What may be saved for offline use" },
  { id: "privacy-clear-title", label: "What Clear removes" },
  { id: "privacy-export-title", label: "Copy and Download leave the page" },
  { id: "privacy-control-title", label: "What this site cannot control" },
  { id: "privacy-services-title", label: "Hosting and traffic analytics" },
  { id: "privacy-contact-title", label: "Contact" },
] as const;

export function PrivacyPage() {
  return (
    <ContentPage
      eyebrow="Privacy"
      title="Your files and content stay in your browser."
      introduction="Private Image to Text processes the files and content you choose in the current browser tab. The tools do not upload that content, create an account, save cloud history or use an application error-reporting service. Cloudflare Web Analytics measures aggregate traffic and performance."
      actionLabel="Open Extract text"
      actionTo={routes.tool}
      className="privacy-page"
      tableOfContents={privacyTableOfContents}
    >
      <section className="content-section content-section--lead" aria-labelledby="privacy-short-title">
        <h2 id="privacy-short-title">The short version</h2>
        <ul>
          <li>The selected images, queued results and edits are held in this browser tab.</li>
          {__PDF_OCR_PUBLIC__ ? <li>The PDF tool processes documents, passwords and page text locally in a separate workspace.</li> : null}
          <li>Hidden messages and passwords are processed in the separate Hide message tool.</li>
          <li>Media files, metadata, file fingerprints and embedded credentials are inspected in the separate Media Inspector, which can also create a verified metadata-removed copy for eligible still JPEG and PNG files.</li>
          <li>This site does not intentionally save user content in browser storage or site caches.</li>
          <li>Cloudflare hosts the production site and runs aggregate Web Analytics on every page, including the tools. It measures visits and page performance, not your files, text or results.</li>
          <li>Site files, selected OCR language models and optional JPEG support may be cached for offline use.</li>
          <li>Copy and Download move content outside this page.</li>
          <li>Browser extensions, device software and anyone using your unlocked device remain outside this site&apos;s control.</li>
        </ul>
      </section>

      <section className="content-section" aria-labelledby="privacy-separate-title">
        <div className="content-section__heading">
          <p className="section-index">01</p>
          <h2 id="privacy-separate-title">The tools are separate</h2>
        </div>
        <p>
          The tools are separate pages with
          separate processing. This site does not pass your selected file, recognised
          text, hidden message, password, metadata or result from one tool to another.
        </p>
      </section>

      <section className="content-section" aria-labelledby="privacy-offline-title">
        <div className="content-section__heading">
          <p className="section-index">02</p>
          <h2 id="privacy-offline-title">What may be saved for offline use</h2>
        </div>
        <p>
          Your browser may save the site&apos;s code, fonts, selected OCR language models, optional
          JPEG support and same-origin Content Credentials support files after they
          are used. These site files do not contain your selected media, recognised
          text, hidden messages, passwords or inspection reports.
        </p>
        {__PDF_OCR_PUBLIC__ ? <p>PDF reader support has its own verified offline cache. PDF readiness and selected OCR language readiness are separate; your document, previews and password are excluded from both caches.</p> : null}
        <p>
          The public sample images may also be cached with the site. They are demonstration files, separate from images you select.
        </p>
        <p>
          Basic site readiness, OCR-model readiness, JPEG readiness and first-use
          Content Credentials availability are separate. Preparing one does not
          automatically prepare the others.
        </p>
      </section>

      <section className="content-section" aria-labelledby="privacy-clear-title">
        <div className="content-section__heading">
          <p className="section-index">03</p>
          <h2 id="privacy-clear-title">What Clear removes</h2>
        </div>
        <p>
          Clear removes the selected file, visible text, metadata, inspection and any
          generated metadata-removed copy from the current page. It also stops or invalidates the
          relevant local processing and revokes temporary source and output preview URLs.
        </p>
        <p>
          Clear does not delete downloaded files or clipboard history. It is not a
          secure operating-system memory wipe, so temporary copies may remain in
          browser or device memory until naturally overwritten.
        </p>
      </section>

      <section className="content-section" aria-labelledby="privacy-export-title">
        <div className="content-section__heading">
          <p className="section-index">04</p>
          <h2 id="privacy-export-title">Copy and Download leave the page</h2>
        </div>
        <p>
          Copy transfers text to your device&apos;s clipboard. Clipboard history or
          synchronisation may retain it.
        </p>
        <p>
          Download creates a file controlled by your browser and operating system.
          Media Inspector never downloads a metadata-removed copy automatically and never
          overwrites the source. Clear cannot delete a file after it has been downloaded.
        </p>
      </section>

      <section className="content-section" aria-labelledby="privacy-control-title">
        <div className="content-section__heading">
          <p className="section-index">05</p>
          <h2 id="privacy-control-title">What this site cannot control</h2>
        </div>
        <p>
          Browser extensions, accessibility tools, device-management or security
          software, malware, operating-system memory, backups and another person
          using your unlocked device may be able to access content you open.
        </p>
        <p>Use a trusted device and browser profile for sensitive material.</p>
      </section>

      <section className="content-section" aria-labelledby="privacy-services-title">
        <div className="content-section__heading">
          <p className="section-index">06</p>
          <h2 id="privacy-services-title">Hosting and traffic analytics</h2>
        </div>
        <h3>Website hosting</h3>
        <p>
          Cloudflare hosts and delivers this website. It therefore processes the
          ordinary web-request information needed to serve pages and application
          files. Files selected inside Extract text, Hide message and Media Inspector
          are not included in those hosting requests.
        </p>
        <h3>Traffic and performance analytics</h3>
        <p>
          We use Cloudflare Web Analytics to understand aggregate page usage and
          performance. Its script runs on every page, including the tools, and
          records each page you open, including moves between tools within the
          site. It may process the page address, the referring page address,
          country, device type, browser, operating system, navigation type, rounded
          memory figures and page-performance measurements such as Core Web Vitals.
        </p>
        <p>
          Those performance measurements can identify page elements by their code
          name and position on screen, for example which heading loaded last, and
          how quickly the page responded to a click or tap. They do not include what
          you type or select, or the text the tools show you.
        </p>
        <p>
          Cloudflare Web Analytics does not use cookies or browser storage to
          recognise visitors, and this site does not use it to follow people across
          websites. You can block it with a content blocker or a browser privacy
          setting; the tools keep working.
        </p>
        <p>
          The analytics service does not receive files selected in the tools,
          filenames, recognised or edited text, hidden or revealed messages,
          passwords, media metadata, checksums, inspection reports, Content
          Credentials, generated images or downloaded files.
        </p>
        <p>
          The analytics script is Cloudflare&apos;s code running in the page. Like
          any script on a page, it could technically read what the page shows, so
          this rests on Cloudflare&apos;s published description of what it collects
          and on testing. In a test on 6 November 2026, its requests contained none
          of the test filename, recognised or edited text, hidden message or
          password, and it stored nothing in the browser. Cloudflare already serves
          every file of this site, so the script does not add another company to
          trust. <Link to={routes.verify}>Check the requests yourself</Link>.
        </p>
        <p>
          This site does not use advertising pixels, session replay, account
          analytics, application error reporting or custom analytics events.
        </p>
      </section>

      <section className="content-section" aria-labelledby="privacy-contact-title">
        <div className="content-section__heading">
          <p className="section-index">07</p>
          <h2 id="privacy-contact-title">Contact</h2>
        </div>
        <p>
          For general enquiries, support, accessibility feedback, privacy or data
          requests, security reports, and legal, copyright or abuse notices, email{" "}
          <a href={`mailto:${productConfig.contactEmail}`}>
            {productConfig.contactEmail}
          </a>
          . This is the site&apos;s single public contact address.
        </p>
      </section>

      <nav className="related-links" aria-label="Privacy next steps">
        <h2>Learn more or open a tool</h2>
        <div>
          <Link to={routes.privacyTechnical}>Read the technical privacy architecture</Link>
          <Link to={routes.verify}>Verify the privacy boundary yourself</Link>
          <Link to={routes.tool}>Open Extract text</Link>
          <Link to={routes.hideMessage}>Open Hide message</Link>
          <Link to={routes.mediaInspector}>Open Media Inspector</Link>
        </div>
      </nav>
    </ContentPage>
  );
}
