import { Link } from "react-router";
import { routes } from "../../../config/routes";
import type { GeneratedImageResult, RevealedTextResult } from "../state";

type EncodedResultProps = {
  readonly result: GeneratedImageResult;
  readonly onDownload: () => void;
  readonly onStartOver: () => void;
  readonly onClear: () => void;
};

export function EncodedResult({
  result,
  onDownload,
  onStartOver,
  onClear,
}: EncodedResultProps) {
  const label = result.format === "jpeg-v2" ? "JPEG" : "PNG";
  return (
    <section className="steg-card steg-result" aria-labelledby="encoded-result-title">
      <div className="steg-card__heading">
        <div><span className="step-number">03</span><h2 id="encoded-result-title">Download your hidden-message image</h2></div>
      </div>
      <img src={result.objectUrl} alt={`Preview of the newly encoded ${label}`} />
      <dl className="steg-file-facts">
        <div><dt>Filename</dt><dd>{result.filename}</dd></div>
        <div><dt>Dimensions</dt><dd>{result.width} × {result.height}</dd></div>
        <div><dt>Protection</dt><dd>{result.protection === "encrypted" ? "Password protected" : "No password"}</dd></div>
      </dl>
      <p id="encoded-download-warning" className="steg-result__download-warning">
        <strong>Keep this exact file.</strong> Resizing, editing, taking a
        screenshot or recompressing it can destroy the hidden message. The
        download starts only when you choose Download.
      </p>
      <p className="field-help"><Link to={routes.verify}>Verify browser-only processing</Link></p>
      <div className="steg-actions">
        <button
          className="button button--primary"
          type="button"
          aria-describedby="encoded-download-warning"
          onClick={onDownload}
        >
          Download {label}
        </button>
        <button className="button button--quiet" type="button" onClick={onStartOver}>Start over</button>
        <button className="text-button text-button--danger" type="button" onClick={onClear}>Clear</button>
      </div>
    </section>
  );
}

type RevealedResultProps = {
  readonly result: RevealedTextResult;
  readonly onCopy: () => void;
  readonly onDownload: () => void;
  readonly onClear: () => void;
};

export function RevealedResult({ result, onCopy, onDownload, onClear }: RevealedResultProps) {
  return (
    <section className="steg-card steg-result" aria-labelledby="revealed-result-title">
      <div className="steg-card__heading">
        <div><span className="step-number">03</span><h2 id="revealed-result-title">Read and copy the revealed message</h2></div>
      </div>
      <label>
        <span>Message text</span>
        <textarea
          className="steg-revealed-text"
          readOnly
          value={result.text}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      </label>
      <p className="field-help">Copy sends this text to the operating-system clipboard. Clipboard history or synchronisation may retain it.</p>
      <p className="field-help"><Link to={routes.verify}>Verify browser-only processing</Link></p>
      <div className="steg-actions">
        <button className="button button--primary" type="button" onClick={onCopy}>Copy message</button>
        <button className="button button--quiet" type="button" onClick={onDownload}>Download text file</button>
        <button className="text-button text-button--danger" type="button" onClick={onClear}>Clear</button>
      </div>
    </section>
  );
}
