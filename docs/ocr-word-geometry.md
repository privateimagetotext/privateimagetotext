# OCR word-coordinate contract

This document defines the word geometry produced by Private Image to Text and
its use by the image OCR source-review interface. Geometry is optional at the
runner boundary. The current image tool enables it for single-image and batch
recognition, retains it with the in-memory result, and uses it to link recognised
words to their source image. The coordinate benchmark and its original baseline
are documented separately below.

## Coordinate spaces

All spaces use a top-left origin and pixel-edge coordinates. An untransformed
rectangle stores its left/top edges and its right/bottom edges, with the right
and bottom treated as exclusive. Original raster and canvas boundaries are
integers. Affine results retain full floating-point precision and are not
rounded for storage or reports.

1. **Source image** — original decoded-image pixel edges before crop or manual
   rotation.
2. **Oriented page** — the exact integer source crop after manual 0, 90, 180
   or 270 degree rotation.
3. **Prepared section** — bounded preview or native-section canvas pixels
   before the OCR engine's fine rotation.
4. **Engine section** — Tesseract coordinates after its same-size fine
   rotation.

The forward chain is:

```text
source image
  -- sourceToOriented --> oriented page
  -- orientedToPrepared --> prepared section
  -- preparedToEngine --> engine section
```

Mapping a recognised word back to the source uses the exact stored inverses in
the opposite order:

```text
engineToPrepared -> preparedToOriented -> orientedToSource
```

The source crop contains the exact rounded and clamped integer edges actually
rendered. Preview transforms use independent
`preparedWidth / orientedWidth` and `preparedHeight / orientedHeight` ratios;
the nominal scale is never used to reconstruct geometry. Native sections use
their exact input rectangle. Fine rotation uses Tesseract's returned
`rotateRadians` as the prepared-to-engine Canvas-sign rotation about
`(preparedWidth / 2, preparedHeight / 2)` in the same-size section.

## Word records

Adapter word records are explicitly local to one engine section. They contain
only text, finite confidence when available, the engine rectangle and its
Tesseract block/paragraph/line/word indices.

When `runRecognition` is called with `includeWordGeometry: true`, each engine
rectangle becomes a four-corner polygon. The polygon is mapped sequentially
into prepared-section, oriented-page and source-image space. Every named space
retains both the polygon and its derived axis-aligned envelope. Envelopes are
useful for comparisons but never replace the transformed quadrilateral.

Invalid non-finite, unordered or singular geometry fails the optional mapping
instead of being rounded or silently accepted.

## Native-section ownership

Native tiling remains restricted to Document plus Adaptive document and keeps
the existing 256-pixel overlap, canvas budgets, single-block section layout and
half-open line-core ownership.

Words use their Tesseract hierarchy to follow the already-owned line
observation. All words from a non-owning overlap copy are excluded. Words from
the owning observation keep engine traversal order within that line. No text
matching is used, so identical words at distinct source locations remain
separate.

## Source review and result views

`ToolPage` requests `includeWordGeometry: true` for single-image and batch runs
and stores the returned words in `OcrResult.words`. When that array contains
words, **Review words against the image** opens a review panel. Words are
buttons; selecting one shows a local source-image preview with an SVG rectangle
drawn from its axis-aligned `sourceImage.envelope`. The preview does not draw
the stored transformed polygon or overlay every word at once. The list initially
shows up to 100 words, with **Show next 100 words** for longer results.

**Show uncertain words only** filters for a non-null confidence below
`UNCERTAIN_WORD_CONFIDENCE` (currently 80). A missing confidence score is not
treated as a low score. Tesseract confidence is an engine estimate, not a
calibrated probability of correctness or a measured error rate; important text
still needs review when no words fall below the threshold.

**Original OCR**, **Tidied** and **Markdown** are generated, read-only views.
**Your edits** starts as a separate copy of Tidied. **Edit this version** copies
the selected generated view into Your edits, replacing that editable copy.
Neither direct editing nor a source-linked correction rewrites a generated
view, the original word geometry or its confidence.

**Apply correction** updates only Your edits. `locateReviewWord` requires one
whole-token match with the recognised neighbouring context. If previous edits,
tidying or repeated text make the match absent or ambiguous, the panel disables
that action and asks for a direct edit. It does not guess which occurrence to
replace.

**Rerun selected region** makes an explicit local OCR call for the selected
word's source envelope with padding of at least four source pixels (or one
quarter of its height). It uses the current language selection, rotation and
enhancement, and Single line recognition. The trimmed response becomes a
suggestion in the correction field; applying it remains a separate action.
The rerun does not replace the original result, word geometry or confidence,
and its small crop may omit context or yield a worse result. Cancellation or an
unavailable result leaves manual correction available.

## Local-only lifecycle

Source files, text and word geometry remain in page memory, including retained
batch results. Word text, confidence labels and the selected envelope are used
in the review DOM; this workflow does not upload them, log them, or persist them
in browser storage or offline caches. The runner uses the same operation,
cancellation and stale-response checks as text recognition. Replacement, Clear,
navigation and pagehide release the active work; cancelling a region rerun
retains the existing result and edits.

Tesseract's worker, core and pinned language models are served from the same
origin. The current model selection is defined in
`src/config/ocr-languages.json` (`tessdata_fast`), rather than the older English
best-int model used for the original baseline below. The geometry benchmark
blocks any external HTTP(S) origin and fails if the page opens a WebSocket to a
different host.

## Synthetic browser benchmark

Run the dedicated benchmark with:

```powershell
pnpm run test:ocr-geometry
```

The checked-in corpus under `e2e/fixtures/ocr-geometry/` is generated entirely
from synthetic anchor text. It covers all manual quarter turns, portrait and
landscape sources, odd non-full crop edges, independent rounded preview scales,
adaptive enlargement, preview reduction, positive and negative 3 degree skew,
all four source corners, the centre, native section seams, overlap visibility
and legitimate repeated tokens.

The historical untouched-production baseline at Git HEAD
`5490d1ac67e77d4ec96722ca02239b3f910348f0` matched all 36 critical anchors.
Its maximum centre error was 0.666 source pixels, maximum normalised centre
error was 0.014 expected word heights, and minimum envelope IoU was 0.959.
Before runner plumbing was changed, the benchmark gates were fixed at:

- maximum 2 source pixels centre error;
- maximum 0.05 expected word heights normalised centre error;
- minimum 0.90 axis-aligned envelope IoU;
- every critical anchor matched;
- no duplicate anchor or reading-order error; and
- maximum affine round-trip error of `1e-8` pixels.

JSON and Markdown reports are attached through Playwright and written under the
ignored `tmp/ocr-geometry-reports/` directory. Reports include Git and dirty
source fingerprints, browser/version, manifest and fixture hashes, production
module and OCR-asset hashes, recognition options, exact matrices, section
rectangles, deskew request/response and runtime.
