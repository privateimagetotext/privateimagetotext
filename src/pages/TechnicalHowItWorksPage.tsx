import { OCR_LANGUAGES, languageDownloadSize } from "../config/ocr-languages";
import languageManifest from "../config/ocr-languages.json" with { type: "json" };
import { Link } from "react-router";
import { productConfig, routes } from "../config/product";
import { ContentPage } from "./ContentPage";
import { PageBreadcrumbs } from "../components/PageBreadcrumbs";
import { UNCERTAIN_WORD_CONFIDENCE } from "../features/ocr/review";

const technicalHowItWorksTableOfContents = [
  { id: "technical-validation-title", label: "Supported formats and validation limits" },
  { id: "technical-ocr-title", label: "OCR decoding and image preparation" },
  { id: "technical-ocr-worker-title", label: "OCR modes, results and cancellation" },
  { id: "technical-languages-title", label: "Pinned OCR languages and hashes" },
  { id: "technical-png-title", label: "LTSG PNG v1 embedding" },
  { id: "technical-jpeg-title", label: "LTSG JPEG v2 coefficient embedding" },
  { id: "technical-capacity-title", label: "Message capacity and application limits" },
  { id: "technical-header-title", label: "LTSG headers and compatibility" },
  { id: "technical-encryption-title", label: "Password preparation and encryption" },
  { id: "technical-reveal-title", label: "Reveal inspection and password retries" },
  { id: "technical-jpeg-profile-title", label: "JPEG profiles, verification and metadata" },
  { id: "technical-exact-file-title", label: "Exact-file limitations" },
  { id: "technical-offline-title", label: "Application, OCR and JPEG offline caches" },
  { id: "technical-cleanup-title", label: "Cleanup and memory limitations" },
  { id: "technical-media-inspector-title", label: "Media metadata, checksums and provenance" },
  { id: "technical-specification-title", label: "Normative specifications and test vectors" },
] as const;

export function TechnicalHowItWorksPage() {
  return (
    <ContentPage
      beforeHeader={<PageBreadcrumbs />}
      eyebrow="Technical documentation"
      title="Technical documentation for OCR, media inspection and image steganography"
      introduction="This page documents file validation, OCR processing, media metadata and provenance inspection, LTSG PNG v1 and JPEG v2, encryption, offline assets and cleanup behaviour. The plain How it works page provides the shorter explanation."
      actionLabel="Read the plain How it works page"
      actionTo={routes.howItWorks}
      className="technical-page technical-how-it-works-page"
      tableOfContents={technicalHowItWorksTableOfContents}
    >
      <section className="content-section content-section--lead" aria-labelledby="technical-validation-title">
        <h2 id="technical-validation-title">Supported formats and validation limits</h2>
        <p>
          Image OCR accepts PNG, JPEG, WebP and BMP files up to
          {` ${productConfig.fileLimits.maximumFileSizeLabel}`} and
          {` ${productConfig.fileLimits.maximumDecodedPixelsLabel}`}.
          Header dimensions are bounded before browser decode and decoded dimensions
          are checked again. SVG, PDF, animation and malformed or mismatched input
          are rejected where the active workflow requires it.
        </p>
        <p>
          OCR prepares a bounded preview whose longest side is at most
          {` ${productConfig.fileLimits.maximumCanvasSide.toLocaleString("en-AU")} pixels`}.
          Large images can be reduced after approval. Adaptive document may instead
          enlarge a crop with a longest side up to 900 pixels by at most 3×, or one
          up to 1,600 pixels by at most 2×. Larger crops are not enlarged by default.
          Every prepared image remains within the same 4,096-pixel side limit and a
          {` ${(productConfig.fileLimits.maximumCanvasSide ** 2).toLocaleString("en-AU")}-pixel`}
          preview-preparation budget. When Document content and Adaptive document are
          selected, an eligible portrait crop taller than 4,096 pixels is instead
          recognised sequentially in overlapping native-detail sections. Each section
          remains within a 4,096-pixel side and 8,388,608-pixel budget; only one section
          canvas is retained at a time.
          The steganography tool instead decodes without resizing and accepts images
          no larger than 4,096 × 4,096 pixels. Hide input is limited to 25 MiB;
          reveal and generated-output reopening are limited to 80 MiB.
        </p>
        <p>Image batches retain at most 10 source files and 100 MiB in total. One image is recognised at a time; inactive images retain file references and text settings, without a live canvas or preview URL. Combined and separate-file exports use the current edited text.</p>
        {__PDF_OCR_PUBLIC__ && routes.pdfToText ? <p>The <Link to={routes.pdfToText}>separate PDF tool</Link> accepts one document up to 25 MiB and 100 pages, with at most 50 selected pages and 25 OCR pages per operation. Streamed text intake, render pixels, processing time and output length are bounded. Plain-text extraction does not preserve document layout.</p> : null}
      </section>

      <section className="content-section" aria-labelledby="technical-ocr-title">
        <div className="content-section__heading">
          <p className="section-index">02</p>
          <h2 id="technical-ocr-title">OCR decoding and image preparation</h2>
        </div>
        <p>
          The OCR page keeps the source File and a reversible transform in memory.
          Source-relative crop coordinates and 90° rotation are rendered before tonal
          preparation. The bounded preview is separate from any native-detail section
          canvas, and the original file is never overwritten. Coordinate metadata names
          source pixels, the exact integer source crop, the manually oriented page,
          prepared section pixels and fine-rotated engine pixels. Exact forward and
          inverse affine transforms retain independent horizontal and vertical scales.
        </p>
        <dl className="technical-definition-list">
          {productConfig.enhancementPresets.map((preset) => (
            <div key={preset.id}><dt>{preset.label}</dt><dd>{preset.description}</dd></div>
          ))}
        </dl>
        <p>
          Image OCR suggests Screenshot / app for clipboard images. For other images,
          a local sample of the original prepared preview, at most 192 × 192 pixels,
          checks a 32-bin luminance histogram, neighbouring pixel differences and long
          horizontal or vertical contrast edges. A mostly uniform dark or light surface
          with sharp rectangular regions and few gradients suggests Screenshot / app;
          varied tones without long straight edges suggest Document with Adaptive document.
          Ambiguous images keep Document with Original enhancement. The content select
          marks the choice as (suggested); this is a heuristic, not a guarantee, and
          Code / terminal remains available for preserving code spacing and line breaks.
          Manual content and enhancement choices take priority for subsequent images,
          including batches, until the tab reloads or closes; Clear and in-app navigation
          keep those choices. Suggestions and overrides stay in memory, use no storage
          or network requests, and do not change PDF, steganography or media-inspector defaults.
        </p>
        <p>
          Adaptive document converts pixels to luminance, applies conservative
          percentile stretching, mildly sharpens only when the crop was enlarged, and
          reverses polarity only when the histogram strongly indicates light text on a
          dark background. It uses the local OCR engine's built-in Sauvola thresholding
          method. A bounded page preview supplies one percentile and polarity plan to
          every native-detail section so contrast decisions do not change at seams.
          Existing presets explicitly reset thresholding to Otsu for every run.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-ocr-worker-title">
        <div className="content-section__heading">
          <p className="section-index">03</p>
          <h2 id="technical-ocr-worker-title">OCR modes, results and cancellation</h2>
        </div>
        <p>
          Tesseract.js 7 runs in a same-origin worker with pinned language models.
          Each content-mode ID selects a segmentation strategy, spacing rule and
          conservative cleanup policy. Every recognition also supplies an explicit
          thresholding method so settings cannot carry over between runs. Adaptive
          document enables the engine's fine auto-deskew for Document, Columns,
          Screenshot, Code and Scattered text modes. This slice leaves Single line
          disabled because the corpus does not yet contain a like-for-like single-line
          skew benchmark. Manual 90° rotation stays separate. Columns uses automatic
          page-layout analysis on one bounded prepared canvas to read clear side-by-side
          text down each column. Code / terminal preserves spacing and avoids prose
          cleanup; Single line concentrates recognition on one line.
        </p>
        <p>
          Native-detail sections use a fixed 256-pixel recognition overlap and
          non-overlapping half-open ownership bands. Structured line centres determine
          the sole owning section, so identical legitimate lines are not removed by text
          matching. The measured single-block section layout is used only for this
          Adaptive document path; existing mode segmentation remains unchanged.
          Columns deliberately remains ineligible for native vertical tiling because
          tile-major sections cannot guarantee whole-column reading order. Long,
          irregular or densely packed columns still require careful review. Returning
          from a typed layout run to an established Original-mode segmentation setting
          recycles the OCR worker so engine state cannot leak between content modes.
        </p>
        <p>
          Original OCR is the worker response for one-canvas recognition. For a tiled
          page it is the raw recognised lines owned by each section, combined in page
          order without suffix matching. Tidied applies conservative line-end
          normalisation, geometry-aware paragraph repair, line joining and
          dehyphenation. Markdown generates a text representation of recognised
          headings and clear columns; it does not infer tables. These three generated
          views are read-only. Your edits starts as a separate copy of Tidied, and
          Edit this version replaces it with the currently selected generated view.
          Corrections change Your edits while the generated views remain available.
          Recognition confidence is an engine estimate, not calibrated accuracy or
          a guarantee that a word is correct.
        </p>
        <p>
          Single-image and batch image recognition request structured word geometry
          and retain it with the in-memory result. When words are available, expand
          Review words against the image, then select a word to highlight its
          source-image envelope in a local image preview. Show uncertain words only
          filters words below {UNCERTAIN_WORD_CONFIDENCE}% engine confidence; words
          with no confidence score are excluded from that filter. This threshold is
          a review hint, not a measured error rate. Apply correction changes Your edits
          only when the word and its neighbouring context identify one unambiguous
          position. Otherwise, correct the text directly in Your edits.
        </p>
        <p>
          Rerun selected region recognises a padded crop around the selected source
          word locally, using the current languages, rotation and enhancement with
          Single line recognition. It places a suggestion in the correction field for
          review before Apply correction; it does not automatically change any result
          or replace the original word geometry or confidence. A small crop can omit
          useful context, and a rerun is not guaranteed to improve recognition.
        </p>
        <p>
          Each engine rectangle retains its four corners while exact inverse
          transforms map it through prepared-section and oriented-page pixels to
          original source-image pixels. The review preview draws the resulting
          axis-aligned source envelope. Native overlap words follow the existing
          half-open owned-line decision, without text matching. Synthetic browser
          anchors validate crop, every manual quarter turn, independent preview
          scales, fine deskew and native section seams. Images, text and word geometry
          are not uploaded, logged or persisted by this workflow.
        </p>
        <p>
          Operation identifiers reject stale responses. Cancel terminates the active
          OCR adapter and prevents any later section from starting while preserving the
          selected image so the user can try again. Clear and pagehide also abort the
          section coordinator and release its decoded bitmap and bounded canvas.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-languages-title">
        <h2 id="technical-languages-title">Pinned OCR languages</h2>
        <p>Image OCR supports the 12 languages below, with English selected by default and at most three at once. Choices stay in page memory and reset on navigation or reload. Batches and region retries use the current selection. The separate PDF tool continues to use English for scanned pages.</p>
        <p>These integer LSTM models come from <a href={`https://github.com/tesseract-ocr/tessdata_fast/tree/${languageManifest.revision}`}>tessdata_fast at revision {languageManifest.revision}</a>, under the <a href="/ocr/TESSDATA-LICENSE.txt">Apache 2.0 licence</a>. Tagalog uses the upstream Filipino model code fil. Fast models trade some accuracy for smaller downloads and faster recognition; review every result.</p>
        <p>Gzipped files are served only from this origin under /ocr/lang/&lt;code&gt;/ with a hash in each filename. The build verifies compressed and decompressed hashes and sizes. On load the app verifies the SHA-256 of either the gzip bytes or the pinned original bytes when HTTP transparently decompresses the response, before passing those exact bytes to Tesseract; its independent IndexedDB model cache is disabled. The service worker also verifies every OCR asset before caching or serving it. A mismatch fails closed.</p>
        <p>Selecting a language does not start a download. Download selected languages in the image OCR language picker (or Prepare offline OCR) explicitly caches the selected models and engine variants before recognition. First recognition also fetches any missing selected models automatically. Cached models from earlier selections remain available; readiness lists each verified language. Cache eviction or clearing browser data removes readiness. Neither images nor recognised text enter these caches.</p>
        <p>All image enhancement presets and content modes remain available for Latin, Devanagari and Thai scripts. For any Hindi or Thai selection, Tidied keeps the raw response and Latin text cleanup (including Code / terminal cleanup) is disabled. Synthetic script fixtures establish basic recognition, not accuracy across real documents.</p>
        <dl className="technical-definition-list">
          {OCR_LANGUAGES.map(model => <div key={model.id}>
            <dt>{model.label} ({model.id})</dt>
            <dd>{languageDownloadSize(model.bytes)} gzipped ({model.bytes.toLocaleString("en-AU")} bytes); {model.script}.<br />
              <code className="ocr-model-hash">Gzip SHA-256: {model.sha256}</code><br />
              <code className="ocr-model-hash">Original SHA-256: {model.uncompressedSha256}</code>
            </dd>
          </div>)}
        </dl>
      </section>

      <section className="content-section" aria-labelledby="technical-png-title">
        <div className="content-section__heading">
          <p className="section-index">04</p>
          <h2 id="technical-png-title">LTSG PNG v1 embedding</h2>
        </div>
        <p>
          PNG v1 remains the default and accepts PNG, JPEG, WebP or BMP source
          pictures. The browser decodes the image to exact RGBA pixels without crop,
          rotation, enhancement or resizing. Capacity counts fully opaque pixels only.
        </p>
        <p>
          The 84-byte, 672-bit big-endian header is stored sequentially in eligible
          RGB least-significant bits. Message bits use a constant-additional-memory
          affine permutation over the remaining physical RGB domain. Alpha values and
          RGB samples belonging to non-opaque pixels are not intentionally changed.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-jpeg-title">
        <div className="content-section__heading">
          <p className="section-index">05</p>
          <h2 id="technical-jpeg-title">LTSG JPEG v2 coefficient embedding</h2>
        </div>
        <p>
          JPEG v2 is opt-in and accepts only a supported JPEG source. Original
          compressed bytes go to a single-threaded libjpeg-turbo WebAssembly worker;
          the browser canvas JPEG encoder is not used.
        </p>
        <p>
          Eligible luminance AC coefficients have magnitudes from 2 to 1023. Groups
          of seven coefficients carry three bits, changing at most one coefficient in
          each group. The first 1,568 eligible coefficients are reserved for the
          v2 header. Output is a newly canonicalised baseline Huffman JPEG.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-capacity-title">
        <div className="content-section__heading">
          <p className="section-index">06</p>
          <h2 id="technical-capacity-title">Message capacity and application limits</h2>
        </div>
        <p>
          Capacity is calculated from exact UTF-8 bytes, not character estimates.
          Messages are limited to 1,048,576 bytes. Encrypted capacity also reserves
          the 16-byte AES-GCM authentication tag. A result is never silently switched
          to another output format when the selected format is unavailable or too small.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-header-title">
        <div className="content-section__heading">
          <p className="section-index">07</p>
          <h2 id="technical-header-title">LTSG headers, integrity and compatibility</h2>
        </div>
        <p>
          Both formats use an exact 84-byte envelope with different version and
          embedding-suite identifiers. A missing LTSG format marker is reported as
          no compatible message, not damage. Unsupported versions are rejected rather
          than reinterpreted.
        </p>
        <p>
          Plain messages store a SHA-256 digest to detect damage; this is not
          authentication. PNG v1 remains supported indefinitely. Older v1-only
          clients cannot reveal v2, while current clients never convert a v1 PNG to JPEG.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-encryption-title">
        <div className="content-section__heading">
          <p className="section-index">08</p>
          <h2 id="technical-encryption-title">Password preparation and AES-GCM encryption</h2>
        </div>
        <p>
          Passwords use Unicode NFC normalisation without trimming and must contain
          12–256 Unicode code points. PBKDF2-HMAC-SHA-256 runs exactly 600,000
          iterations with a fresh 16-byte salt. AES-256-GCM uses a fresh 12-byte nonce,
          a 128-bit tag and the entire 84-byte header as authenticated additional data.
        </p>
        <p>
          The encrypted header carries no plaintext digest. Passwords are not stored
          in reducers, URLs, filenames, logs, storage or caches. Lost passwords cannot
          be recovered.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-reveal-title">
        <div className="content-section__heading">
          <p className="section-index">09</p>
          <h2 id="technical-reveal-title">Reveal inspection and password retries</h2>
        </div>
        <p>
          Reveal selects the codec from the file signature, validates the fixed header
          and bounds capacity before payload allocation or password derivation. Plain
          messages require a matching digest and strict UTF-8 decode.
        </p>
        <p>
          For encrypted messages, the large decoded image is released after extraction.
          The worker retains only the header, bounded ciphertext and operation ID for
          retries. Wrong passwords and damaged authenticated content share one error
          because AES-GCM cannot distinguish their cause.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-jpeg-profile-title">
        <div className="content-section__heading">
          <p className="section-index">10</p>
          <h2 id="technical-jpeg-profile-title">JPEG profiles, output verification and metadata</h2>
        </div>
        <p>
          JPEG v2 accepts documented grayscale and YCbCr 4:4:4, 4:2:2 or 4:2:0
          Huffman profiles, including bounded progressive input. Unsupported
          browser-decodable JPEGs remain available for an explicit PNG v1 workflow.
        </p>
        <p>
          Before bytes leave the worker, the generated JPEG is closed and reopened in
          a fresh codec context. The source context is destroyed. APP and COM metadata,
          colour profiles, GPS, XMP, IPTC, thumbnails and comments are removed. Only a
          valid orientation from 2–8 is reconstructed in a minimal EXIF marker.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-exact-file-title">
        <div className="content-section__heading">
          <p className="section-index">11</p>
          <h2 id="technical-exact-file-title">Exact-file limitations</h2>
        </div>
        <div className="limitation-callout">
          <ul>
            <li>Steganography does not guarantee undetectability, anonymity or deniability.</li>
            <li>Keep the exact generated PNG or JPEG.</li>
            <li>Resizing, cropping, editing, screenshots, colour conversion and recompression may destroy the message.</li>
            <li>Neither format is a robust watermark or has a survival guarantee.</li>
          </ul>
        </div>
      </section>

      <section className="content-section" aria-labelledby="technical-offline-title">
        <div className="content-section__heading">
          <p className="section-index">12</p>
          <h2 id="technical-offline-title">Application, OCR and JPEG offline caches</h2>
        </div>
        <p>
          The service worker maintains separate allowlisted shell, OCR and JPEG-codec
          caches. PNG v1 does not load the JPEG codec, and Hide message does not load
          OCR assets. Offline and uncached JPEG v2 reports a fixed error while keeping
          the source available for an explicit PNG choice.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-cleanup-title">
        <div className="content-section__heading">
          <p className="section-index">13</p>
          <h2 id="technical-cleanup-title">Cleanup and memory limitations</h2>
        </div>
        <p>
          Replacement, cancellation, Clear, navigation, pagehide and unmount invalidate
          pending operation IDs, terminate workers, revoke object URLs, close bitmaps,
          clear canvases and release references. Mutable byte buffers are overwritten
          where practical. JavaScript strings, browser internals and operating-system
          memory cannot be securely erased by this site.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-media-inspector-title">
        <div className="content-section__heading">
          <p className="section-index">14</p>
          <h2 id="technical-media-inspector-title">Media metadata, checksums and provenance</h2>
        </div>
        <p>
          Media Inspector detects supported formats from byte signatures rather than
          trusting the filename. It performs bounded random-access reads for image
          chunks, JPEG markers and ISO Base Media File Format boxes, applies explicit
          traversal and metadata limits, and hashes the exact file incrementally.
        </p>
        <p>
          Parsed EXIF, XMP, PNG text, JPEG comments and container fields are ordinary
          editable metadata. Privacy and AI-related views classify recognised fields
          without inferring authenticity. Supported Content Credentials are checked
          by the bundled C2PA WebAssembly verifier with remote manifests, OCSP and
          network-resolved identity checks disabled. Credential integrity, the
          verifier's local trust state and declared source types remain separate
          result fields; no custom trust anchors are bundled.
        </p>
        <p>
          Remove supported metadata is a separate explicit action for the narrow eligible still
          JPEG and PNG profile. It freshly checks embedded source credentials when the
          action starts, performs a lossless structural rewrite without re-encoding the
          encoded pixel payload, then reinspects and hashes the output,
          verifies pixel, orientation and colour handling, compares removed and
          remaining recognised metadata and privacy findings, enumerates preserved
          rendering structure, and requires the output Content Credentials result
          to be not found. Only then can the user preview or
          download the separate output; the source is never overwritten.
        </p>
      </section>

      <section className="content-section" aria-labelledby="technical-specification-title">
        <div className="content-section__heading">
          <p className="section-index">15</p>
          <h2 id="technical-specification-title">Normative specifications and test vectors</h2>
        </div>
        <p>
          The frozen binary contracts are defined by
          {" "}<code>docs/steganography-format-v1.md</code> and
          {" "}<code>docs/steganography-format-v2.md</code>. Repository fixtures and
          unit tests cover vectors, capacity arithmetic, encryption, codec boundaries,
          wrong-password retry and output reopen verification.
        </p>
      </section>

      <nav className="related-links" aria-label="Technical documentation next steps">
        <h2>Return to the tools or plain explanation</h2>
        <div>
          <Link to={routes.howItWorks}>Read the plain How it works page</Link>
          <Link to={routes.privacyTechnical}>Read the technical privacy architecture</Link>
          <Link to={routes.tool}>Open Extract text</Link>
          <Link to={routes.hideMessage}>Open Hide message</Link>
          <Link to={routes.mediaInspector}>Open Media Inspector</Link>
        </div>
      </nav>
    </ContentPage>
  );
}
