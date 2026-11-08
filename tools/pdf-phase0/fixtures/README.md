# PDF OCR Phase 0 fixtures

All fixtures are deterministic, synthetic and generated locally by
`tools/pdf-phase0/scripts/generate-fixtures.mjs`. Generated PDFs are written to
the ignored `tmp/pdf-phase0/fixtures/` directory; no selected document or test
password is committed or placed in the public application.

The generator uses the exact development dependency `pdfkit@0.19.1` (MIT) and
Node's built-in PNG compression. It creates:

- `selectable.pdf`: two pages of selectable text, including a Unicode sentinel;
- `scanned.pdf`: one image-only letter page with a synthetic bitmap-font sentinel;
- `mixed.pdf`: one selectable page followed by one image-only page;
- `password.pdf`: a deterministic PDF 1.3/RC4 selectable-text fixture with the
  test-only user password `phase0-only` (weak encryption by design for test
  reproducibility, never a production recommendation);
- `embedded-font.pdf`: an embedded, subsetted Type0 font with an internal
  ToUnicode CMap and Cyrillic text;
- `cmap-font.pdf`: a byte-level synthetic Japanese CID-font PDF using
  `90ms-RKSJ-H`; it forces the pinned same-origin Adobe CMap path and also uses
  unembedded Helvetica to exercise standard-font support;
- `rotated.pdf`: an image-only page with an inherent 90-degree page rotation;
- `benchmark-{1,10,25}.pdf`: generated repeated image-only pages for sequential
  OCR measurements;
- `benchmark-26.pdf`: generated image-only pages used to prove the 25-page OCR
  limit fails during preflight, before rendering or OCR begins.

The bitmap raster is generated without platform fonts, so its bytes remain
stable across hosts. The font fixture embeds PDF.js's pinned Liberation Sans
TTF support asset. The byte-level fixture uses the PDF.js package's Adobe CMaps
and standard-font substitutes. No upstream or personal PDF is used.

Regenerate all fixtures with:

```powershell
pnpm run prepare:pdf-phase0
```

The preparation command also copies the pinned PDF.js support directories and
the existing verified OCR runtime into ignored harness-only storage.

## Phase 1A decoder fixtures

Three small, genuine decoder fixtures are vendored as base64 source artifacts
under `fixtures/upstream/` and decoded only into the ignored test directory.
They are unmodified files from the official Mozilla PDF.js repository at exact
commit `0365cbde028bd92e58f2dab1bb70cd30ac7acfd7` (the `v6.2.108` release).
The upstream repository and these test fixtures are Apache-2.0 licensed. The
root `NOTICE.md` records the dependency licence; no personal or sensitive PDF
content is present.

| Decoder | Upstream path | Bytes | SHA-256 | Expected proof |
|---|---|---:|---|---|
| ICC/qcms | `test/pdfs/function_based_shading_cmyk.pdf` | 3,266 | `c624d33b595af80746dd96f6440d335a30b1bee3e484d9b0b2cfb0cd54c62be3` | `wasm/qcms_bg.wasm` and `iccs/CGATS001Compat-v2-micro.icc` |
| JPX/OpenJPEG | `test/pdfs/jpx_smaskindata.pdf` | 2,515 | `a82813559c74f074b0caf92c80875fc018acb737269a2af5508c7e083b2a5fd3` | `wasm/openjpeg.wasm`, with no JavaScript fallback |
| JBIG2 | `test/pdfs/jbig2_file_header.pdf` | 774 | `5edb6045fc86ee5fa8e837685a35a57014764d1f72518e136e5e8f13fcf92c8d` | `wasm/jbig2.wasm`, with no JavaScript fallback |

The browser tests open and render each fixture through the production adapter;
merely opening the document is not accepted as decoder proof. They assert the
exact same-origin versioned resource request and repeat rendering from the
explicitly prepared PDF service-worker cache while offline. Fixture bytes are
verified before decoding and are never downloaded during a build or test.
