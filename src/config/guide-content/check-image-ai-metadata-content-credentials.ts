import type { GuideContent } from "../guides";
import { routes } from "../routes";

export const checkImageAiMetadataContentCredentialsGuideContent = {
  slug: "check-image-ai-metadata-content-credentials",
  introduction: "Media Inspector can examine embedded Content Credentials and recognised AI-related metadata without uploading your image. You will get evidence about this particular file: recorded claims, the local verifier’s result and ordinary metadata fields. You will not get a universal AI detector or a verdict on whether the scene really happened.",
  sections: [
  {
    id: "what-credentials-are", heading: "What Content Credentials and C2PA mean",
    paragraphs: [
      "Content Credentials are signed provenance records based on the Coalition for Content Provenance and Authenticity (C2PA) standard. A record can describe a file’s creation, edits, ingredients or declared digital source. Cryptographic signatures and bindings let a compatible verifier check that supported claims belong to the asset and have not been altered in ways that invalidate those checks.",
      "Provenance is a history of recorded claims, not an independent witness to the scene. Software or a device signs what it records; that does not establish that every depicted event is factual or that the accompanying caption is honest. Not every camera, editor or generator writes credentials, and a later export may discard them. The available history can therefore be incomplete even when a remaining credential validates.",
    ],
    links: [{ label: "C2PA’s explanation of provenance and its limits", to: "https://spec.c2pa.org/specifications/specifications/2.2/explainer/Explainer.html" }],
  },
  {
    id: "check-original", heading: "Check the original image",
    steps: [
      "Open Media Inspector and choose Choose media file, then select the original downloaded image.",
      "Wait for Inspection complete. In Overview, check Actual format, Dimensions and the SHA-256 file fingerprint.",
      "Select Origin & AI clues and wait for the embedded credential check to finish.",
      "Read the credential heading, Validation, Validation issues and Declared digital sources separately.",
      "Select Raw metadata to examine ordinary fields, or Download JSON report to retain the results locally.",
    ],
    paragraphs: ["Use the source file when available, rather than a screenshot or social-media preview. Those are different assets. A fingerprint helps you identify the exact copy you checked; it does not identify its creator. Exported reports may contain names, locations or other private metadata, so review them before sharing."],
  },
  {
    id: "separate-results", heading: "Separate integrity, trust and source claims",
    bullets: [
      "Credential integrity: the Validation result summarises the local verifier’s cryptographic and binding checks. Valid supports the credential’s attachment to this file; Invalid means validation failed, which may reflect editing, damage or unsupported features.",
      "Local trust state: the heading distinguishes a valid credential from a trusted validation state. This tool bundles no custom trust anchors and performs no online certificate-status or identity lookup. A valid result can coexist with a signer-trust issue; it is not a personal identity endorsement.",
      "Declared source type: Declared digital sources lists supported source assertions in the active manifest. A computational or trained-algorithm declaration is a signed claim, not a probability calculated from the pixels. None declared means the inspected assertions did not supply a supported source type.",
    ],
    paragraphs: ["Claim generator identifies the software named in the credential, while Active manifest identifies the selected record. Neither field substitutes for validation. The inspector keeps declared source values distinct from the validation result instead of collapsing everything into an “AI or human” answer."],
    links: [{ label: "Technical verification and network limits", to: `${routes.howItWorksTechnical}#technical-media-inspector-title` }],
  },
  {
    id: "credential-example", heading: "A credentialed image, checked locally",
    paragraphs: ["We selected CA.jpg from the Content Authenticity Initiative’s public c2pa-rs test fixtures in the real inspector. It returned “Credential valid; signer trust not established”, one validation issue and no declared digital source. The JSON report identified signingCredential.untrusted. This is a test signer: the result illustrates valid integrity without established local trust, and supplies no basis for classifying the picture as AI-generated."],
    figures: [{ src: "/guides/check-image-ai-metadata-content-credentials/credential-result.webp", alt: "Media Inspector result for a C2PA test image: credential valid, signer trust not established, one validation issue and no declared digital sources", caption: "Real local result for the c2pa-rs CA.jpg fixture. Valid does not mean the signer’s identity has been established.", width: 737, height: 375 }],
    links: [{ label: "Source test fixture", to: "https://github.com/contentauth/c2pa-rs/blob/main/sdk/tests/fixtures/CA.jpg" }],
  },
  {
    id: "editable-ai-metadata", heading: "What ordinary AI metadata looks like",
    paragraphs: ["Ordinary EXIF Software and XMP CreatorTool fields may name an editor or generator. PNG text fields can contain a prompt, model name, sampler settings or a ComfyUI workflow. The inspector groups recognised generation-related fields under Possible AI generation details. These fields are freely editable: someone can add a software name to an unrelated photograph, remove a prompt or copy metadata between files. A familiar application name can also reflect ordinary editing rather than generation."],
  },
  {
    id: "who-adds-credentials", heading: "Which AI tools and cameras add Content Credentials",
    paragraphs: [
      "Whether an AI image has a credential depends first on the tool that made it. Several large providers say they attach C2PA Content Credentials to generated images, and a growing number of cameras and phones sign photographs at capture. Many other generators, including many self-hosted and open-source tools, add none by default, and some write only ordinary, editable metadata. The table summarises public provider statements compiled in November 2026; it is not a test of every product version, and providers change their tools.",
    ],
    table: {
      caption: "Summary of public provider statements about Content Credentials, compiled November 2026",
      headers: ["Source", "What the provider says", "What you may see in Media Inspector"],
      rows: [
        ["OpenAI (ChatGPT and API images)", "Generated images include C2PA metadata, which platforms, editing tools or file conversions can remove.", "An embedded credential if the file has not been stripped or converted."],
        ["Adobe Firefly", "Attaches Content Credentials to generated files and may also store them in Adobe’s Content Credentials cloud.", "An embedded credential, unless it was removed after export."],
        ["Microsoft Bing Image Creator and Designer", "Adds C2PA-based provenance to generated images.", "An embedded credential when the original download is checked and its format is supported."],
        ["Google Gemini and Pixel 10", "Some Google image models add C2PA credentials as well as a SynthID watermark; the Pixel 10 camera can sign photos.", "The C2PA credential only. SynthID is an invisible watermark that this tool does not read."],
        ["Local and self-hosted generators", "Often no credential; some write prompts or settings into PNG text fields.", "No embedded credential, possibly with Possible AI generation details."],
      ],
    },
    links: [
      { label: "Google: SynthID and C2PA in the Gemini app", to: "https://blog.google/innovation-and-ai/products/ai-image-verification-gemini-app/" },
      { label: "Google Pixel: Content Credentials in Pixel Camera", to: "https://blog.google/security/pixel-android-trusted-images-c2pa-content-credentials/" },
      { label: "OpenAI: provenance signals in generated content", to: "https://help.openai.com/en/articles/8912793-provenance-signals-in-openai-generated-content" },
      { label: "Microsoft: Bing Image Creator", to: "https://explore.microsoft.com/en-us/bing/features/bing-image-creator" },
      { label: "Adobe Firefly: Content Credentials overview", to: "https://helpx.adobe.com/firefly/web/get-started/learn-the-basics/content-credentials-overview.html" },
    ],
  },
  {
    id: "why-credentials-disappear", heading: "Why an AI image may have no credential",
    bullets: [
      "The generator never added one, or the feature was not available for that model, app or account.",
      "The image was screenshotted, cropped, resized, converted to another format or re-saved by an editor that does not carry credentials forward.",
      "A website, messaging app or content delivery network re-encoded the upload and discarded metadata. Some services keep credentials only when an option is switched on.",
      "Someone removed it deliberately. Metadata, including a C2PA manifest, can be stripped in seconds with ordinary tools.",
      "The credential lives elsewhere. The C2PA standard allows a manifest to be stored remotely or recovered through a watermark or fingerprint lookup. Media Inspector checks only credentials embedded in the file and performs no remote lookups.",
    ],
    callout: "Invisible watermarks such as Google’s SynthID are a separate signal embedded in the pixels. A C2PA checker that reads embedded manifests, including this one, cannot see them; the watermark owner’s own checker is needed.",
    links: [{ label: "C2PA: decoupled manifests and soft bindings", to: "https://spec.c2pa.org/specifications/specifications/2.4/softbinding/Decoupled.html" }],
  },
  {
    id: "missing-proves-nothing", heading: "A missing credential proves nothing",
    paragraphs: ["No embedded Content Credential found does not prove human creation, authenticity or absence of editing. The creator may never have added one, a service may have stripped it, or the relevant history may exist outside the file. This inspector checks embedded credentials only; it does not fetch remote manifests. An unsupported format or failed check is also different from a completed check that found none. Ask for the original and corroborating context when origin matters."],
  },
  {
    id: "before-you-rely", heading: "Before you rely on this",
    callout: "A valid credential validates supported signed claims, not the truth of an event. Preserve the original, record which file was checked and seek independent context before making a consequential attribution. Removing metadata can remove useful provenance; it cannot change the image’s actual origin.",
  },
  ],
  faqs: [
  { question: "How do I check if an image has Content Credentials?", answer: "Open the original file in Media Inspector and select Origin & AI clues. The tool checks for an embedded C2PA manifest in your browser and reports whether one was found, whether it validated and any declared digital source type." },
  { question: "Does ChatGPT add metadata to images?", answer: "OpenAI says images generated with ChatGPT and its API include C2PA metadata. That metadata is often lost when an image is screenshotted, converted or uploaded to a service that strips it, so a copy you find online may not have it." },
  { question: "What is C2PA?", answer: "The Coalition for Content Provenance and Authenticity publishes the open standard behind Content Credentials: a signed record, attached to a file, that describes claims about how the file was created and edited." },
  { question: "If an image has no Content Credentials, is it real?", answer: "No conclusion follows. Many images have no credential, including many genuine photographs, and credentials are easily removed from AI images. Absence is not evidence either way." },
  { question: "Does a valid credential prove an image is genuine?", answer: "No. Validation confirms that supported signed claims are attached to this file and have not been altered. It does not confirm that the scene is real, that the caption is honest or that the signer is who you think, unless trust has also been established." },
  ],
} satisfies GuideContent;
