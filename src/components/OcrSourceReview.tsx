import { useMemo, useState } from "react";
import type { ImageSource, OcrResult, RecognitionWordGeometry } from "../features/ocr/types";
import { locateReviewWord, UNCERTAIN_WORD_CONFIDENCE } from "../features/ocr/review";

type Props = {
  image: ImageSource;
  result: OcrResult;
  disabled: boolean;
  onCorrect: (start: number, end: number, replacement: string) => void;
  onRerun: (word: RecognitionWordGeometry) => Promise<string | null>;
};

export function OcrSourceReview({ image, result, disabled, onCorrect, onRerun }: Props) {
  const words = result.words ?? [];
  const [onlyUncertain, setOnlyUncertain] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [replacement, setReplacement] = useState("");
  const [corrections, setCorrections] = useState<Record<number, string>>({});
  const [limit, setLimit] = useState(100);
  const [rerunning, setRerunning] = useState(false);
  const [notice, setNotice] = useState("");
  const uncertain = words.filter((word) => word.confidence !== null && word.confidence < UNCERTAIN_WORD_CONFIDENCE).length;
  const visibleWords = useMemo(() => words.map((word, index) => ({ word, index })).filter(({ word }) =>
    !onlyUncertain || (word.confidence !== null && word.confidence < UNCERTAIN_WORD_CONFIDENCE)), [words, onlyUncertain]);
  const word = selected === null ? undefined : words[selected];
  const bounds = word?.sourceImage.envelope;
  const context = bounds ? {
    x: Math.max(0, bounds.x - Math.max(bounds.width, image.width * 0.08)),
    y: Math.max(0, bounds.y - bounds.height * 2),
    width: Math.min(image.width, Math.max(bounds.width * 3, image.width * 0.3)),
    height: Math.min(image.height, Math.max(bounds.height * 5, 40)),
  } : null;
  const location = selected === null ? null : locateReviewWord(words, selected, result.edited, corrections[selected]);
  const choose = (index: number) => {
    setSelected(index);
    setReplacement(corrections[index] ?? words[index].text);
    setNotice("");
  };
  if (words.length === 0) return null;

  return <details className="ocr-source-review">
    <summary>Review words against the image · {uncertain} uncertain</summary>
    <p>Choose a word to highlight its source. Below {UNCERTAIN_WORD_CONFIDENCE}% engine confidence is a review hint, not a measured error rate. Corrections update Your edits.</p>
    <label className="ocr-review-filter"><input type="checkbox" checked={onlyUncertain} onChange={(event) => { setOnlyUncertain(event.currentTarget.checked); setLimit(100); }} />Show uncertain words only</label>
    <div className="ocr-review-words" aria-label="Recognised source words">
      {visibleWords.slice(0, limit).map(({ word: item, index }) => <button
        key={index} type="button" aria-pressed={selected === index}
        disabled={disabled || rerunning} className={item.confidence !== null && item.confidence < UNCERTAIN_WORD_CONFIDENCE ? "is-uncertain" : ""}
        title={item.confidence === null ? "Confidence unavailable" : `${Math.round(item.confidence)}% engine confidence`}
        onClick={() => choose(index)}>{corrections[index] ?? item.text}</button>)}
      {visibleWords.length === 0 && <p>No words fall below the review threshold. Check important text anyway.</p>}
    </div>
    {visibleWords.length > limit && <button className="text-button" type="button" onClick={() => setLimit((value) => value + 100)}>Show next 100 words</button>}
    {word && bounds && context && <>
      <div className="ocr-review-source" aria-label={`Source region for ${word.text}`}>
        <svg viewBox={`${context.x} ${context.y} ${context.width} ${context.height}`} role="img" aria-label="Original source region with the selected recognised word highlighted">
          <image href={image.objectUrl} width={image.width} height={image.height} />
          <rect
          x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height}
          fill="rgba(255,180,0,0.25)" stroke="#bf5b00" strokeWidth={Math.max(1, context.width / 300)} /></svg>
      </div>
      <label className="ocr-review-correction">Correction for “{word.text}”<input value={replacement} disabled={disabled || rerunning}
        spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
        onChange={(event) => setReplacement(event.currentTarget.value)} /></label>
      {!location && <p>This word is changed or appears ambiguously in Your edits. Make that correction directly in the editor.</p>}
      <div className="ocr-review-actions">
        <button className="button button--quiet" type="button" disabled={disabled || rerunning || !location} onClick={() => {
          if (!location || selected === null) return;
          onCorrect(location.start, location.end, replacement);
          setCorrections((value) => ({ ...value, [selected]: replacement }));
          setNotice("Correction applied to Your edits. Original OCR remains available.");
        }}>Apply correction</button>
        <button className="button button--quiet" type="button" disabled={disabled || rerunning} onClick={async () => {
          setRerunning(true);
          setNotice("Recognising this region locally…");
          try {
            const suggestion = await onRerun(word);
            if (suggestion === null) setNotice("Region recognition was cancelled or unavailable. You can correct the word manually.");
            else { setReplacement(suggestion.trim()); setNotice("Region result is a suggestion. Review it before applying."); }
          } finally { setRerunning(false); }
        }}>{rerunning ? "Recognising region…" : "Rerun selected region"}</button>
      </div>
      <p role="status">{notice}</p>
    </>}
  </details>;
}
