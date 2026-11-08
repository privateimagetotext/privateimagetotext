# LocalText privacy architecture

## Purpose and scope

LocalText is a browser-local processing application. Its standard build has
five independent workspaces:

- **Extract text** at `/` performs OCR on a deliberately selected raster image.
- **Hide message** at `/hide-message` creates default PNG v1 or opt-in JPEG v2 output and reveals either LocalText format.
- **Media Inspector** at `/media-inspector` reads recognised media signatures,
  supported image and ISO-container metadata, privacy clues, an exact-file
  checksum and supported Content Credentials from one deliberately selected
  file.

- **Steganography analysis** at `/steganography-analysis` reads one deliberately
  selected file in a dedicated module worker: bit planes, LSB extraction,
  printable strings, embedded signatures and bytes after PNG `IEND` / JPEG `EOI`.
  Downloads are explicit; Clear, replacement and navigation terminate the worker.
  Its size, pixel and output bounds are defined in
  `src/features/stego-analysis/limits.ts`.

- **PDF to text** at `/pdf-to-text` extracts existing PDF text or recognises
  selected pages locally with up to three of 12 OCR languages. The preview
  build remains noindex, and `VITE_ENABLE_PDF_OCR_PUBLIC=false` creates a
  PDF-disabled build. This architecture description is not a deployment claim.

The privacy boundary is part of the product architecture. Selected files,
filenames, decoded pixels, parsed metadata, checksums, inspection reports,
Content Credentials, OCR text, hidden messages, passwords, plaintext,
ciphertext, JPEG coefficients, generated PNGs/JPEGs and revealed text must not
be sent to an application backend, Cloudflare Web Analytics or another third
party. The application has no backend, upload endpoint, account, cloud history,
custom analytics event system, application telemetry or error reporting.

Cloudflare hosts and delivers the production site, so it processes ordinary
HTTP requests for the HTML and static assets. Production Cloudflare Web
Analytics separately measures aggregate page use and performance. These hosting
and analytics requests are not file-processing paths: the workspaces keep
selected files and results inside the browser.

This document describes application behaviour. It does not claim that the
browser, operating system, extensions or other software on the device cannot
access content that the user opens.

The normative binary definitions are
[LocalText steganography format v1](steganography-format-v1.md) and
[LocalText steganography format v2](steganography-format-v2.md).

## Independent workflow boundary

The tools are separate workspaces. LocalText does not transfer or reuse:

- the OCR route's selected image, crop, enhancement, preview/section canvases or reducer;
- recognised or edited OCR text;
- a PDF document, password, page canvas, extracted text or per-page edits;
- the Tesseract worker or an OCR operation result;
- a steganography carrier, message, password, generated PNG/JPEG or revealed
  text;
- a Media Inspector source `File`, preview object URL, parsed metadata,
  checksum, report or provenance result.

A user may manually copy text and paste it into another route or independently
choose the same file in more than one tool. The application does not transfer
that content between routes. Client-side navigation unmounts the route being left,
and back or forward navigation must not restore prohibited transient content.

Only content-neutral utilities may be shared, such as bounded byte reading,
signature and dimension parsing, safe filenames and object-URL disposal. The
steganography route does not use the OCR crop, rotation, enhancement renderer,
reducer or Tesseract adapter. Media Inspector does not receive source or result
state from either text workspace.

The link from the image workspace to PDF to text and the PDF guide link open
independent tabs with
`noopener noreferrer`. Opening those links retains the original tab's work
without passing selected content, an opener or a referrer to the destination.
Ordinary same-tab navigation still discards the workspace being left.

## Data flows

### Extract text

```text
 User action                 Browser main thread              OCR worker
 -----------                 -------------------              ----------
 paste / drop / choose
          |
          v
  raster image -----------> validate and decode
                              |
                              v
                       in-memory bitmap
                              |
                              v
                       crop / rotate /
                       bounded preview
                              |
                       optional sequential
                       native-detail sections
                              |
                              +--- local pixels -------------> Tesseract.js
                              |                                + WebAssembly
                              |                                      |
                              <--------- recognised text ------------+
                              |
                              v
                       editable plain text
                              |
                   +----------+----------+
                   v                     v
              system clipboard      local .txt download
              (explicit action)     (explicit action)
```

The OCR route:

1. validates and decodes a deliberately selected raster image;
2. keeps the source and reversible transform in browser memory;
3. renders crop, rotation and enhancement to a bounded in-memory preview;
4. for eligible long Adaptive documents, decodes once and renders overlapping
   native-detail sections sequentially into one bounded reusable canvas;
5. sends only the current preview or section pixels to the same-origin Tesseract
   worker and assigns overlapping lines by non-overlapping geometric ownership;
6. receives raw recognised text and derives a conservative, geometry-aware cleaned view;
7. lets the user review, edit, explicitly copy or explicitly download text;
8. invalidates stale work and releases resources on Clear, replacement,
   cancellation, navigation or teardown.

A single image admitted through drop, paste, the file picker or a bundled sample
starts one local OCR run after validation and preview preparation. Large images
still require the reduced-preview confirmation first. Crop, rotation, enhancement
and content-type changes invalidate the result and require an explicit Re-run OCR;
switching stored in-memory batch items does not start recognition. Batch processing
remains explicitly started and sequential. Cancel retains the image for a manual
retry; replacement aborts the previous run. Clear, pagehide and unmount invalidate
pending automatic work and release the existing route-owned resources.

Automatic OCR uses the same runner, worker and asset preparation as explicit OCR.
It adds no persistence, network destinations or service-worker cache entries for
user content; only the existing pinned static OCR assets may be prepared for offline
use. Copy and download still require explicit user actions.

### PDF to text

The PDF workspace accepts one deliberately selected local document. Its
main-thread adapter validates size and signature, supplies local bytes directly
to PDF.js, and owns an explicit same-origin module worker. It never constructs
a document URL for a server fetch or uploads the selected file.

1. Visiting the workspace loads its interface but not the PDF.js API, PDF worker
   or Tesseract runtime. Selecting a PDF lazily imports the pinned PDF.js API
   from `/pdf/6.2.108/api/` and starts its module worker from
   `/pdf/6.2.108/worker/`. Required CMaps, fonts, ICC and decoder assets use the
   same versioned origin; there is no CDN or remote decoder fallback.
2. A password prompt supplies the entered value only to the local PDF loading
   task. The dialog clears its input after submission, cancellation or closing;
   there is no password recovery, saved-password history or application storage.
   PDF.js/browser memory while the document is open is not claimed to be erased.
3. Existing-text-only streams selectable text without loading OCR. Automatic
   examines the existing layer before choosing embedded text or OCR per page;
   this heuristic can choose the less useful method. The explicit OCR mode and
   page overrides remain available. OCR runtime loading starts only when OCR is
   needed, except when the user explicitly prepares OCR support for offline use.
4. Scanned or explicitly OCR-selected pages are rendered and recognised
   sequentially, with one active page and one active OCR operation. Canvas
   dimensions, text intake, document/page counts and operation time are bounded.
   Large pages can be downscaled. Rendering passes local pixels to the PDF
   workspace's own Tesseract adapter; it does not borrow the image workspace's
   worker or results.
5. Raw, cleaned and edited per-page text remain in the tab. Page switching keeps
   edits; successful reprocessing replaces the applicable result, with a
   confirmation when it would discard edits. Cancellation stops pending work
   while retaining completed results. Errors and warnings use reviewed fixed
   messages rather than exposing raw parser, browser or OCR exceptions.
6. Copy and text Download act only on explicit user requests. Download uses a
   short-lived local Blob URL and page-marked plain text; the source PDF is not
   rewritten. The tool does not produce searchable PDFs, preserve exact layout,
   validate signatures, extract attachments, run document actions or provide a
   form submission layer. The adapter sets `enableXfa: false`.
7. Confirmed Clear or replacement invalidates document/operation identifiers,
   resolves outstanding password prompts, cancels/disposes sessions, terminates
   workers, zeros owned canvas dimensions and revokes download URLs. Route
   unmount and `pagehide` dispose the resources; `pagehide` and a persisted
   `pageshow` reset the view so returning requires a fresh file selection.
   Late callbacks cannot repopulate the cleared workspace. These are application
   lifecycle rules, not proof of shipping-browser back/forward cache behavior or
   secure memory erasure.

The current input ceilings are 25 MiB, 100 document pages, 50 selected pages and
25 OCR pages per operation. Rendering is bounded to 4,096 pixels per side and
4,096² pixels; text limits are 250,000 UTF-16 code units per page, 100,000 text
items per page and 2,000,000 combined code units. These bounds are not a complete
browser-memory guarantee. [Source limits](../src/features/pdf/validation.ts) and
the [session adapter](../src/features/pdf/pdfjs-adapter.ts) are authoritative.

PDF bytes, filenames, passwords, page images, extracted text and edits are
excluded from application storage, URLs, page metadata, analytics and caches.
Clear, replacement, same-tab navigation, reload and tab closure discard the
workspace; switching to a different result page does not. Clear cannot remove
clipboard history or downloaded files. Source-to-output comparison remains
necessary: extraction is not a document-authenticity or text-accuracy validation.

### Media Inspector

```text
 selected image/video/audio       Browser main thread       C2PA worker/WASM
 --------------------------       -------------------       ----------------
 choose / drop -----------------> signature and type check
                                   bounded Blob slices
                                          |
                           +--------------+---------------+
                           v                              v
                    structure/metadata             chunked SHA-256
                           |                              |
                           +---------- results ----------+
                                          |
                           privacy and AI-metadata labels
                                          |
                           temporary local preview URL
                                          |
                         supported format + selected Blob -----> validate
                                                                embedded
                                                                credential
                                          <---------------- local result
                           /                 |                    \
                  explicit checksum Copy    |            explicit JSON Download
                                             v
                                  explicit eligible clean copy
                                  structural rewrite + reinspection
                                  exact output hash + C2PA not-found
                                             |
                                  explicit Preview / Download
```

The Media Inspector route:

1. accepts one deliberately selected non-empty file no larger than 512 MiB;
2. identifies recognised formats from bounded signature reads and reports a
   mismatch when the browser-declared type disagrees;
3. reads bounded file slices to extract implemented image or container facts and
   recognised Exif, XMP, PNG, JPEG and track metadata;
4. calculates SHA-256 over the exact selected bytes in 1 MiB chunks;
5. labels recognised location, identifiers, personal names, timestamps,
   embedded previews, editing history and generation data for review;
6. presents prompt, workflow, model, sampler, seed and similar fields as
   unverified ordinary metadata, never as a detector result;
7. only after signature and structural inspection succeeds, creates a temporary
   local object URL for an image within the 8,192-pixel-side and 36-megapixel
   preview limits; video and audio decoder previews require a separate explicit
   action, and no preview URL enters navigation or storage;
8. after ordinary inspection succeeds, lazily loads the pinned C2PA browser
   code and same-origin WebAssembly and checks supported embedded credentials;
9. lets the user explicitly copy the checksum or download a local JSON report;
10. for an eligible still JPEG or PNG and only after explicit action, freshly
    checks the source's embedded Content Credentials, performs a lossless
    allowlisted structural rewrite, reinspects and hashes the result,
    verifies pixel/orientation/colour handling plus removed and remaining
    recognised metadata and preserved allowlisted rendering carriers, and
    requires the output C2PA result to be `not-found` before it exposes a
    separate Preview or Download;
11. aborts stale reads and clean-copy work where supported, invalidates
    provenance and generated results, disposes the relevant C2PA inspector,
    ignores late verifier results and revokes source and output object URLs on
    replacement, Clear, navigation or teardown.

The parser does not decode every video frame or transcode the file. A browser
preview may decode or play the selected local media independently of the
bounded structural parser.

#### Separate Media Inspector limits

Media inspection has its own limits and does not inherit OCR or steganography
caps:

| Limit | Current value | Purpose |
| --- | ---: | --- |
| Selected file at the route | 512 MiB | Reject unexpectedly large interactive work before preview, parsing or hashing |
| Bounded parser reads | 32 MiB total | Cap metadata and structural bytes copied into JavaScript |
| Individual parser slice | 4 MiB | Prevent one declared field from forcing an unbounded read |
| Parser read operations | 8,192 | Bound traversal work |
| Recognised image-metadata bytes | 8 MiB | Bound aggregate Exif, XMP and image-chunk materialisation |
| Recognised metadata entries | 1,024 | Bound result and rendering size |
| Individual metadata value | 512 KiB | Bound text, Exif, XMP and chunk expansion |
| Automatic image preview | 8,192 pixels per side and 36 megapixels | Keep browser-managed decode work behind successful structural inspection and explicit dimensions |
| Clean-copy selected source | 32 MiB, 8,192 pixels per side and 36 megapixels | Apply stricter rewrite ceilings than the 512 MiB inspection route and fail before materialising oversized input |
| Clean-copy generated output | 32 MiB | Reject output that exceeds the independently enforced file-size ceiling before it can be offered for preview or download |
| Clean-copy read chunks | 1 MiB | Keep source reads incremental and abort-checkable |
| Clean-copy structure traversal | 16,384 JPEG markers or 4,096 PNG chunks | Bound the lossless structural rewrite and reject hostile layouts |
| SHA-256 | 2 GiB implementation ceiling, 1 MiB chunks | Hash incrementally; the stricter 512 MiB route limit applies in the current UI |
| Container traversal | 16,384 boxes, depth 12 | Bound nested container work |
| C2PA browser SDK | 1,000,000,000-byte ceiling | The stricter 512 MiB route limit applies first |

These file, pixel and traversal limits are enforced bounds. They are not a
fixed browser-memory guarantee: browser-managed decoding and JavaScript copying
can use additional heap while the operation is active.

These limits are independent of the OCR raster dimensions, steganography input
limits, message limit, JPEG v2 output ceiling and WASM heap. Changing one
workspace's policy must not silently relax another's.

### Hide message: PNG v1 path

```text
 carrier image + message       Browser main thread       Steganography worker
 -----------------------       -------------------       --------------------
 paste / drop / choose ------> bounded header checks
                                and browser decode
                                      |
                                      v
                                exact RGBA raster ------> count opaque pixels
 message text ----------------> exact UTF-8 bytes        calculate capacity
 optional password ----------> NFC + mutable bytes ----> hash or PBKDF2 /
                                                           AES-256-GCM
                                                           embed payload bits
                                      <---------------- modified RGBA raster
                                      |
                                      v
                                encode a new PNG
                                      |
                             preview object URL
                                      |
                                explicit download
```

The default PNG v1 Hide workflow:

1. accepts a supported PNG, JPEG, WebP or BMP carrier within the file and
   4,096-by-4,096 decoded-dimension limits;
2. parses bounded image headers and rejects malformed or animated input before
   full browser decode where possible;
3. decodes the raster without resizing, cropping, rotating or enhancing it;
4. transfers RGBA pixels to a dedicated inline module worker;
5. calculates capacity from fully opaque pixels only;
6. encodes the exact UTF-8 message in plain or password-protected mode;
7. returns modified RGBA pixels for a new browser-encoded PNG;
8. verifies the output signature, dimensions and 80 MiB reopen limit;
9. creates a temporary preview object URL and waits for an explicit Download.

The source File or Blob is never modified or overwritten. The generated PNG is
a distinct Blob and object URL.

For a JPEG carrier, the user may instead opt in to the JPEG v2 worker path
described below. Unsupported v2 profiles remain available for explicit PNG v1
use when browser decoding succeeds; there is no silent fallback.

### Reveal message: PNG v1 path

```text
 LocalText PNG                 Browser main thread       Steganography worker
 -------------                 -------------------       --------------------
 paste / drop / choose ------> PNG validation and decode
                                      |
                                      +-----------------> inspect 84-byte header
                                                          validate structure
                                                          extract bounded payload
                                      |
          ordinary PNG <-------------+ no-message
          plain message <-------------+ digest + fatal UTF-8
          password prompt <-----------+ retain header + ciphertext only
 password --------------------> NFC + mutable bytes ----> PBKDF2 + AES-GCM
                                      <----------------- exact UTF-8 text
                                      |
                             read-only plain text
                              /              \
                       explicit Copy   explicit .txt download
```

PNG v1 reveal uses the flow above. JPEG signatures route original compressed
bytes to JPEG v2 without RGBA extraction. Structural and capacity validation occurs before
payload allocation or PBKDF2. A missing `LTSG` magic value means
`no-message`, not damage. Unsupported identifiers are rejected without
password derivation.

For an encrypted payload, the decoded pixel buffer is best-effort cleared and
released after extraction. The worker retains only the exact 84-byte header,
bounded ciphertext and operation identifier while it waits for a password.
Wrong-password retries use that bounded session. Success, Clear, replacement,
cancellation, workflow switching, navigation or teardown terminates the worker
and releases it.

Recovered content is rendered only as read-only plain text, never HTML or
Markdown.

## LocalText v1 and v2 protection boundary

LocalText reveals only documented `LTSG` PNG v1 and JPEG v2. It does not claim
compatibility with arbitrary steganography tools or unknown future formats.

Plain mode:

- embeds the exact UTF-8 message bytes;
- stores a SHA-256 digest to detect accidental damage;
- does not encrypt or authenticate against malicious replacement;
- can be recovered without a password by anyone who understands the format.

Password-protected mode:

- rejects unpaired UTF-16 surrogates;
- normalises the password to Unicode NFC without trimming;
- requires 12 to 256 Unicode code points after normalisation;
- derives an AES-256 key with PBKDF2-HMAC-SHA-256 and exactly 600,000
  iterations using a fresh 16-byte salt;
- encrypts with AES-256-GCM using a fresh 12-byte nonce and 128-bit tag;
- authenticates the complete exact 84-byte header as additional data;
- places no plaintext message digest in the encrypted header.

Passwords are not stored in the feature reducer, global configuration, URLs,
filenames, logs, storage or caches. Password fields are cleared after use.
Mutable byte buffers are overwritten where practical, but JavaScript strings
cannot be securely erased. Lost passwords cannot be recovered.

AES-GCM authentication cannot identify whether a failure came from a wrong
password or damaged authenticated content. Both conditions deliberately use the
same user-facing failure message.

## Trust boundaries

### Production hosting and application assets

The local Vite preview origin supplies HTML, JavaScript, CSS, fonts, icons,
manifest and service worker. The steganography module worker is bundled with
the application. The OCR route additionally uses same-origin Tesseract worker,
WebAssembly and English trained-data paths rather than CDN defaults. Media
Inspector's ordinary parsers and checksum implementation are application code.
Its pinned C2PA JavaScript and content-hashed WebAssembly are lazy same-origin
application assets; the SDK creates a temporary blob-backed worker.

In production, Cloudflare serves those HTML and static application assets.
Cloudflare Web Analytics may then add its JavaScript beacon automatically as the
proxied HTML response passes through Cloudflare's edge. The beacon is not
manually bundled into this repository and is not present in locally generated
HTML or local Vite development and preview responses.

A modified build or compromised dependency could change behaviour, so the
pinned lockfile, dependency review, restrictive Content Security Policy and
build verification remain important.

### Browser main thread

The main thread owns file acquisition, bounded pre-decode validation, browser
image decode, bounded media parsing and hashing, canvases, object URLs, route
state, accessibility and explicit exports. User filenames, metadata and
recovered text are rendered as text. SVG and HTML are not accepted as OCR or
steganography image input, and user text is never rendered as markup.

### OCR worker

The Tesseract worker receives one bounded OCR canvas at a time and returns
recognised text, optional structured lines and progress. Long-document sections
reuse the same worker sequentially. OCR operation identifiers and an abort signal
reject cancelled or superseded results before another section can start. The
worker is terminated on cancellation, fatal error and teardown.

### Steganography worker

The inline module worker receives transferred pixel and mutable byte buffers.
It owns capacity counting, envelope validation, hashing, PBKDF2, AES-GCM,
payload traversal, extraction and strict UTF-8 validation. Requests and
responses carry operation identifiers. Progress and errors use reviewed fixed
codes, never filenames, messages, passwords, payload excerpts or raw stacks.

Terminating the worker is the cancellation mechanism for uninterruptible Web
Crypto operations such as PBKDF2.

### Media Inspector provenance worker

After ordinary media inspection succeeds for a C2PA-reader-supported format,
the adapter lazily loads `@contentauth/c2pa-web` `0.13.4` and its
`@contentauth/c2pa-wasm` `0.11.2` WebAssembly from the application origin. The
SDK worker receives the selected `Blob`, reads a supported embedded manifest
store and returns its validation state, active label, claim generator, declared
digital source types and validation failures.

The adapter sets `verify_after_reading` and trust verification, while setting
`remote_manifest_fetch`, `ocsp_fetch` and `decode_identity_assertions` to false
and `allowed_network_hosts` to an empty list at both SDK and reader creation. It
supplies no remote trust-list URL or custom trust anchors. The normal path
therefore does not fetch a remote manifest, certificate status, external trust
update or network-resolved identity assertion.

The result distinguishes trusted, valid but not trusted, invalid, unknown,
unsupported, not found and inspection error states. `not found` means that the
supported local check found no embedded credential; it is not evidence of human
authorship or authenticity. Even a valid signed credential contains provenance
claims rather than proof that every assertion or depicted event is true. No
custom local trust list is bundled, so the interface does not describe the SDK's
validation state as a separately reviewed LocalText trust policy.

The page disposes the C2PA SDK and terminates its worker after each check. A
replacement, Clear, navigation or teardown increments the provenance run
identifier so a late result cannot repopulate the workspace.

### Service worker and Cache Storage

The service worker caches only same-origin versioned application assets and the
explicit OCR, PDF reader and JPEG codec sets. Content-hashed lazy Media Inspector chunks and
WebAssembly are application assets and may be cached after first use. The
service worker is not a user-content cache and must never cache selected files,
metadata, checksums, inspection reports, Content Credential results, blobs,
object URLs, canvas output, OCR results, messages, passwords, ciphertext,
generated PNGs/JPEGs, revealed text or downloads.

The fetch handler returns without intercepting every non-`GET` request. It does
not cache, replay or persist the Web Analytics `POST` to `/cdn-cgi/rum`, and the
Cloudflare beacon is not part of the application shell cache.

### User-controlled exports

Exports cross the LocalText application boundary only after an explicit action:

- Copy transfers selected text to the operating-system clipboard.
- Media Inspector Copy transfers the exact-file SHA-256 text to the clipboard.
- Download asks the browser to create a local PNG, JPEG, `.txt` or inspection
  `.json` file.

Clipboard history or synchronisation may retain copied content. Downloaded
files are controlled by the browser, operating system, backup and sync tools.
Clear cannot retract a clipboard copy or delete a downloaded file.

### Outside the application boundary

LocalText cannot control browser extensions, browser internals, accessibility
tools, device-management software, malware, operating-system swap, crash dumps,
screenshots, clipboard synchronisation, downloaded-file backups or other
device-level processes.

## Storage behaviour

| Location | User content | Application assets | Behaviour |
| --- | --- | --- | --- |
| JavaScript and worker memory | Transient source references, parsed metadata, checksum state, Content Credentials, clean-copy source/output files, messages, passwords, plaintext, ciphertext and results | Yes | References released on invalidation or teardown; mutable buffers zeroed where practical |
| Canvas and bitmap memory | Transient decoded and processed pixels | No | OCR/steganography canvases are cleared and dimensions set to zero on full cleanup; Media Inspector preview decoding remains browser-managed |
| Blob and object URLs | Source previews, generated PNG/JPEG previews, verified clean-copy output and short-lived text or JSON downloads | No | Source and clean-copy URLs have separate lifecycles and are revoked on regeneration, replacement, Clear or teardown; short-lived download URLs are revoked after the download starts |
| `localStorage` | Never | No | Not used for user content |
| `sessionStorage` | Never | No | Not used for user content |
| IndexedDB | Never | No | Not used for user content |
| Cookies | Never | No | No account or tracking cookies |
| Cache Storage | Never | Versioned shell/application assets, OCR and PDF reader assets, and the exact JPEG codec only | May include content-hashed lazy C2PA code/WASM after use; never selected documents/media or processing output |
| URLs, query strings and fragments | Never | Route information only | No filename, text, password or payload data in navigation |
| Document title and metadata | Never | Fixed route copy only | No content-derived metadata |
| Logs or error payloads | Never | Fixed content-free diagnostic codes only | No raw exception stacks or user values |
| Download folder | Only after explicit Download | No | Controlled by the browser and operating system |
| Clipboard | Only after explicit Copy | No | Controlled by the operating system and clipboard software |

The application intentionally has no local or cloud content history.

## Network behaviour and Content Security Policy

Repository application code reads only same-origin versioned application and
support assets. OCR may read its same-origin Tesseract worker, WebAssembly core
and English trained-data file. JPEG v2 may read its one exact same-origin codec
WebAssembly asset only while checking or using that opt-in format. Media
Inspector lazily reads its content-hashed C2PA JavaScript and WebAssembly
application assets after an eligible local inspection. Opening or using
`/hide-message` must not request OCR or lazy C2PA assets, and PNG v1 must not
request the JPEG codec.

The PDF workspace requests its versioned PDF.js API, explicit module
worker and supporting decoder/font assets from the same origin after selection.
An embedded-text-only workflow does not require OCR assets. The selected PDF is
passed as local bytes, never fetched using a content-derived URL. No document
filename, password, page text or edited result belongs in an asset request or a
Cloudflare analytics request.

The production-only exception is Cloudflare Web Analytics automatic edge
injection. A browser may load only
`https://static.cloudflareinsights.com/beacon.min.js`, or a versioned copy at a
path beginning `https://static.cloudflareinsights.com/beacon.min.js/` (Cloudflare
now injects paths such as `/beacon.min.js/v<id>`; a CSP source without a trailing
slash matches only its exact path, so the policy lists both and nothing else on
that host); for the proxied production
hostname it sends page-use and performance measurements by `POST` to the
same-origin `/cdn-cgi/rum` endpoint. The repository contains no manual snippet,
site token, tag manager, analytics package or custom event implementation.

The beacon is Cloudflare-controlled code executing in this origin, so this
boundary rests on Cloudflare's documented collection and on testing, not on
technical isolation. A sentinel test on 6 November 2026 (production site, the
production CSP, Extract text, Hide message and Media Inspector with client-side
navigation) observed seven submissions, all to same-origin `/cdn-cgi/rum`. Their
fields were location, referrer, navigation type (including soft navigations),
navigation timing, Core Web Vitals with element selectors and rectangles,
interaction latency, rounded JavaScript memory figures, browser engine version,
a page-load identifier and the site token. None contained the test filename,
OCR or edited text, hidden message, password or a `blob:` URL, and no cookie or
web-storage entry was created.

Cloudflare documents host and path, referring or landing URLs, country, browser,
operating system, device and navigation type, page-load/paint/resource timing,
Core Web Vitals, relevant page-element selectors and geometry, and performance
resource URLs as possible measurements. The beacon also generates an ephemeral
page-load identifier; the application does not create visitor, device or session
identifiers. Cloudflare states that the beacon does not read or persist cookies,
localStorage, sessionStorage or IndexedDB. Query strings and UTM parameters are
not relied upon for analytics. On this single-page application the beacon may
measure History API route changes automatically; the repository still implements
no custom workflow or completion events.

None of these measurements may contain selected files, filenames, decoded
pixels or file-derived dimensions, OCR text, messages, passwords, cryptographic
material, metadata, Content Credentials, checksums, reports, generated files,
clipboard or download content, application state, or arbitrary errors and stack
traces. Blocking or losing the analytics request must not prevent the application
or prepared offline tools from working.

The same-origin C2PA asset request is distinct from a media-content lookup. The
adapter disables remote manifests, OCSP and identity-assertion decoding, supplies
an empty allowed-host list and no external trust-list URL, and does not put any
filename, metadata, hash or manifest content into the asset request. A
remote-only credential or network-resolved identity is deliberately not
resolved by the normal inspection path.

No workspace may:

- contact a CDN, remote OCR, cryptography or storage API;
- load a remote script, worker, font, image, iframe or advertising asset other
  than the exact production beacon injected by Cloudflare;
- send user content, application telemetry, custom analytics events, session
  replay or error reports;
- issue content-bearing `POST`, `PUT`, `PATCH` or `DELETE` requests;
- put content in a GET URL, request body, header or referrer.

The production policy allows only the exact beacon URL in `script-src` and
retains `connect-src 'self'`, same-origin defaults, `worker-src 'self' blob:`,
`object-src 'none'` and `frame-ancestors 'none'`. No Cloudflare host is added to
`connect-src` because automatic injection reports to the same-origin endpoint.
The existing `wasm-unsafe-eval` and `worker-src 'self' blob:` allowances support
OCR, JPEG v2 and the C2PA worker/WASM. Local Vite development and preview retain
an analytics-free CSP. Production end-to-end tests must run with CSP enforcement.

## Object and operation lifecycle

Every asynchronous selection, analysis, generation, inspection and unlock
operation has an identifier or abort boundary. A newer selection, edit,
cancellation, workflow switch, Clear, navigation or teardown invalidates older
work before worker or object cleanup. Late responses are ignored.

### Source selection and replacement

- Validate file size, signature, bounded dimensions and supported animation
  before browser decode.
- Validate browser-decoded dimensions again and reject suspicious mismatches.
- Keep source files and bitmaps out of persistent storage and configuration.
- Revoke the previous source and result object URLs.
- Dispose `ImageBitmap` objects where supported.
- Clear superseded canvases and release their backing dimensions.
- Terminate the previous feature worker and clear message/password controls.
- For Media Inspector, abort bounded reads, invalidate the provenance run,
  dispose the C2PA worker, release the source `File`, parsed results and checksum,
  and revoke the browser preview URL.

### Generated result

A successful encoded PNG is an immutable operation snapshot. Password controls
and mutable password bytes are cleared without dispatching a user-edit action
that would revoke the just-created result. Start over, a later user edit,
replacement or Clear invalidates the result and revokes its URL.

Media Inspector assembles its JSON report only after an explicit Download
action from the current in-memory inspection result. For the narrow eligible
still JPEG/PNG profile, a separate explicit Clean Share Copy action creates a
new local file and never overwrites or automatically downloads the source. The
output remains unavailable until structural reinspection, exact hashing,
metadata/privacy comparison and an embedded-only C2PA `not-found` result all
succeed. Its retained output object URL supports explicit Preview and Download
and is revoked on regeneration, replacement, Clear, navigation or teardown.
Copy exports only the displayed checksum after an explicit action.

### Clear and teardown

Full workspace discard and teardown release the active feature's resources.
The PDF workspace distinguishes this from processing cancellation, which keeps
completed page results, and from page switching, which keeps edits. Full cleanup
includes:

- invalidate the current operation identifier;
- terminate the relevant worker;
- clear canvases and set their dimensions to zero;
- revoke source and output object URLs;
- release source File, Blob, parsed metadata, checksum, provenance, report,
  message, password, PDF document/page, plaintext, ciphertext and result references;
- best-effort overwrite mutable typed arrays;
- return the route to its empty state and restore focus appropriately.

Clear is not secure erasure. It cannot guarantee removal from JavaScript string
storage, browser internals, operating-system swap, crash recovery, clipboard
history, downloaded files or backups.

## Service-worker caches and offline operation

The application shell, OCR and PDF reader assets, optional JPEG v2 codec and lazy C2PA
application assets have distinct preparation and status semantics.

The shell cache may contain:

- canonical application routes, including `/hide-message` and
  `/media-inspector`;
- built JavaScript and CSS, including the inline steganography worker;
- local fonts, manifest and icons.

The OCR cache may contain only the exact pinned worker, WebAssembly/core and
English model files. Old named caches are removed during service-worker
activation.

The PDF reader has a separate explicitly prepared cache,
`localtext-pdf-v1-pdfjs-6.2.108`. Its exact 201-asset manifest under
`/pdf/6.2.108/` includes the API, worker, support files and licence notices.
Preparation stages responses, checks the allowlisted paths, MIME, length and
SHA-256, then publishes the verified cache with one ready marker. Absent,
partial or invalid support is not ready; failed preparation clears incomplete
state and reports failure. Ordinary startup does not prepare this cache.

PDF reader readiness and selected OCR language readiness are reported independently.
The PDF workspace's explicit preparation button requests both, but the cache
contracts remain separate. Offline existing-text extraction needs the shell and
PDF reader; scanned-page OCR also needs the selected OCR models. Missing support reports a
reviewed offline error instead of sending the document to a remote service.
Offline reload requires selecting the document again. Neither cache contains
documents, filenames, passwords, rendered page canvases or extracted/edited text.
Worker update/rollback, actual browser cache behavior and physical-device
acceptance remain release-checklist requirements; the cache design alone does
not establish them.

The JPEG codec cache may contain only `/steg/jpeg-v2-codec.wasm` after exact
MIME, size, and SHA-256 checks. PNG v1 never loads or requires it. Offline and
uncached v2 reports a fixed unavailable error while retaining the source.

Media Inspector's ordinary parsing and incremental checksum code travel with
the application. Its C2PA package chunks and WebAssembly are lazy,
content-hashed `/assets/` resources. The service worker may cache them as
versioned application assets when a supported provenance check first requests
them. If they have not been cached before the browser goes offline, ordinary
metadata inspection can still complete but provenance initialisation reports an
error; it must not fall back to a CDN. Neither path caches the selected file,
metadata, checksum, manifest result or report.

The global status reports **Preparing offline app**, **Site available offline** or
**Offline** for the shell. The OCR route reports English-model preparation and
availability separately. Media Inspector does not present its C2PA asset as
prepared until it has actually been requested and cached by a provenance check.
After normal shell preparation, a fresh offline reload of `/hide-message` must
encode and reveal without first using OCR and without an OCR or C2PA asset
request.

Offline capability does not mean content is saved. Refresh or closure discards
the active workspace unless the user explicitly downloaded a result.

## Steganography and output limitations

Steganography conceals the presence of a message; it does not guarantee
undetectability, anonymity, deniability or resistance to steganalysis.
Password protection encrypts the message; plain mode does not.

The exact generated PNG v1 or JPEG v2 must be retained. Resizing, cropping, editing, taking a
screenshot, colour conversion or recompression may destroy the payload.
Messaging and social-media services commonly transform uploaded images.
Neither format is a robust watermark or has a survival guarantee.

The codec operates on the browser-decoded RGBA raster. It does not intentionally
change alpha or RGB bytes belonging to non-opaque pixels and changes only
selected least-significant RGB bits in opaque pixels. The output is still a new
browser-encoded PNG. LocalText does not preserve original compressed bytes,
EXIF, colour profiles, comments, timestamps, thumbnails, animation or other
metadata. Browser decode/encode behaviour may alter colour representation or
translucent-pixel bytes. Converting a lossy source to PNG does not restore
information already lost.

## JPEG v2 worker and verification boundary

JPEG v2 does not pass decoded pixels to a canvas encoder. The main thread
transfers original compressed bytes to the cancellable steganography worker.
The pinned single-threaded libjpeg-turbo WASM module parses the strict profile,
accesses quantised coefficients, embeds in eligible luminance AC coefficients,
and writes through a bounded 80 MiB destination. It computes an expected state
digest, destroys the source/coefficient context, and reopens the compressed
output in a fresh context. Only verified compressed bytes can return to the main
thread and become a Blob/object URL.

The worker has a 256 MiB WASM heap ceiling. Hide input is 25 MiB; reveal input
and generated output are 80 MiB; stored dimensions are at most 4096 by 4096.
Cancellation, Clear, source replacement, workflow switching, navigation, and
teardown invalidate the operation and terminate the worker. A password-retry
session retains only the exact 84-byte header, bounded ciphertext/tag, detected
format, and operation identifier. It never retains source JPEGs or coefficient
trees while waiting for a password.

The optional codec cache is separate from shell and OCR caches. Its only
allowlisted URL is `/steg/jpeg-v2-codec.wasm`; response MIME, exact size, and
SHA-256 are validated and invalid entries are deleted. It is not prepared by
generic app/OCR load or PNG v1 work. No source bytes, coefficients, generated
JPEGs, messages, passwords, ciphertext, filenames, or result URLs enter Cache
Storage.

JPEG v2 strips source metadata, rejects ICC, and reconstructs only a single
valid orientation value in a new minimal EXIF segment when needed. The exact
generated file is the compatibility boundary. Editing, resizing, screenshots,
pixel-domain re-encoding, and quality recompression are unsupported. Password
encryption does not make coefficient changes undetectable or resistant to
steganalysis.

## Threat considerations

| Threat | Architectural response | Residual limitation |
| --- | --- | --- |
| Accidental upload | No application backend; content-free hosting/analytics boundary; sentinel and network tests | A compromised build or provider change could violate the design |
| Cross-feature disclosure | Separate routes, reducers, workers and teardown | A user may manually copy content between tools |
| Hidden external dependency | Local fonts, workers and models; restrictive CSP | Package supply-chain integrity still needs review |
| Content persisted by the app | No content storage; exact cache allowlists | Browser memory, swap and crash recovery are outside application control |
| Stale result after Clear or replacement | Operation IDs, invalidation and worker termination | Browser termination timing is implementation-dependent |
| Script injection through text or names | Plain-text rendering; SVG rejection; safe filenames | Browser or extension vulnerabilities remain outside scope |
| Oversized or malformed raster | Bounded header parsing, file/dimension limits, safe arithmetic | Browser decoder vulnerabilities cannot be fully mitigated in app code |
| Oversized or malformed media metadata | 512 MiB route cap; bounded reads, slices, metadata bytes, entries, values, container count/depth and abort checks | Browser media preview decoders and parser defects still require review |
| Misleading or absent AI metadata | Ordinary metadata labelled unverified; no AI/human verdict; absence leaves origin unknown | A user must interpret editable or incomplete evidence |
| Remote C2PA disclosure | Embedded-only policy; remote-manifest, OCSP and identity-assertion network resolution disabled; empty allowed-host list; no external trust-list URL | Remote-only credentials and identities are not resolved, and local trust may remain unestablished |
| Misinterpreted checksum | Label as exact-file SHA-256 only | A matching or unique digest does not establish safety, authorship or authenticity |
| Media preview retained after replacement | One transient object URL; revoke on replacement, Clear and teardown | Browser decode buffers and operating-system memory remain outside app control |
| Malicious JPEG or codec allocation pressure | Strict preparse/profile checks, checked C arithmetic, bounded destination, 256 MiB WASM ceiling, worker termination, native sanitizers/fuzz smoke | Native codec defects remain a supply-chain and memory-safety risk |
| False-success JPEG output | Source context destruction, fresh reopen, canonical-state digest, header/payload and crypto verification before Blob creation | Verification code itself requires continued review |
| JPEG metadata disclosure | No source marker copying; ICC rejection; canonical JFIF and orientation-only EXIF | Decoded visual content can itself disclose information |
| Hostile header causing KDF work | Canonical validation before PBKDF2; fixed 600,000 iterations | PBKDF2 remains intentionally computationally expensive |
| Wrong password oracle | Same error for wrong password and authenticated damage | Timing properties of browser crypto are outside app control |
| Plain-message modification | SHA-256 detects accidental damage | Plain mode is not malicious-tamper authentication |
| Payload destroyed in transit | Prominent exact-file/edit/recompression warnings | Many platforms transform images |
| Undetectability claim | Explicitly disclaimed | Steganalysis is outside LocalText's capability |
| Clipboard or download retention | Explicit actions and truthful caveats | OS history, sync and backups are outside app control |
| Service-worker over-caching | Exact query-free allowlists and cache tests | Programming errors require review and regression tests |
| Local server network exposure | Vite binds to `127.0.0.1` | A deliberate host override changes this boundary |
| Third-party advertising access | No advertising or sponsor code on any sensitive tool | Any change requires a new privacy, CSP and network review |
| Analytics content disclosure | Exact beacon/CSP boundary; no custom events; sentinel payload inspection | Cloudflare's injected script and documented fields require post-deployment verification |

LocalText does not claim perfect confidentiality, secure erasure, anonymity,
undetectability, regulatory compliance or protection against a compromised
device.

## Verification procedure

These steps are a procedure, not a record of a successful test run.

1. Install from the pinned lockfile, build and run the local production preview.
2. In a fresh browser context, open each sensitive route with Network and
   Console preservation enabled.
3. Use distinctive test values for source filenames, media metadata, messages,
   passwords, recognised text and revealed text.
4. Exercise OCR, Media Inspector metadata/checksum/provenance/report flows,
   plain Hide/Reveal, encrypted Hide/Reveal, wrong-password retry, Copy,
   Download, Clear, replacement and cross-route navigation.
5. In local development and preview, confirm every runtime request remains
   same-origin and no Cloudflare beacon or RUM request appears. On the deployed
   production hostname, permit only the exact external beacon load and the
   same-origin `POST` to `/cdn-cgi/rum`; treat every other unexpected third-party
   request as a failure.
6. Inspect production request URLs, headers and the `/cdn-cgi/rum` payload.
   Confirm no distinctive filename/content sentinel, selected bytes, OCR text,
   message, password, metadata, checksum, report or generated content appears.
7. Confirm no test value appears in the current/history-visible URL, title,
   metadata, console, localStorage, sessionStorage, IndexedDB, cookies, cache
   keys or safe cache-response text.
8. Confirm Cache Storage contains only canonical shell/application, OCR and
   optional JPEG codec asset URLs. Lazy C2PA entries must be same-origin,
   content-hashed application assets; no blob, selected file, metadata,
   checksum, report, generated file, analytics payload or content-derived request
   may appear.
9. During active work, Clear, replace, switch workflow and navigate away;
   confirm late progress or results do not restore the workspace.
10. In a fresh context, load `/hide-message` online until the shell is ready,
   confirm no `/ocr/` request, go offline, directly reload `/hide-message`, then
   encode and reveal a password-protected PNG v1 message. Then prepare JPEG v2
   online, reload offline, and hide/reveal plain and encrypted exact JPEGs.
    Confirm the analytics request may fail or be absent, is not queued by the
    application, and cannot break prepared offline functionality.
11. Separately prepare OCR assets, go offline and verify real OCR still works.
12. Online, inspect a supported fixture once so the lazy C2PA code and WASM are
    requested. Go offline, reload `/media-inspector`, repeat inspection and
    confirm metadata/checksum operation, embedded-only provenance behaviour and
    absence of selected-file requests. Repeat in a fresh uncached context and
    confirm unavailable C2PA assets produce an error without a CDN fallback.
13. Run unit, rendered-build, production CSP, accessibility, Chromium,
    Firefox/WebKit smoke, media-limit and maximum-dimension checks. Report
    commands and results separately; do not infer success from a build alone.
