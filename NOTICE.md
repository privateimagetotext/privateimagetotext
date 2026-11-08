# Third-party notices

LocalText includes the following third-party software and assets in its local
browser build. This notice records the packages intentionally used at runtime;
the lockfile contains the complete dependency graph.

Licence identifiers below are taken from the installed package metadata and,
for the trained data, its upstream repository. Where a package
supplies a full licence or generated third-party notice, the deterministic
asset step preserves it with the local OCR assets. The referenced licence
texts and notices must remain available in any future distribution.

## libjpeg-turbo 3.1.4.1 and Emscripten 6.0.4

- Component: strict JPEG parsing, quantised-coefficient access, canonical JPEG
  writing, and release-and-reopen verification for opt-in LocalText v2
- Source: <https://github.com/libjpeg-turbo/libjpeg-turbo/releases/tag/3.1.4.1>
- Official archive SHA-256: `ecae8008e2cc9ade2f2c1bb9d5e6d4fb73e7c433866a056bd82980741571a022`
- Licences: IJG licence, modified 3-clause BSD, and zlib licence as applicable
- Full text: `native/jpeg-v2/vendor/LICENSE.md` and
  `public/steg/libjpeg-turbo-LICENSE.md`
- Build toolchain: Emscripten 6.0.4
- Pinned image: `emscripten/emsdk@sha256:3a0d11e50f072dc2c4bc92e3b05ab1340fb7d4dd152f80b8af35fc1c6f15e644`
- Runtime assets: bundled worker module and `public/steg/jpeg-v2-codec.wasm`
- WASM SHA-256: `1c8326b7278e5f0afa003a9bf95ffe280f2e733160d1458f0be54f9cb9c1968a`

The codec is built from the vendored official archive through two clean,
network-disabled container builds. It is loaded only from the same-origin
`/steg/` path; no CDN or runtime compilation is used. Exact generated asset and
wrapper hashes, sizes, exported functions, and flags are recorded in
`scripts/jpeg-v2-assets.manifest.json`.

## Tesseract.js 7.0.0

- Component: browser OCR orchestration and worker
- Package: `tesseract.js`
- Licence: Apache License 2.0
- Source: <https://github.com/naptha/tesseract.js>
- Local asset: `public/ocr/worker.min.js`

Copyright and contributor information is retained in the upstream package and
its `LICENSE.md` file. LocalText uses a pinned package copy and does not load
the worker from a CDN.

LocalText modifies the worker's language-object initialiser to use `Lang.code`
instead of `Lang.data` (2026-09-17). The deterministic patch and original/output
hashes are recorded in `scripts/copy-ocr-assets.mjs` and the OCR asset manifest.

## Tesseract.js Core 7.0.0

- Component: Emscripten JavaScript loaders and WebAssembly OCR core
- Package: `tesseract.js-core`
- Licence: Apache License 2.0
- Source: <https://github.com/naptha/tesseract.js-core>
- Local assets: `public/ocr/core/`

The compatible core is supplied through Tesseract.js and copied locally for
same-origin runtime use.

The deterministic asset-copy step preserves the Apache License 2.0 text as
`public/ocr/TESSERACT-CORE-LICENSE.txt`. It is also available from
<https://www.apache.org/licenses/LICENSE-2.0>.

## Tesseract fast language data

- Component: 12 offline integer LSTM recognition models
- Source: https://github.com/tesseract-ocr/tessdata_fast
- Revision: `87416418657359cb625c412a48b6e1d6d41c29bd`
- Licence: Apache License 2.0, included in `public/ocr/TESSDATA-LICENSE.txt`
- Assets, compressed and original hashes, sizes and source URLs: `src/config/ocr-languages.json`

Models are vendored as deterministic level-9 gzip files. Builds verify them without contacting upstream. Browser requests use only this site's origin; selected language data is verified before loading. The Filipino (`fil`) model is presented as Tagalog (Filipino).

## Content Authenticity Initiative C2PA Web 0.13.4

- Component: embedded Content Credentials parsing and validation in Media
  Inspector
- Packages: `@contentauth/c2pa-web` 0.13.4 and bundled
  `@contentauth/c2pa-wasm` 0.11.2
- Licence: MIT
- Copyright: Copyright 2025 Adobe. All rights reserved.
- Source: <https://github.com/contentauth/c2pa-js>
- Local runtime asset: Vite-built same-origin WebAssembly under `/assets/`
- Full text: `public/c2pa/LICENSE.txt`

The verifier is loaded lazily from the same origin. The application adapter
disables remote-manifest and certificate-status fetching so a selected media
file is not sent to a provenance service.

## Manrope 5.3.0

- Component: primary interface typeface
- Package: `@fontsource-variable/manrope`
- Typeface copyright: Copyright 2019 The Manrope Project Authors
- Licence: SIL Open Font License 1.1
- Source: <https://github.com/sharanda/manrope>
- Packaging source: <https://fontsource.org/fonts/manrope>

Font files are bundled locally. No request is made to Google Fonts or another
font CDN.

## IBM Plex Mono 5.3.0

- Component: OCR samples, technical labels and monospaced output presentation
- Package: `@fontsource/ibm-plex-mono`
- Typeface copyright: Copyright 2017 IBM Corp. All rights reserved.
- Licence: SIL Open Font License 1.1
- Source: <https://github.com/IBM/plex>
- Packaging source: <https://fontsource.org/fonts/ibm-plex-mono>

Font files are bundled locally. No request is made to Google Fonts or another
font CDN.

## Mozilla PDF.js 6.2.108

- Component: browser-local PDF text extraction and bounded page rendering in
  PDF to Text; standard builds enable the workspace. Preview and explicitly
  disabled builds remain available.
- Package: `pdfjs-dist`
- Licence: Apache License 2.0
- Source: <https://github.com/mozilla/pdf.js/releases/tag/v6.2.108>
- Package build: `0365cbde0`
- Browser entry: `build/pdf.mjs`
- Dedicated worker entry: `build/pdf.worker.min.mjs`

The exact package is pinned. The implemented PDF workspace dynamically imports
the API from `/pdf/6.2.108/api/` when a PDF is selected and starts an explicit
same-origin module worker from `/pdf/6.2.108/worker/`. The isolated test harness
also exercises the package. Separate build flags expose a private noindex
preview or an explicitly selected public candidate; neither changes the default
standard build, which has no PDF workspace route. Implementation and local
candidate testing are not a public-release approval or deployment claim.

The build contains an exact, checksummed, same-origin runtime asset set. Its
dedicated offline cache is prepared only after an explicit PDF-specific request;
selected documents, passwords and extracted text are not part of that asset set.

PDF.js support directories carry additional licence notices that accompany the
generated runtime: `cmaps/LICENSE` (Adobe CMaps),
`standard_fonts/LICENSE_FOXIT`, `standard_fonts/LICENSE_LIBERATION`,
`iccs/LICENSE`, and the `wasm/LICENSE_*` files. The deterministic
`scripts/pdf-assets.manifest.json` inventory preserves each applicable notice,
byte length and SHA-256 under the versioned same-origin runtime root.

The three decoder compatibility fixtures are unmodified official Mozilla
PDF.js test-corpus files from commit
`0365cbde028bd92e58f2dab1bb70cd30ac7acfd7` (`v6.2.108`) and retain the
repository's Apache-2.0 licensing. Their exact paths and hashes are recorded in
`tools/pdf-phase0/fixtures/README.md`.

## Licence preservation

If LocalText is packaged or distributed outside this local development
repository:

1. preserve this notice;
2. include the full Apache 2.0, MIT and SIL Open Font License 1.1 texts;
3. retain copyright, attribution and modification notices required by those
   licences;
4. re-generate the dependency and asset inventory from the shipped build;
5. verify that every copied OCR and font asset is represented;
6. review any new language pack or runtime dependency before distribution.

This file is an engineering inventory, not legal advice.
