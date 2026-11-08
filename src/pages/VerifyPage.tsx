import { Link } from "react-router";
import { routes } from "../config/product";
import { ContentPage } from "./ContentPage";

const verifyTableOfContents = [
  { id: "network-check-title", label: "Quick network check" },
  { id: "storage-check-title", label: "Check browser storage" },
  { id: "offline-check-title", label: "Repeat the check offline" },
  ...(__PDF_OCR_PUBLIC__ ? [{ id: "pdf-verification-title", label: "Check PDF text extraction" }] : []),
  { id: "proof-scope-title", label: "What these checks prove" },
  { id: "proof-limits-title", label: "What these checks do not prove" },
] as const;

export function VerifyPage() {
  return (
    <ContentPage
      eyebrow="Verify the privacy boundary"
      title="Check that your file is not uploaded"
      introduction="You do not have to take the privacy claim on trust. These checks show what this site sends over the network and stores in your browser during a test session."
      actionLabel="Open Extract text for a test"
      actionTo={routes.tool}
      className="verify-page"
      tableOfContents={verifyTableOfContents}
    >
      <section className="content-section content-section--lead" aria-labelledby="network-check-title">
        <h2 id="network-check-title">Quick network check</h2>
        <ol>
          <li>Open the production site or a local tool in a new tab.</li>
          <li>Open your browser&apos;s developer tools.</li>
          <li>Open the Network panel, preserve the log, clear it and reload the page.</li>
          <li>Choose a test file with a distinctive filename and content.</li>
          <li>Run Extract text, complete a Hide or Reveal workflow, or inspect media.</li>
          <li>Inspect every request made while the tool runs.</li>
        </ol>
        <div className="verification-columns">
          <div>
            <h3>Files you may see</h3>
            <ul>
              <li>JavaScript and CSS files</li>
              <li>Locally hosted fonts</li>
              <li>The OCR background process and selected language models</li>
              <li>WebAssembly support files</li>
              <li>The optional JPEG codec</li>
              <li>Same-site Media Inspector and Content Credentials support files</li>
              <li>Same-site page requests</li>
              <li>The production-only Cloudflare Web Analytics beacon</li>
              <li>A production-only same-origin Web Analytics POST</li>
            </ul>
          </div>
          <div>
            <h3>User content you must not see</h3>
            <ul>
              <li>The selected image or its filename in a request</li>
              <li>Recognised or edited text</li>
              <li>Hidden or revealed messages</li>
              <li>Passwords or generated file content</li>
              <li>User-content-derived URLs or request bodies</li>
              <li>Media bytes, metadata, filenames or checksums in a request</li>
            </ul>
          </div>
        </div>
        <h3>Conditional production analytics requests</h3>
        <p>
          On the proxied production hostname, Cloudflare may inject{" "}
          <code>https://static.cloudflareinsights.com/beacon.min.js</code>, or a versioned
          copy at a path beginning{" "}
          <code>https://static.cloudflareinsights.com/beacon.min.js/</code>. That beacon
          may send page-use and performance measurements by <code>POST</code> to the
          same-origin <code>/cdn-cgi/rum</code> endpoint, several times per visit,
          including when you move between tools or leave the page. Every other unexpected
          third-party request remains outside the documented boundary.
        </p>
        <p>
          These analytics requests may be absent when Cloudflare Web Analytics is
          disabled, configured to exclude the visitor&apos;s region, blocked by an ad
          blocker or browser privacy protection, running through local development or
          local preview, or offline.
        </p>
        <h3>Check the analytics payload for leaks</h3>
        <ol>
          <li>Open Developer Tools on the production site.</li>
          <li>Open Network and preserve the log.</li>
          <li>Reload the production page.</li>
          <li>Locate <code>beacon.min.js</code> and <code>/cdn-cgi/rum</code>, if present.</li>
          <li>Use a test file with distinctive sentinel values in its filename and visible content.</li>
          <li>Complete an Extract text, Hide or Reveal, or Media Inspector workflow.</li>
          <li>Move to another tool, then switch to another browser tab and back. The beacon sends some measurements only when the page is hidden, shown as a <code>ping</code> or XHR request.</li>
          <li>Inspect request URLs, headers and the <code>/cdn-cgi/rum</code> request payload.</li>
          <li>Confirm none of the sentinel values, selected bytes, OCR text, messages, passwords, metadata, checksums or generated content appears.</li>
        </ol>
      </section>

      <section className="content-section" aria-labelledby="storage-check-title">
        <div className="content-section__heading">
          <p className="section-index">02</p>
          <h2 id="storage-check-title">Check browser storage</h2>
        </div>
        <p>
          In the developer tools, inspect localStorage, sessionStorage, IndexedDB,
          cookies and Cache Storage after completing a test workflow.
        </p>
        <div className="privacy-callout">
          <p>
            Cached site files, OCR assets and optional same-origin support assets are
            expected. Your selected media, recognised text, metadata, inspection
            reports, messages and passwords should not be present.
          </p>
          <p>
            Cloudflare Web Analytics should not create analytics cookies or analytics
            entries in localStorage, sessionStorage or IndexedDB.
          </p>
        </div>
      </section>

      <section className="content-section" aria-labelledby="offline-check-title">
        <div className="content-section__heading">
          <p className="section-index">03</p>
          <h2 id="offline-check-title">Repeat the check offline</h2>
        </div>
        <p>
          After the site reports Site available offline and the files for your chosen
          tool have been prepared, disconnect and repeat the workflow.
        </p>
        <ul>
          <li>OCR readiness is separate from basic site readiness.</li>
          <li>JPEG readiness is separate again.</li>
          <li>PNG message hiding does not require the JPEG codec.</li>
          <li>The analytics request may fail or be absent while offline.</li>
          <li>No analytics payload should be queued in application storage.</li>
          <li>A failed analytics request must not affect prepared offline tool functionality.</li>
        </ul>
      </section>

      {__PDF_OCR_PUBLIC__ && routes.pdfToText ? (
        <section className="content-section" aria-labelledby="pdf-verification-title">
          <h2 id="pdf-verification-title">Check PDF text extraction</h2>
          <p>
            Use a non-sensitive test document with a distinctive filename, visible
            text and, for the password check, a test password. Keep the Network
            panel open while you <Link to={routes.pdfToText}>open PDF to text</Link>.
          </p>
          <ol>
            <li>
              Start in a fresh browser context before preparing offline support.
              Visiting the tool should not load the PDF reader or OCR runtime.
              Select a digitally generated PDF and choose Existing PDF text only.
              The PDF reader and its worker should load from this site; OCR files
              should load only when OCR is needed or you explicitly prepare them.
            </li>
            <li>
              Process a scanned page with OCR. Inspect request URLs, headers and
              bodies, including any Cloudflare analytics request. PDF bytes,
              filenames, passwords, extracted text and edits must not appear.
              Reader files under <code>/pdf/</code> and OCR files under <code>/ocr/</code>
              {" "}are same-site support assets, not uploads of your document.
            </li>
            <li>
              Inspect localStorage, sessionStorage, IndexedDB, cookies and Cache
              Storage. Only site and support files belong in the offline caches;
              your PDF, its filename, password, page images and results should be
              absent. Check the address bar and page title for the same values.
            </li>
            <li>
              Check PDF reader and selected OCR language readiness separately. After preparing
              support, disconnect, reload and select the test PDF again. Existing
              PDF text needs the reader; scanned-page OCR needs both. Missing
              support should produce an offline message, not a remote fallback.
            </li>
            <li>
              For a password-protected test PDF, try a wrong password, the correct
              password and Cancel. The password is used locally to open the
              document; its input should clear after submission or cancellation.
            </li>
            <li>
              Edit a result, confirm Clear PDF, and check that the document and
              edits disappear. Confirmed replacement, navigating this tab away,
              reloading or closing the tab also discards its work. Returning
              requires selecting the PDF again.
            </li>
          </ol>
          <p>
            Copy and Download are explicit exports. Clear cannot remove clipboard
            history or downloaded files, and does not guarantee secure memory
            erasure. These checks observe the version and session you tested;
            they do not establish the accuracy of extracted text or every security
            property.
          </p>
        </section>
      ) : null}

      <section className="content-section" aria-labelledby="proof-scope-title">
        <div className="content-section__heading">
          <p className="section-index">04</p>
          <h2 id="proof-scope-title">What these checks prove</h2>
        </div>
        <p>
          These steps let you observe the network and browser-storage behaviour of
          the version running in your browser during that session.
        </p>
      </section>

      <section className="content-section" aria-labelledby="proof-limits-title">
        <div className="content-section__heading">
          <p className="section-index">05</p>
          <h2 id="proof-limits-title">What these checks do not prove</h2>
        </div>
        <ul>
          <li>Your device is free from malware.</li>
          <li>Browser extensions cannot see page content.</li>
          <li>Operating-system memory is securely erased.</li>
          <li>Downloaded files are deleted.</li>
          <li>Copied text is removed from clipboard history.</li>
          <li>A public source repository exactly matches the deployed build.</li>
        </ul>
        <p>A visual check is useful evidence, but it does not prove every security property.</p>
      </section>

      <nav className="related-links" aria-label="Verification next steps">
        <h2>Read the documented boundaries</h2>
        <div>
          <Link to={routes.privacy}>Read the plain-language Privacy page</Link>
          <Link to={routes.privacyTechnical}>Read the technical privacy architecture</Link>
          <Link to={routes.hideMessage}>Test Hide message</Link>
          <Link to={routes.mediaInspector}>Test Media Inspector</Link>
        </div>
      </nav>
    </ContentPage>
  );
}
