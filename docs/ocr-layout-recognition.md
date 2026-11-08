# OCR multi-column layout contract

Private Image to Text provides an explicit **Columns** content type for clear,
side-by-side printed text. It is a reading-order mode: text should finish the
left column before continuing at the top of the next column. The optional
Markdown view separates clearly recognised columns;
it does not infer tables.

## Measured defect and controlled change

Current-build Document controls preserve the demonstrated pre-slice behaviour
on three checked-in synthetic layouts. Recognition finds every critical
anchor, but interleaves same-height rows from the left and right columns.
Whitespace-normalised CER was 47.37% for the ruled layout, 59.86% without a
divider and 47.88% with a full-width heading. WER was 51.43%, 68.09% and
51.43%.

The benchmark isolates one engine contract on otherwise identical prepared
images:

- Document retains the established numeric page-segmentation value `3`;
- Columns passes Tesseract.js's typed automatic-layout value `"3"`;
- both use one recognition call, thresholding method `0`, 300 DPI and no fine
  rotation for these Original-preset fixtures.

This distinction is deliberately local to Columns. Changing the parameter
encoding for every existing mode altered difficult Document output and
regressed the punctuation fixture during the bounded experiment.

Tesseract.js cannot restore the established numeric bridge after a typed page
segmentation value has been set on the same worker. The adapter therefore
recycles that worker only when returning from Columns or another typed layout
run to a legacy numeric mode. A same-page Document → Columns → Document browser
gate requires the final Document output to equal the initial output exactly.
Repeated typed runs keep using the same worker. Cancellation during a recycle
cannot start a replacement worker.

## Synthetic browser coverage

`e2e/fixtures/ocr-corpus/manifest.json` declares three synthetic layouts:

- equal columns separated by a visible rule;
- equal columns with whitespace only;
- a full-width heading followed by two columns.

Every layout uses unique ASCII anchors in declared reading order. The real
same-origin worker, core and installed English best-int model run in Chromium.
The benchmark records source hashes, application asset hashes, Git HEAD, a
dirty-worktree fingerprint, browser version, exact recognition parameters,
strategy, section count, runtime, observed text, CER, WER and anchor results.
It attaches JSON and Markdown reports and rejects external requests.

Current gates require all three layouts to remain single-canvas, retain every
critical token exactly once and in order, and keep raw and Tidied whitespace-
normalised CER at or below 0.5% and WER at or below 1%.

Run the complete OCR benchmark with:

```powershell
pnpm run test:ocr-benchmark
```

Reports are written below `tmp/ocr-benchmark-reports/`, which is not a
production asset or user-data store.

## Deliberate limits

Columns uses the existing bounded prepared preview. It is not eligible for the
native vertical tiler because independent vertical sections would be assembled
in tile order, not guaranteed whole-column order. Existing Document and
Adaptive document native eligibility, 256-pixel overlap, half-open line
ownership and single-block section recognition are unchanged.

Irregular regions, narrow or dense gutters, more than two columns, floating
figures, tables and long pages with text too small for the bounded preview may
still need correction. Supporting those cases requires a separately measured
region/column-sectioning design; this slice adds no multi-pass OCR, candidates,
word highlighting or production word-box overlay.

That statement records the original Columns slice. The current image tool also
provides selected-word source highlighting, corrections and explicit region
rerun suggestions, as documented in [OCR word geometry](ocr-word-geometry.md).
These review controls do not remove the layout limits above.

No recognised text, word data or layout result is logged or persisted by the
production application.
