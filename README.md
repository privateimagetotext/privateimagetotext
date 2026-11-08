# Private Image to Text

**Browser-only tools for images and PDFs: extract text, hide a message, and
inspect metadata. Your files are processed in your browser, not uploaded.**

Live site: <https://privateimagetotext.com>

The internal codename for this project is **LocalText**, and you will see that
name throughout the code and the detailed documentation below.

## The tools

| Tool | Route | What it does |
|---|---|---|
| Extract text | [`/`](https://privateimagetotext.com/) | OCR for PNG, JPEG, WebP and BMP images with Tesseract.js, in up to three of 12 languages at once, including batches of up to 10 images |
| PDF to text | [`/pdf-to-text`](https://privateimagetotext.com/pdf-to-text) | Copies a PDF's existing text, or recognises selected pages with OCR |
| Hide or reveal a message | [`/hide-message`](https://privateimagetotext.com/hide-message) | Hides a text message in a PNG or a supported JPEG, optionally protected with a password (AES-256-GCM, PBKDF2-SHA-256 at 600,000 iterations). Reveal reads only this site's own formats. |
| Media Inspector | [`/media-inspector`](https://privateimagetotext.com/media-inspector) | Shows image and video metadata, location clues, a SHA-256 checksum and embedded Content Credentials (C2PA), and can save a JPEG or PNG copy with supported file-level metadata removed |

There is no account, upload endpoint, cloud history, advertising or
application telemetry. Once the site files, and for OCR the selected language
data, are saved in the browser, the tools can run offline. Some features (PDF
to text, JPEG hidden messages and Content Credentials checks) load extra
files the first time you use them, so use them once while online first.

## What "private" means here, and what it doesn't

- **Your content stays in the browser.** Selected files, filenames, pixels,
  metadata, checksums, recognised text, messages, passwords and generated files
  are processed with in-browser JavaScript, Web Workers and WebAssembly. The
  production Content Security Policy limits network connections to the site's
  own origin (`connect-src 'self'`).
- **Hosting still sees ordinary requests.** Cloudflare serves the static files,
  so it processes normal web-request information such as IP addresses and the
  pages and assets requested. Cloudflare also adds Network Error Logging
  headers (`report-to` and `nel`), which ask the browser to report failed
  page or asset loads (the URL, status and timing, not file content) to
  `a.nel.cloudflare.com`.
- **There is one third-party script.** Production uses Cloudflare Web
  Analytics, which Cloudflare injects at the edge. The script loads from
  `static.cloudflareinsights.com` and sends page-view and performance
  measurements (such as the page URL, referrer, browser and timings) to the
  same-origin `/cdn-cgi/rum` endpoint, where Cloudflare aggregates them. It is
  not part of this repository, and the application sends it no file content or
  results. Local builds and self-hosted copies do not include it.
- **The browser and device are outside the boundary.** Extensions, the
  operating system, clipboard history and downloaded files are not under the
  site's control, and "Clear" is not secure memory erasure.

The full design, data flows and limits are in
[docs/privacy-architecture.md](docs/privacy-architecture.md).

## How to verify it yourself

You do not have to take the claims above on trust:

1. **Watch the network.** Open your browser's developer tools, go to the
   Network tab, then run any tool. Requests should go only to the site's own
   origin, plus the Cloudflare beacon script from `static.cloudflareinsights.com`
   described above. No request should carry your file or results.
2. **Go offline.** Load a tool, disconnect from the network (or tick
   "Offline" in developer tools) and use it. For OCR, use **Prepare offline
   OCR** while connected first.
3. **Check the headers.** `curl -sI https://privateimagetotext.com/` shows the
   enforced Content Security Policy and the other headers described above.
   The policy is defined in [`public/_headers`](public/_headers); the
   Network Error Logging headers are added by Cloudflare, not by this
   repository.
4. **Follow the guided checks.** The
   [/verify](https://privateimagetotext.com/verify) page walks through the
   network, storage and cache checks step by step.
5. **Read or build the source.** Everything the site runs is built from this
   repository and the pinned, same-origin assets it lists in
   [NOTICE.md](NOTICE.md). There is no published reproducible-build process
   yet, so you cannot currently compare the deployed files with a build from
   source byte for byte. Building and serving your own copy (below) is the
   strongest check available today.

## Self-host the static build

The site is a static build with no server component.

```sh
pnpm install --frozen-lockfile
pnpm run build
```

This writes the site to `dist/`. Node.js 22.22 or newer and pnpm 11.9.0 are
required. The build prepares the pinned OCR, PDF and JPEG assets from the
installed packages and vendored files; it does not download models at runtime.

To try the build locally, run `pnpm run preview` and open
<http://127.0.0.1:4173/>.

To host `dist/` on any static web server:

- Serve extensionless routes from their HTML files, for example
  `/hide-message` from `hide-message.html`, and use `404.html` for unknown
  paths. Some routes have both a file and a folder (`privacy.html` and
  `privacy/`), so try `<path>.html` before the directory (for example, nginx
  `try_files $uri.html $uri $uri/ =404`).
- Apply the security headers from [`public/_headers`](public/_headers). That
  file uses the Cloudflare and Netlify `_headers` format; other servers need
  the same headers set in their own configuration. If you do not use
  Cloudflare Web Analytics, you can remove the two
  `static.cloudflareinsights.com` entries from `script-src`.
- Serve the site over HTTPS (or from `localhost`), because the offline service
  worker and some browser APIs need a secure context.
- Canonical links, the sitemap and structured data point to
  `https://privateimagetotext.com` (`SITE_ORIGIN` in
  [`src/config/routes.ts`](src/config/routes.ts)). Change it if you publish
  your own copy under another domain.

[`wrangler.jsonc`](wrangler.jsonc) is the configuration used for production on
Cloudflare Workers static assets.

## Security, contributing and licence

- **How it's built:** Simon develops this with AI coding assistance (Claude
  Code). He reviews every change before it goes live, and CI runs the test
  suite in Chromium, Firefox and WebKit on every pull request and on `main`.
- Report security issues privately: see [SECURITY.md](SECURITY.md).
- Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md). The privacy
  invariants come first.
- **Code licence:** [GNU Affero General Public License v3.0 only](LICENSE)
  (`AGPL-3.0-only`). You may use, change and share the code. If you run a
  modified version for other people over a network, you must offer them its
  source under the same licence. Third-party components keep their own
  licences, listed in [NOTICE.md](NOTICE.md).
- **Guides are not open source.** The guide text and guide figures are
  © Simon, all rights reserved, under [LICENSE-CONTENT](LICENSE-CONTENT), not
  the code licence. That covers `src/config/guide-content/`,
  `src/config/pdf-guide.ts` and `public/guides/`. Remove or replace them if you
  publish your own build.
- The name "Private Image to Text", the domain and the logo are not licensed
  for use by modified or redistributed versions.

## Project overview (LocalText)

LocalText is a local-first browser application with four independent
workspaces in the standard build (PDF to text is described in its own section
below). Extract text performs OCR in 12 selectable languages on raster images,
including sequential batches of up to 10 images and 100 MiB total. Hide
message creates the default PNG v1 output or an opt-in JPEG v2 output from a
supported JPEG carrier, and reveals either LocalText format. Media Inspector
reads recognised media signatures, supported image and ISO-container metadata,
privacy clues, checksums and embedded Content Credentials. All three workflows run in the
browser without sending the selected file, text, password or result to a
server.

The OCR, steganography and Media Inspector workspaces do not transfer selected
files or results between routes. A user may manually copy and paste text or
independently select the same file in another route; LocalText does not automate
that hand-off.

LocalText is a static application hosted and delivered in production by
Cloudflare. The application has no file-upload or content-processing backend,
account system, cloud history, custom analytics events or application error
reporting. Production Cloudflare Web Analytics is a separate hosting-layer
measurement service enabled by automatic edge injection, not a script, token or
account identifier embedded in this repository. Local Vite development and
preview remain analytics-free.

## What it does

### Extract text

- paste, drop or choose a PNG, JPEG, WebP or browser-decodable BMP image;
- validate, preview, crop, rotate and reversibly enhance a bounded raster;
- recognise eligible long Adaptive documents sequentially in bounded,
  overlapping native-detail sections;
- select Columns for clear side-by-side text so OCR reads down each column
  before moving to the next;
- choose up to three of 12 OCR languages, with English as the default, using pinned same-origin Tesseract models;
- reject stale results and provide genuine progress and cancellation;
- try three public sample images using the actual OCR engine;
- review source-linked word regions and edit raw or cleaned plain text;
- recognise a selected source region again and review the suggestion;
- retain independent image edits while reordering or processing a bounded queue;
- download edited batch results as combined text or individual UTF-8 files in a ZIP;
- explicitly copy or download a `.txt` result;
- completely clear the OCR workspace.

### Hide or reveal a message

- independently paste, drop or choose a bounded raster carrier;
- parse signatures, dimensions and animation before full decode where possible;
- decode without resizing, cropping, rotating or enhancing the carrier;
- calculate PNG v1 capacity from fully opaque RGB channels or JPEG v2 capacity
  from eligible luminance AC coefficients;
- hide exact UTF-8 text using password protection by default or an explicit
  plain-text mode;
- create and preview a new PNG v1, or opt in to a canonical JPEG v2 for a
  supported JPEG carrier, without modifying the source file;
- explicitly download the encoded PNG or JPEG;
- inspect LocalText v1 PNGs and v2 JPEGs, retry a password, and explicitly copy or download
  revealed plain text;
- terminate workers, revoke object URLs and clear canvases on full cleanup.

### Inspect media metadata

- independently drop or choose one image, video or audio file up to 512 MiB;
- identify supported formats from file signatures rather than trusting only a
  filename or browser-declared media type;
- read bounded slices to parse recognised JPEG, PNG, WebP and GIF image details
  and MP4/MOV/M4A container and track details without whole-video transcoding;
- signature-identify WebM/Matroska and common audio formats while leaving
  unsupported detailed metadata explicitly absent;
- calculate the SHA-256 checksum of the exact selected file in bounded chunks;
- show recognised Exif, XMP, image, container and track metadata where the
  implemented parser supports it;
- flag recognised location, owner, device identifier, timestamp, embedded
  preview, editing-history and generation-data fields for review;
- surface prompt, workflow, model, sampler, seed and related AI metadata only as
  editable, unverified file metadata;
- validate supported Content Credentials embedded in the file while remote
  manifest and certificate-status fetching remain disabled;
- explicitly copy the checksum or download a local JSON inspection report;
- explicitly create and download a separately verified Clean Share Copy for an
  eligible still JPEG or PNG without overwriting the source;
- abort stale inspection and clean-copy work, dispose provenance workers and
  revoke transient source/output/report object URLs on replacement, Clear,
  navigation and teardown.

Source inspection is read-only. Clean Share Copy is a separate explicit action
that removes supported file-level metadata only for its narrow eligible profile.
Neither workflow determines malware or file safety, or issues an AI-generated,
human-made or authenticity verdict.

The application also provides local informational and guide routes and a
versioned, allowlisted service worker. It has no persistent history.

OCR-to-steganography hand-off, binary attachments, message compression,
multiple payloads, camera capture, robust watermarking,
metadata preservation, password recovery, cloud sharing, accounts,
application-managed telemetry and monetisation are outside the current
capability.

## PDF to Text

The standard build includes the PDF workspace,
guide, navigation, sitemap and canonical metadata. This source configuration
does not itself establish that a production deployment has occurred.

- `pnpm run build:pdf-preview` / `pnpm run preview:pdf-preview`: private candidate.
- `pnpm run build` (or `build:pdf-release`): public PDF build.
- `pnpm run preview:pdf-release`: locally inspect the public build.
- `pnpm run test:pdf-release:isolation`: check public, explicitly disabled and private builds.

`VITE_ENABLE_PDF_OCR_PUBLIC` defaults to enabled when the private preview flag is
absent. Set it to `false` at build time for a PDF-disabled rollback build.
`VITE_ENABLE_PDF_OCR_PREVIEW=true` alone still produces a private noindex preview;
explicitly enabling both flags is rejected.

The workspace accepts one PDF up to 25 MiB / 100 document pages, 50 selected
pages and 25 OCR pages per operation. Automatic, existing-text and multilingual OCR
modes, per-page edits and method overrides, cancellation, password handling and
page-marked text export run locally. There is no searchable-PDF output or table
export. Choose up to three of the same 12 languages supported by image OCR. A bounded
local page preview follows the selected result page, with Previous/Next, fit-width
and enlarged views. Edited results remain intact when language settings change;
re-run OCR explicitly to apply the new choice. PDF reader and selected OCR language
support have separate verified offline caches. Previews are never cached.

## Privacy summary

Files and text are processed in this browser. Application code does not upload
selected files, filenames, decoded pixels, parsed metadata, checksums,
inspection reports, Content Credentials, recognised or edited OCR text, hidden
messages, passwords, plaintext, ciphertext, generated PNGs/JPEGs or revealed
text.

Cloudflare separately processes ordinary web-request information needed to host
and deliver the production site. Cloudflare Web Analytics measures aggregate
page use and performance. In production, Cloudflare may automatically inject
`https://static.cloudflareinsights.com/beacon.min.js`, or a versioned copy at a
path beginning `https://static.cloudflareinsights.com/beacon.min.js/`; that
beacon submits page
and performance measurements to the same-origin `/cdn-cgi/rum` endpoint. It is
not used for advertising, session replay, application error reporting or custom
events, and it must not receive selected files, filenames, recognised or edited
text, messages, passwords, metadata, checksums, reports or generated files.

User content may exist transiently in JavaScript, worker, canvas and bitmap
memory, temporary object URLs and, after an explicit action, the
operating-system clipboard or download folder. LocalText does not intentionally
save user content to `localStorage`, `sessionStorage`, IndexedDB, Cache Storage,
cookies, URLs, document metadata or logs. The service worker caches only
versioned application assets, public demonstration images, OCR assets, the
optional JPEG codec and explicitly prepared PDF reader assets; it never
caches user content. Media Inspector's Content Credentials code and WebAssembly
are lazy, same-origin application assets rather than remote services.

Clear, replacement, cancellation, workflow switching, navigation and page
teardown invalidate operation identifiers, terminate the relevant worker,
revoke object URLs, clear canvases and release application references where
practical. Mutable byte buffers are overwritten where possible.

Clear is not secure operating-system memory erasure. JavaScript strings,
browser internals, operating-system swap, clipboard history, downloaded files
and backups remain outside the application's control. Browser extensions and
device software also remain outside the boundary.

See [Privacy architecture](docs/privacy-architecture.md) for the complete flows,
trust boundaries and verification procedure.

## Architecture

LocalText is a plain Vite single-page application:

- React and TypeScript in strict mode;
- React Router for route metadata, announcements and workspace-lifecycle
  separation;
- separate OCR, steganography and Media Inspector workspace state, cleanup and
  operation identifiers;
- Tesseract.js `7.0.0` behind a typed OCR adapter;
- same-origin Tesseract core, worker and
  `@tesseract.js-data/eng` `1.0.0` assets;
- a dependency-free LocalText v1 codec and an isolated libjpeg-turbo/WASM v2
  coefficient codec, both using browser Web Crypto for protection;
- PBKDF2-HMAC-SHA-256 at exactly 600,000 iterations and AES-256-GCM for
  password-protected messages;
- bounded raster header parsing, explicit affine coordinate mappings and native
  canvas/image APIs;
- bounded media signature, image-metadata and container parsing plus incremental
  SHA-256 over the exact selected bytes;
- `@contentauth/c2pa-web` `0.13.4`, loaded only for provenance inspection with a
  same-origin WebAssembly asset and embedded-only network policy;
- transferred pixel buffers and constant-additional-memory affine payload
  traversal;
- a small custom service worker with separate shell, OCR, and optional JPEG
  codec allowlists;
- CSS, locally bundled fonts and same-origin application assets, with the exact
  production Cloudflare Web Analytics beacon as the only documented external
  script exception;
- pnpm and its lockfile for reproducible dependency installation.

There is no application backend, OCR service, cryptography service or storage
service. Vite's development and preview servers serve the local static
application only.

The exact compatibility contracts are documented in
[LocalText steganography format v1](docs/steganography-format-v1.md) and
[LocalText steganography format v2](docs/steganography-format-v2.md). PNG v1
remains the default and is supported indefinitely. JPEG v2 is opt-in, accepts
only its strict profile, and requires the exact generated JPEG; older v1-only
LocalText versions cannot reveal it.

## Routes

- `/` - Extract text OCR tool
- `/hide-message` - independent Hide and Reveal workflows
- `/media-inspector` - independent media metadata, privacy and provenance
  inspector
- `/privacy` - privacy, storage and data flows
- `/how-it-works` - OCR and LocalText v1/v2 processing details
- `/guides` - OCR guide index
- `/guides/screenshot-to-text`
- `/guides/copy-error-message-from-image`
- `/guides/private-ocr-for-sensitive-documents`
- any unknown path - local not-found page

Configured public routes are indexable and use canonical metadata consistent
with `public/sitemap.xml` and the permissive `public/robots.txt`. The local
not-found route remains `noindex, nofollow`.

## Prerequisites

- Node.js 22.22 or newer
- pnpm 11
- a current browser with module Web Workers, Web Crypto, canvas, object URLs and
  service-worker support

The full end-to-end suite is Chromium-focused. Firefox and WebKit smoke projects
cover LocalText v1 interoperability where their browser binaries are installed.
Clipboard behaviour, Web Crypto performance and available memory vary by
browser and operating system.

## Install

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm run prepare:ocr
```

`prepare:ocr` copies the pinned OCR worker and compatible WebAssembly loaders
from installed packages into `public/ocr`, applies the hash-pinned Tesseract
7.0.0 language-code fix, and verifies all 12 vendored fast models against
`src/config/ocr-languages.json`. It checks compressed and original SHA-256
hashes without downloading anything. Normal page use never invokes this setup step.

## Run locally

```powershell
.\start-local.ps1
```

Open <http://127.0.0.1:5173/>. The launcher builds the current source and
serves that static build on the IPv4 loopback interface. It does not deploy or
publish anything. Keep the PowerShell window open while using LocalText.

For source development with hot-module replacement, run `pnpm dev` instead.
The development server uses a development-only CSP allowance for Vite's inline
React Refresh bootstrap. The built local launcher retains the stricter
production CSP and enables the offline service worker.

Do not add `--host 0.0.0.0` or another LAN-facing host unless you deliberately
accept the exposure.

## Build and production preview

```powershell
pnpm build
pnpm preview
```

Open <http://127.0.0.1:4173/>. Use this production preview for service-worker,
offline, network-boundary and real-OCR verification.

`pnpm build` produces static browser assets. It does not deploy or publish
them.

## Verification commands

```powershell
pnpm run typecheck
pnpm run lint
pnpm run test:unit
pnpm run test:rendered
pnpm run test:e2e
pnpm run test:ocr-geometry
pnpm run build
pnpm run verify
pnpm audit --prod
```

The intended suites cover raster and media parsing, exact-file hashing, privacy
classification, embedded-only provenance settings, immutable LocalText v1 and
v2 vectors, exact envelope and embedding behaviour, pinned WASM integration,
Web Crypto round trips, reducers, worker protocol, component lifecycle, real
OCR, same-origin requests, storage and cache exclusions, enforced CSP,
accessibility, responsive layouts, offline operation and cross-browser codec
smoke checks. The dedicated OCR geometry benchmark uses only checked-in
synthetic anchors and the real same-origin local assets; its coordinate contract
is documented in [OCR word geometry](docs/ocr-word-geometry.md). The real-browser
accuracy benchmark also records the bounded Columns-mode A/B described in
[OCR multi-column layout](docs/ocr-layout-recognition.md).

Browser installation for a new development machine is:

```powershell
pnpm exec playwright install chromium firefox webkit
```

These are commands to run; this document does not assert that a particular
working tree or environment has passed them. Report unavailable browser
binaries precisely and review audit findings rather than applying breaking
force fixes.

## Test offline operation

Use a production preview, not the development server.

### Hide message without OCR

1. Run `pnpm build` and `pnpm preview`.
2. In a fresh browser context, open
   <http://127.0.0.1:4173/hide-message> online.
3. Wait for **Offline app ready** and confirm no `/ocr/` request occurred.
4. Switch the browser context offline and directly reload `/hide-message`.
5. Encode a password-protected PNG v1 message, retain or download the new PNG, clear
   the workspace, reopen the PNG and reveal the exact message.
6. Confirm no content-derived request occurred and Cache Storage contains only
   canonical allowlisted application assets.

### Prepare and test JPEG v2 offline

1. Stay online in `/hide-message`, select a supported JPEG, then explicitly
   select **JPEG v2**. The separate codec cache validates the exact WASM MIME,
   byte length, and SHA-256 before reporting ready.
2. Go offline and reload `/hide-message`.
3. Hide and reveal plain and encrypted messages using the exact generated JPEG.
4. Confirm no network request is attempted and Cache Storage contains the one
   allowlisted `/steg/jpeg-v2-codec.wasm` asset, never source/output JPEGs or
   messages. An uncached offline codec reports unavailable and leaves PNG v1 as
   an explicit alternative; it never silently changes formats.

### Extract text offline

1. Return online and open <http://127.0.0.1:4173/>.
2. Choose up to three image OCR languages and run OCR or use Prepare offline OCR.
3. Wait for the offline status to list every selected language.
4. Go offline, reload `/`, select a local fixture and run OCR again.
5. Inspect caches and confirm they contain only versioned shell and OCR asset
   requests, never filenames, blob URLs, images, text, messages, passwords or
   generated files.

### Prepare and test Media Inspector offline

1. Return online and open <http://127.0.0.1:4173/media-inspector>.
2. Select a supported local fixture once. Core parsing and hashing use bundled
   application code; the Content Credentials check lazily reads its versioned
   JavaScript and WebAssembly assets from the same origin.
3. Wait for the provenance check to finish, then switch the browser context
   offline and directly reload `/media-inspector`.
4. Reinspect the fixture and confirm ordinary metadata and the exact-file
   checksum remain available. The Content Credentials result is available
   offline only when its lazy application assets were cached successfully.
5. Confirm no remote manifest or certificate-status request occurs and Cache
   Storage contains only versioned application assets, never selected media,
   filenames, parsed metadata, checksums, object URLs or inspection reports.

Turning off the local preview server is a stronger optional check after the
required assets have been cached. Turn the network back on before continuing
development.

## OCR asset provenance

Runtime OCR assets come from pinned packages in `pnpm-lock.yaml`:

| Asset | Package and version | Local runtime location |
| --- | --- | --- |
| Browser worker | `tesseract.js` `7.0.0` | `public/ocr/worker.min.js` |
| Compatible LSTM core loaders and WebAssembly | `tesseract.js-core` `7.0.0` | `public/ocr/core/` |
| 12 fast language models | Pinned `tessdata_fast` revision and SHA-256 in `src/config/ocr-languages.json` | `public/ocr/lang/<code>/<hash>.traineddata.gz` |

The deterministic copy script and checksum manifest are
`scripts/copy-ocr-assets.mjs` and `scripts/ocr-assets.manifest.json`.
Tesseract is configured with same-origin `workerPath`, `corePath` and
`langPath` values; its default CDN paths are not used.

Licences and source references are recorded in [NOTICE.md](NOTICE.md).

## JPEG v2 codec provenance

JPEG v2 uses libjpeg-turbo 3.1.4.1 compiled as a single-threaded worker-only
WebAssembly module with Emscripten 6.0.4. The official source archive, full
licence, reviewed C wrapper, pinned container digest, build flags, asset sizes,
and SHA-256 values are recorded in
`scripts/jpeg-v2-assets.manifest.json` and `native/jpeg-v2/vendor/README.md`.
Normal builds only verify checked-in assets and never run Docker, download, or
compile the codec. `scripts/build-jpeg-v2-codec.ps1` performs two clean,
network-disabled builds and rejects non-identical output.

## Media Inspector parser and provenance assets

Media structure, recognised metadata, privacy classification and incremental
SHA-256 are implemented in local TypeScript and browser APIs. The parser reads
bounded `Blob` slices; it does not upload or transcode the selected file.

Content Credentials use the pinned `@contentauth/c2pa-web` `0.13.4` package and
its `@contentauth/c2pa-wasm` `0.11.2` dependency. Vite emits the WebAssembly as a
content-hashed same-origin application asset. The package and asset are loaded
lazily only after ordinary inspection succeeds. A temporary browser worker
performs C2PA reading and is disposed when the check finishes or the workspace
is invalidated.

The adapter enables verification but disables remote-manifest, OCSP and
network-resolved identity checks at both SDK and reader creation. It also
supplies an empty network-host list and does not download an external trust list
or bundle custom trust anchors. Consequently, an embedded credential can be
reported as trusted, valid but not trusted, invalid or unknown only according to
the local SDK result. A missing or unsupported credential leaves origin unknown.

## Browser support

LocalText targets current desktop Chromium-based browsers, Firefox and Safari
that provide the required standard APIs. The interface is responsive for
phones and tablets, but OCR, PBKDF2, PNG encoding, JPEG coefficient processing and maximum-image performance
depend on device memory and CPU.

Important differences:

- a browser may require a secure context or permission for scripted clipboard
  access;
- direct keyboard paste may work when clipboard-button access is unavailable;
- clipboard history or synchronisation may retain copied content;
- PBKDF2 intentionally performs 600,000 iterations and exposes only an
  indeterminate progress stage;
- browser PNG encoders may produce different compressed bytes for equivalent
  decoded rasters;
- first OCR use is slower because its worker, core and selected models are a
  separate preparation step;
- the first supported Media Inspector provenance check may be slower because
  its same-origin C2PA JavaScript and WebAssembly are loaded lazily before the
  SDK creates its blob-backed worker;
- compressed PNG text inspection depends on the browser's
  `DecompressionStream` support; a missing API produces an explicit metadata
  note rather than a fabricated value;
- service workers and installability are tested only in a production build.

File selection and drag-and-drop remain available when clipboard access is
not.

## Known limitations

### Extract text

- Printed text in the 12 bundled languages only; there is no language
  auto-detection.
- Raster images only; SVG input is rejected, and PDFs use the separate PDF to
  text route.
- Up to 10 images and 100 MiB per batch, recognised one at a time.
- Rectangular crop and 90-degree rotation only; no perspective correction.
- Recognition quality depends on resolution, contrast, focus, typeface and
  layout.
- Handwriting, tables, irregular or densely packed columns, decorative text and
  code punctuation can require substantial correction. Columns mode uses the
  bounded prepared preview rather than native-detail tiling.
- The first OCR run may be slower and selected models increase cache size.

### Hide or reveal a message

- LocalText supports only its documented `LTSG` PNG v1 and strict JPEG v2 formats.
- Messages are UTF-8 text, one payload at a time, with a 1 MiB message limit.
- Password protection encrypts the message; plain mode only conceals it.
- Lost passwords cannot be recovered.
- Steganography does not guarantee undetectability, anonymity or deniability.
- PNG v1 remains the default and supported indefinitely. JPEG v2 is opt-in and
  only accepts its documented grayscale/YCbCr profile. Rejected browser-decodable
  JPEGs can still use PNG v1 when the user explicitly chooses it.
- A v2 message is recoverable from the exact generated JPEG. Editing, resizing,
  pixel-domain decoding and re-encoding, screenshots, or quality recompression
  are unsupported and may destroy it. Version 2 is not a robust watermark.
- Output is a newly encoded PNG or canonical JPEG. JPEG v2 strips source
  metadata and reconstructs only a valid orientation value when required.
- Password protection encrypts message content; it does not make JPEG
  coefficient changes undetectable or resistant to steganalysis.
- Old v1-only LocalText versions cannot reveal v2. New versions continue to
  reveal v1 and never automatically convert a v1 PNG to JPEG.
- Clear cannot securely erase JavaScript strings, operating-system memory,
  clipboard history or downloaded files.

### Media Inspector

- One local file at a time, with a 512 MiB route limit.
- Clean Share Copy has separate 32 MiB limits for the source and generated
  output, requires at most 8,192 pixels per side and 36 megapixels, uses 1 MiB
  reads, and bounds JPEG-marker/PNG-chunk traversal. Browser-managed and
  JavaScript heap use is not represented as a fixed memory ceiling.
- Format detection and available fields vary by supported signature and parser;
  a browser preview or familiar extension does not imply complete metadata
  support.
- MP4/MOV/M4A inspection reads bounded container data and does not decode every
  frame or transcode media. WebM/Matroska and non-M4A audio currently receive
  signature, declared-type and checksum inspection rather than full metadata
  parsing.
- SHA-256 identifies the exact selected bytes. It is not a malware, safety,
  authorship or authenticity check.
- Exif, XMP, comments, prompts, software names and other ordinary metadata can be
  edited, forged or removed. Finding none does not establish that a file is
  private or human-made.
- Content Credentials inspection is embedded-only. Remote manifests, online
  certificate status and external trust-list updates are not fetched.
- A credential may contain signed claims, including a digital source type, but
  validation does not establish that every claim or depicted event is true.
- After inspection and the embedded-only provenance check finish, eligible
  non-animated JPEG and PNG files can create a separate Clean Share Copy. The
  source is never overwritten and the new file is never downloaded
  automatically.
- Clean Share Copy uses a narrow lossless structural rewrite. It accepts only
  the orientation and colour cases it can preserve, performs a fresh
  embedded-only source credential check at action time, reinspects the generated
  file, verifies its exact checksum, reports removed and remaining recognised
  metadata plus preserved rendering structure, and requires no embedded Content
  Credential to remain before Preview or Download becomes available.
- "Clean" means supported file-level metadata was removed and the remaining
  structural metadata was verified. It does not visually redact the image,
  detect malware, remove steganography, watermarks or visual fingerprints,
  provide anonymity, securely delete the source, or remove operating-system and
  downloaded copies.

No workspace has local or cloud history. Closing, reloading or
clearing the page discards the active workspace unless the user explicitly
exported a result. Local-only security headers do not substitute for a hosted
deployment review.

## Add another language pack

Language expansion is a deliberate code and release change:

1. Check download size and accuracy before adding Chinese, Japanese or Korean
   (CJK) models, which are much larger.
2. Select compatible fast data from a pinned upstream commit and retain its licence.
3. Gzip the original deterministically and vendor it under `public/ocr/lang/<code>/<hash>.traineddata.gz`.
4. Add the source URL, code, label, script, byte sizes and both SHA-256 hashes to `src/config/ocr-languages.json`.
5. Keep each compressed model within 5 MB. The picker, build verifier, technical page and service-worker allowlist derive from this manifest.
6. Add script fixtures and real-OCR, offline, corruption and same-origin tests. Never imply automatic language detection.
7. Update `NOTICE.md` and review memory, accuracy and download costs.

Do not configure Tesseract to fetch a missing language from a CDN.

## Development rules

- Keep the server bound to `127.0.0.1`.
- Keep route indexability, canonical metadata, `robots.txt` and the sitemap in
  agreement; keep the local not-found route out of the index.
- Do not introduce remote fonts, images, workers or language packs, or manually
  embed remote scripts. The only documented production script exception is the
  exact Cloudflare Web Analytics beacon injected automatically at the edge.
- Do not add application-managed analytics, custom analytics events, telemetry
  or error reporting.
- Do not persist user images, messages, passwords, payloads or results.
- Keep user-derived text as plain text; never render it as HTML or Markdown.
- Reject SVG and guard decoded dimensions, arithmetic and canvas allocations.
- Keep OCR integration behind its adapter and steganography behind its separate
  worker protocol and codec.
- Never connect or transfer selected files or results between the three
  sensitive workspaces.
- Validate object URL, bitmap, canvas, transferred-buffer and worker cleanup for
  replacement, cancellation, Clear, navigation, unmount and `pagehide`.
- Preserve the restrictive production CSP and run E2E with CSP enforcement.
- Do not add an upload endpoint or deployment configuration "for later".

## Related documentation

- [LocalText steganography format v1](docs/steganography-format-v1.md)
- [LocalText steganography format v2](docs/steganography-format-v2.md)
- [Privacy architecture](docs/privacy-architecture.md)
- [OCR word geometry](docs/ocr-word-geometry.md)
- [OCR multi-column layout](docs/ocr-layout-recognition.md)
- [Third-party notices](NOTICE.md)
