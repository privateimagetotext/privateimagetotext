import { Link } from "react-router";
import { routes } from "../config/product";
import { ContentPage } from "./ContentPage";

const howItWorksTableOfContents = [
  { id: "extract-flow-title", label: "Extract text from an image" },
  ...(__PDF_OCR_PUBLIC__ ? [{ id: "pdf-flow-title", label: "Extract text from a PDF" }] : []),
  { id: "hide-flow-title", label: "Hide a message inside an image" },
  { id: "inspect-flow-title", label: "Inspect media metadata and origin clues" },
  { id: "separate-tools-title", label: "The tools are separate" },
  { id: "browser-only-title", label: "What browser-only means" },
  { id: "important-limits-title", label: "Important limitations" },
] as const;

const extractSteps = [
  ["Add images", "Paste, drop or choose up to 10 screenshots, photos or scans, with a 100 MiB total limit. Or try a public sample."],
  ["Check the image", "The browser checks the file type, size and dimensions before processing it."],
  ["Recognise the text", "A single image runs automatically after any large-image confirmation. For a batch, choose Process pending images. Images are recognised one at a time in your browser."],
  ["Adjust if needed", "Crop, rotate or adjust the enhancement or content type, then choose Re-run OCR. Settings changes wait for your action."],
  ["Review the result", "Compare recognised words with the source image, correct each result and export a combined text file or separate files in a ZIP."],
] as const;

const hideSteps = [
  ["Choose a picture", "Select the image you want to use."],
  ["Write the message", "The tool shows how much message space is available."],
  ["Choose protection", "Add a password to encrypt the message, or deliberately choose no password."],
  ["Create a new image", "Download a new PNG or supported JPEG containing the hidden message."],
  ["Reveal the message", "Open the exact downloaded file with this tool or compatible software. Enter the password if one was used."],
] as const;

const inspectSteps = [
  ["Choose a media file", "Select one supported photo, video or audio file from this device."],
  ["Confirm the real format", "The browser reads bounded file sections and identifies the contents from their signature."],
  ["Inspect the evidence", "Review technical fields, privacy warnings, AI-related metadata and embedded Content Credentials."],
  ["Check the wording", "Ordinary metadata is labelled unverified, while credential integrity and signer trust remain separate."],
  ["Remove supported metadata", "For an eligible still JPEG or PNG, explicitly create a separate copy with supported file-level metadata removed and the output rechecked."],
  ["Export deliberately", "Download a local JSON report or a verified metadata-removed copy only if you want to keep it. The source is never overwritten."],
] as const;

function StepList({ steps }: { readonly steps: readonly (readonly [string, string])[] }) {
  return (
    <ol className="plain-steps">
      {steps.map(([title, detail]) => (
        <li key={title}>
          <strong>{title}</strong>
          <span>{detail}</span>
        </li>
      ))}
    </ol>
  );
}

export function HowItWorksPage() {
  return (
    <ContentPage
      eyebrow="How it works"
      title="How Private Image to Text works"
      introduction="Private Image to Text provides separate browser tools for extracting text, hiding or revealing a message, and inspecting media metadata and origin clues. Each processes your selected content in the browser."
      actionLabel="Open Extract text"
      actionTo={routes.tool}
      className="how-it-works-page"
      tableOfContents={howItWorksTableOfContents}
    >
      <section className="content-section content-section--lead" aria-labelledby="extract-flow-title">
        <h2 id="extract-flow-title">Extract text from an image</h2>
        <p>OCR, or optical character recognition, turns text in an image into editable text.</p>
        <StepList steps={extractSteps} />
        <div className="privacy-callout">
          <p>The selected image and recognised text are not uploaded by this site.</p>
        </div>
      </section>

      {__PDF_OCR_PUBLIC__ && routes.pdfToText ? (
        <section className="content-section" aria-labelledby="pdf-flow-title">
          <h2 id="pdf-flow-title">Extract text from a PDF</h2>
          <StepList steps={[
            ["Choose a PDF", "Select one PDF up to 25 MiB and 100 pages. Passwords are handled locally."],
            ["Choose pages and a method", "Preview up to 50 selected pages and choose up to three OCR languages. Automatic uses existing text or OCR per page; at most 25 OCR pages can run in one operation."],
            ["Review every page", "Edit the result or reprocess a page with a different method. Check failures and incomplete pages before exporting."],
            ["Export text", "Copy or download page-marked plain text. The source PDF is unchanged."],
          ]} />
          <p><Link to={routes.pdfToText}>Open PDF to text</Link></p>
        </section>
      ) : null}

      <section className="content-section" aria-labelledby="hide-flow-title">
        <div className="content-section__heading">
          <p className="section-index">02</p>
          <h2 id="hide-flow-title">Hide a message inside an image</h2>
        </div>
        <StepList steps={hideSteps} />
        <div className="limitation-callout">
          <p>
            Keep the exact downloaded file. Editing, resizing, screenshots or
            recompression can destroy the hidden message.
          </p>
        </div>
      </section>

      <section className="content-section" aria-labelledby="inspect-flow-title">
        <div className="content-section__heading">
          <p className="section-index">03</p>
          <h2 id="inspect-flow-title">Inspect media metadata and origin clues</h2>
        </div>
        <StepList steps={inspectSteps} />
        <div className="limitation-callout">
          <p>
            No metadata or credential is a universal authenticity verdict. Missing
            origin evidence means the origin is unknown, not human-made.
            A metadata-removed copy removes supported file-level metadata; it does not
            visually redact the image, detect malware, provide anonymity or securely
            erase the source.
          </p>
        </div>
      </section>

      <section className="content-section" aria-labelledby="separate-tools-title">
        <div className="content-section__heading">
          <p className="section-index">04</p>
          <h2 id="separate-tools-title">The tools are separate</h2>
        </div>
        <p>
          The tools do not share your selected
          file, text, metadata or result. Choosing the same file again in another
          tool is a separate action that you control.
        </p>
      </section>

      <section className="content-section" aria-labelledby="browser-only-title">
        <div className="content-section__heading">
          <p className="section-index">05</p>
          <h2 id="browser-only-title">What browser-only means</h2>
        </div>
        <p>
          Browser-only means this site processes your selected content in the
          current browser instead of sending it to an OCR, media-analysis or
          image-processing server.
        </p>
      </section>

      <section className="content-section" aria-labelledby="important-limits-title">
        <div className="content-section__heading">
          <p className="section-index">06</p>
          <h2 id="important-limits-title">Important limitations</h2>
        </div>
        <ul>
          <li>OCR can make plausible-looking mistakes.</li>
          <li>Steganography does not guarantee undetectability.</li>
          <li>Hidden messages usually do not survive image editing or recompression.</li>
          <li>Passwords cannot be recovered.</li>
          <li>Ordinary metadata can be changed or removed and is not proof of origin.</li>
          <li>A valid Content Credential verifies signed origin and edit claims, not the truth of a depicted event.</li>
          <li>Browser extensions and device software remain outside this site&apos;s control.</li>
        </ul>
      </section>

      <nav className="related-links" aria-label="How it works next steps">
        <h2>Choose the level of detail you need</h2>
        <div>
          <Link to={routes.howItWorksTechnical}>Read the technical documentation</Link>
          <Link to={routes.privacy}>Read the privacy summary</Link>
          <Link to={routes.verify}>Verify browser-only processing</Link>
          <Link to={routes.hideMessage}>Open Hide message</Link>
          <Link to={routes.mediaInspector}>Open Media Inspector</Link>
        </div>
      </nav>
    </ContentPage>
  );
}
