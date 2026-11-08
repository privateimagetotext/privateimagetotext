import { Link } from "react-router";
import { productConfig, routes } from "../config/product";
import { ContentPage } from "./ContentPage";
import { PageBreadcrumbs } from "../components/PageBreadcrumbs";

const technicalPrivacyTableOfContents = [
  { id: "technical-ocr-flow-title", label: "OCR data flow" },
  ...(__PDF_OCR_PUBLIC__ ? [{ id: "technical-pdf-flow-title", label: "PDF data flow" }] : []),
  { id: "technical-steg-flow-title", label: "Hide and reveal data flow" },
  { id: "technical-media-flow-title", label: "Media Inspector data flow" },
  { id: "technical-separation-title", label: "Separation between tools" },
  { id: "technical-storage-title", label: "User-content storage rules" },
  { id: "technical-cache-title", label: "Application and local support assets" },
  { id: "technical-lifecycle-title", label: "Working surfaces and process lifecycle" },
  { id: "technical-password-title", label: "Password preparation and encryption" },
  { id: "technical-retry-title", label: "Encrypted reveal retry state" },
  { id: "technical-export-title", label: "Copy, download and Clear boundaries" },
  { id: "technical-metadata-title", label: "Output metadata behaviour" },
  { id: "technical-cloudflare-title", label: "Cloudflare hosting and analytics boundary" },
  { id: "technical-contact-title", label: "Contact and security reports" },
  { id: "technical-verification-title", label: "Verification procedure" },
  { id: "technical-specs-title", label: "Relevant technical specifications" },
] as const;

export function TechnicalPrivacyPage() {
  return (
    <ContentPage
      eyebrow="Technical privacy"
      beforeHeader={<PageBreadcrumbs />}
      title="Technical privacy architecture"
      introduction="This page documents the site's data flows, storage boundaries, background processes, encryption handling and cleanup behaviour. Start with the plain-language Privacy page if you only need the practical summary."
      actionLabel="Read the plain-language Privacy page"
      actionTo={routes.privacy}
      className="technical-page technical-privacy-page"
      tableOfContents={technicalPrivacyTableOfContents}
    >
      <section className="content-section content-section--lead" aria-labelledby="technical-ocr-flow-title">
        <h2 id="technical-ocr-flow-title">OCR data flow</h2>
        <p>
          OCR content is transient. The page validates and decodes a deliberately
          selected image, renders crop, 90° rotation and contrast changes to an
          in-memory bounded preview, and passes those pixels to Tesseract.js for
          ordinary recognition. Eligible long Adaptive documents reuse one decoded
          source and one bounded native-detail section canvas sequentially instead of
          allocating a full native-resolution page canvas.
        </p>
        <p>
          The same-origin OCR worker returns recognised plain text and progress.
          The page retains original OCR, conservatively tidied text and user edits
          only until replacement, Clear, navigation, reload or tab closure.
        </p>
      </section>

      {__PDF_OCR_PUBLIC__ ? (
        <section className="content-section" aria-labelledby="technical-pdf-flow-title">
          <h2 id="technical-pdf-flow-title">PDF data flow</h2>
          <p>PDF.js runs in a same-origin worker. Its streamed text intake is bounded by page text and item counts; page rendering and OCR run sequentially within pixel, time and page limits. The original document is never submitted to a server.</p>
          <p>PDF reader assets and selected OCR language assets have separate integrity-checked caches. Document bytes, passwords, source previews, page canvases and edited text remain outside those caches. Preview and extraction work share one local PDF worker and run sequentially. Clear, navigation and page lifecycle reset invalidate pending work and release worker and canvas references; this is not secure memory erasure.</p>
        </section>
      ) : null}

      <section className="content-section" aria-labelledby="technical-steg-flow-title">
        <div className="content-section__heading">
          <p className="section-index">02</p>
          <h2 id="technical-steg-flow-title">Hide and reveal data flow</h2>
        </div>
        <p>
          PNG v1 validates and decodes an image without resizing, transfers RGBA
          pixels and exact UTF-8 message bytes to a dedicated module worker, then
          encodes returned pixels as a new PNG. JPEG v2 instead sends the original
          compressed bytes to the isolated libjpeg-turbo WebAssembly worker.
        </p>
        <p>
          Reveal chooses PNG v1 or JPEG v2 from the byte signature, validates the
          fixed LTSG header, bounds the payload, and returns plain text or a bounded
          encrypted retry session. User content is never rendered as HTML or Markdown.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-media-flow-title">
        <div className="content-section__heading">
          <p className="section-index">03</p>
          <h2 id="technical-media-flow-title">Media Inspector data flow</h2>
        </div>
        <p>
          Media Inspector reads bounded slices from one deliberately selected file,
          detects its real format from byte signatures, parses supported image and
          container fields, and calculates SHA-256 incrementally. It does not decode
          every video frame or copy an entire large video into one JavaScript buffer.
        </p>
        <p>
          Supported files are also offered to the locally bundled Content Credentials
          verifier. Remote manifests and certificate-status requests are disabled, so
          verification uses only credentials embedded in the selected file and the
          verifier's local validation state. No custom trust anchors or identity list
          are bundled. Ordinary EXIF, XMP, container and AI recipe fields remain
          explicitly unverified metadata.
        </p>
        <p>
          For an eligible still JPEG or PNG, the Remove supported metadata workflow performs a lossless local
          structural rewrite after an explicit action and freshly checks the source's
          embedded credentials at action time. The generated file remains
          unavailable until it has been reinspected, hashed and checked again for an
          embedded Content Credential. The source stays unchanged. Output generation,
          preview and Download use a separate abortable, stale-result-guarded lifecycle
          and object URL. In-flight verifier work is disposed and any late result is ignored.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-separation-title">
        <div className="content-section__heading">
          <p className="section-index">04</p>
          <h2 id="technical-separation-title">Separation between tools</h2>
        </div>
        <p>
          OCR, steganography and media inspection use separate page state and
          operation lifecycles. No route receives another tool&apos;s selected file,
          crop, canvas, text, message, password, metadata, checksum or result.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-storage-title">
        <div className="content-section__heading">
          <p className="section-index">05</p>
          <h2 id="technical-storage-title">User-content storage rules</h2>
        </div>
        <p>The application intentionally has no local or cloud content history.</p>
        <dl className="technical-definition-list">
          <div><dt>JavaScript and worker memory</dt><dd>Transient files, metadata, checksums, credentials, pixels, messages, passwords, ciphertext and results; references are released on invalidation.</dd></div>
          <div><dt>Canvas and bitmap memory</dt><dd>Transient decoded, preview and current-section pixels; section surfaces are reused sequentially, then cleared and reset.</dd></div>
          <div><dt>Object URLs</dt><dd>Temporary source and generated clean-copy previews; each URL is revoked when superseded, replaced, cleared or the route unmounts.</dd></div>
          <div><dt>Browser databases and storage</dt><dd>No user content in localStorage, sessionStorage, IndexedDB, cookies or Cache Storage.</dd></div>
          <div><dt>URLs and document metadata</dt><dd>Fixed route information only; no filename, parsed metadata, checksum, text, message, password or result data.</dd></div>
        </dl>
      </section>

      <section className="content-section" aria-labelledby="technical-cache-title">
        <div className="content-section__heading">
          <p className="section-index">06</p>
          <h2 id="technical-cache-title">Application, OCR, JPEG and inspection assets</h2>
        </div>
        <p>
          The shell cache holds page documents, built JavaScript and CSS, local fonts,
          the manifest and icons. It may also cache same-origin lazy JavaScript and
          WebAssembly after Media Inspector first requests Content Credentials
          support. The OCR cache holds only the pinned worker, core loaders and
          selected language models. The JPEG cache holds only the exact same-origin codec after
          MIME, byte-length and SHA-256 checks.
        </p>
        <p>
          The caches never contain selected files, filenames, decoded pixels,
          parsed metadata, checksums, credentials, reports, metadata-removed copies,
          recognised text, messages, passwords, generated images or revealed text. Shell readiness, OCR
          readiness, JPEG readiness and first-use credential support are separate.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-lifecycle-title">
        <div className="content-section__heading">
          <p className="section-index">07</p>
          <h2 id="technical-lifecycle-title">Working surfaces and background-process lifecycle</h2>
        </div>
        <p>
          Every selection, analysis, generation, inspection and unlock operation has
          an identifier. Newer work invalidates late results before workers, bitmaps,
          object URLs and canvases are released. Cancellation terminates the relevant
          worker when an operation cannot be interrupted safely. OCR cancellation also
          aborts its section coordinator before termination, so no later long-document
          section starts after local invalidation.
        </p>
        <p>
          Encrypted reveal releases the large decoded image after extracting a
          structurally valid bounded payload. The worker retains only the 84-byte
          header, ciphertext and operation identifier while waiting for password retries.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-password-title">
        <div className="content-section__heading">
          <p className="section-index">08</p>
          <h2 id="technical-password-title">Password preparation and encryption</h2>
        </div>
        <p>
          Passwords are normalised to Unicode NFC without trimming and must contain
          12–256 Unicode code points. PBKDF2-HMAC-SHA-256 uses exactly 600,000
          iterations and a fresh 16-byte salt to derive an AES-256 key.
        </p>
        <p>
          AES-256-GCM uses a fresh 12-byte nonce and a 128-bit authentication tag.
          The complete 84-byte LTSG header is authenticated as additional data.
          Mutable byte buffers are overwritten where practical; JavaScript strings
          cannot be securely erased. Lost passwords cannot be recovered.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-retry-title">
        <div className="content-section__heading">
          <p className="section-index">09</p>
          <h2 id="technical-retry-title">Encrypted reveal retry state</h2>
        </div>
        <p>
          Structural and capacity checks happen before password derivation. AES-GCM
          cannot distinguish a wrong password from damaged authenticated content, so
          both conditions deliberately produce the same user-facing error.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-export-title">
        <div className="content-section__heading">
          <p className="section-index">10</p>
          <h2 id="technical-export-title">Copy, download and Clear boundaries</h2>
        </div>
        <p>
          Copy transfers text or a checksum to the operating-system clipboard.
          Download creates a PNG, JPEG, text or explicit inspection-report file
          controlled by the browser and device. Clear cannot retract either action.
        </p>
        <p>
          Clear invalidates work, terminates the feature worker, revokes object URLs,
          resets canvas dimensions and releases references. It is not secure memory
          erasure and cannot control browser internals, swap, crash recovery, backups,
          extensions or device software.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-metadata-title">
        <div className="content-section__heading">
          <p className="section-index">11</p>
          <h2 id="technical-metadata-title">Output metadata behaviour</h2>
        </div>
        <p>
          PNG output is newly encoded from the decoded image and does not preserve
          original compressed bytes or metadata. JPEG output removes APP and COM
          metadata, including ICC, GPS, XMP, IPTC, thumbnails and comments. A valid
          orientation value from 2–8 is reconstructed in a minimal EXIF marker;
          orientation 1 or no orientation produces no EXIF marker.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-cloudflare-title">
        <div className="content-section__heading">
          <p className="section-index">12</p>
          <h2 id="technical-cloudflare-title">Cloudflare hosting and analytics boundary</h2>
        </div>
        <p>
          The application has no file-upload or content-processing backend, account,
          cloud history, custom analytics events or error-reporting service.
          Cloudflare serves the production HTML and static application assets and
          consequently processes the ordinary HTTP requests needed to deliver the
          site.
        </p>
        <p>
          Production Cloudflare Web Analytics uses automatic edge injection, not a
          script manually bundled into this repository. A production browser may load{" "}
          <code>https://static.cloudflareinsights.com/beacon.min.js</code>, or a
          versioned copy at a path beginning{" "}
          <code>https://static.cloudflareinsights.com/beacon.min.js/</code>. For the
          proxied production hostname, the beacon submits page-use and performance
          measurements by <code>POST</code> to the same-origin endpoint{" "}
          <code>/cdn-cgi/rum</code>.
        </p>
        <p>Those measurements may include:</p>
        <ul>
          <li>host, page path, and referring or landing URLs where available;</li>
          <li>country, browser, operating system and device type;</li>
          <li>navigation type, page-load, resource and paint timing;</li>
          <li>Core Web Vitals, including interaction responsiveness, with related page-element selectors, geometry and resource URLs; if a preview of a selected image were measured, its resource URL would be a temporary <code>blob:</code> address made of a random identifier, not file content;</li>
          <li>rounded JavaScript memory figures and the browser engine version;</li>
          <li>an ephemeral identifier for the current page load, not an application-created visitor, device or session identifier.</li>
        </ul>
        <p>
          Cloudflare states that the beacon does not read or store cookies,
          localStorage, sessionStorage or IndexedDB. The application does not rely on
          UTM or other URL query-string analytics, and implements no custom Cloudflare
          Web Analytics events. The beacon measures History API route changes in
          this single-page application automatically and reports them as soft
          navigations; those are provider-managed page measurements, not custom
          workflow events.
        </p>
        <p>
          Analytics measurements must not contain selected files, filenames, decoded
          pixels, image dimensions derived from a selected file, OCR text, hidden or
          revealed messages, passwords or cryptographic material, media metadata,
          Content Credentials, checksums, reports, generated files, clipboard or
          download content, arbitrary application state, errors or stack traces.
          Browser privacy protections may block the beacon without preventing the
          application from working. An unavailable analytics endpoint must not prevent
          prepared offline tool functionality.
        </p>
        <p>
          The beacon is Cloudflare-controlled code executing in this origin, so the
          boundary above rests on Cloudflare&apos;s documented collection and on
          testing, not on technical isolation. A sentinel test on 6 November 2026 ran
          Extract text, Hide message and Media Inspector on the production site, with
          client-side navigation between them, under the production policy. Every
          beacon submission went to the same-origin <code>/cdn-cgi/rum</code>{" "}
          endpoint; none contained the test filename, recognised or edited text,
          hidden message, password or a <code>blob:</code> URL; and no cookie,
          localStorage, sessionStorage or IndexedDB entry was created. Cloudflare
          already serves every application file, so the beacon does not add a new
          trusted party.
        </p>
        <p>
          The official C2PA browser library is bundled and served from the same
          origin. Its Media Inspector adapter disables remote-manifest, OCSP and
          network-resolved identity checks, supplies an empty network-host list,
          and does not contact a provenance, trust-list, identity or certificate
          service while inspecting a selected file.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-contact-title">
        <div className="content-section__heading">
          <p className="section-index">13</p>
          <h2 id="technical-contact-title">Contact and security reports</h2>
        </div>
        <p>
          The site uses one public address for technical questions, privacy requests,
          vulnerability reports and other enquiries: {" "}
          <a href={`mailto:${productConfig.securityContact}`}>
            {productConfig.securityContact}
          </a>
          . The same address is published in the site&apos;s security.txt file.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-verification-title">
        <div className="content-section__heading">
          <p className="section-index">14</p>
          <h2 id="technical-verification-title">Verification procedure</h2>
        </div>
        <p>
          Use the Network and browser-storage panels with distinctive test values.
          Requests may contain site, OCR, JPEG and credential-verifier assets. On the
          production hostname, the Cloudflare beacon request (at{" "}
          <code>beacon.min.js</code> or a versioned path beneath it) and the
          same-origin <code>POST</code> to <code>/cdn-cgi/rum</code> are the only analytics
          exceptions. No request may contain filenames, selected bytes, metadata,
          checksums, results or other user content. Cache Storage may contain
          same-origin application assets, but not analytics submissions, selected or
          generated files, reports, text, messages or passwords.
        </p>
        <p><Link to={routes.verify}>Follow the full verification checklist</Link>.</p>
      </section>

      <section className="content-section" aria-labelledby="technical-specs-title">
        <div className="content-section__heading">
          <p className="section-index">15</p>
          <h2 id="technical-specs-title">Relevant technical specifications</h2>
        </div>
        <p>
          The normative repository documents are <code>docs/steganography-format-v1.md</code>
          and <code>docs/steganography-format-v2.md</code>. They define the frozen
          LTSG binary formats and take precedence over explanatory website copy.
        </p>
      </section>

      <nav className="related-links" aria-label="Technical privacy next steps">
        <h2>Return to the practical view</h2>
        <div>
          <Link to={routes.privacy}>Read the plain-language Privacy page</Link>
          <Link to={routes.howItWorksTechnical}>Read the technical processing documentation</Link>
          <Link to={routes.tool}>Open Extract text</Link>
          <Link to={routes.hideMessage}>Open Hide message</Link>
          <Link to={routes.mediaInspector}>Open Media Inspector</Link>
        </div>
      </nav>
    </ContentPage>
  );
}
