import type { GuideContent } from "../guides";
import { routes } from "../routes";

export const offlineOcrWithoutInternetGuideContent = {
  slug: "offline-ocr-without-internet",
  introduction: "Private Image to Text can recognise printed text in images with your device offline. The site files, the OCR engine and each language model are downloaded once and cached by your browser. After that, you can switch on aeroplane mode or unplug the network and still turn screenshots, photos and scans into editable text. This guide covers preparing, going offline, running OCR and checking that it really worked without a connection.",
  sections: [
  {
    id: "why-offline", heading: "Why run OCR offline",
    paragraphs: [
      "Image OCR on this site already runs in your browser, so the image and recognised text are not uploaded whether you are online or not. Working offline adds a check you can see for yourself: with the network switched off, the page has no connection to send anything over. It also helps when you have no signal, are on a flight, are using a restricted network or simply want to know that a confidential document never left the device.",
      "Offline use depends on files your browser has stored. Nothing is installed in your operating system, and no account is involved. The cached files are the site’s own application files and OCR models; they never contain your images or text.",
    ],
  },
  {
    id: "prepare", heading: "Prepare while you are connected",
    steps: [
      "Open Extract text in the browser you will use offline. Use a normal window, because private or incognito windows usually discard cached files when closed.",
      "Wait for the site files to finish caching. The status in the header changes from preparing to setup needed or ready.",
      "Open Languages above the tool. English is selected by default; tick up to three languages you will need offline.",
      "Choose Download selected languages, or Prepare offline OCR in the privacy section further down the page. Running OCR on any image while connected also downloads the selected models automatically.",
      "Wait until the header reads Image OCR offline: ready for, followed by your languages. Select the header status to see exactly what has been cached.",
    ],
    callout: "Each language model is downloaded only when you select it. If you might need another language offline, download it now; it cannot be fetched without a connection.",
    figures: [{ src: "/guides/offline-ocr-without-internet/ready-status.webp", alt: "Header status reading Image OCR offline: ready for English, with an explanation that English, the site files and the OCR engine are cached in this browser", caption: "The real status after Prepare offline OCR. It describes image OCR only; PDF tools have separate checks.", width: 376, height: 249 }],
  },
  {
    id: "go-offline", heading: "Go offline and extract text",
    steps: [
      "Turn on aeroplane mode, switch off Wi-Fi and mobile data, or disconnect the network cable.",
      "Open or reload the Extract text page in the same browser. Bookmark the page so it is easy to reach without searching.",
      "If you prepared languages other than English, open Languages and select them again. Choices reset when the page reloads, and each prepared language is marked as downloaded.",
      "Choose an image, paste a screenshot or drop a file. Recognition starts as usual.",
      "Review the Tidied or Original OCR result, edit it, then copy it or download it as a text or Markdown file.",
    ],
    paragraphs: [
      "In our run, we prepared English, switched the browser to offline, reloaded the page and selected a sample screenshot. The page loaded from the cache and recognised “Reference: SCREEN-7429” and the other lines, while the status continued to read ready for English.",
    ],
    figures: [{ src: "/guides/offline-ocr-without-internet/offline-result.webp", alt: "Extract text page loaded with the network offline, showing the sample screenshot and its recognised text, with the badge Offline: ready for English", caption: "A real recognition result captured with the browser’s network switched off after preparation.", width: 1272, height: 774 }],
  },
  {
    id: "check-offline", heading: "Check that nothing needed the network",
    paragraphs: [
      "The simplest test is the one above: if the page loads and recognises text with the network switched off, it did not need a server. For a closer look on a computer, open your browser’s developer tools, select the Network panel and choose Offline in its throttling menu, then repeat the steps. Requests will either fail or be answered from the browser’s cache, and recognition still completes. The Verify page explains how to read the Network panel when you are online, too.",
    ],
    links: [{ label: "Verify browser-only processing", to: routes.verify }],
  },
  {
    id: "other-tools", heading: "Offline use for PDFs and the other tools",
    bullets: [
      ...(routes.pdfToText ? ["PDF to Text has its own offline panel. Choose Prepare PDF and OCR support there while connected: digital PDFs need the PDF reader, and scanned PDFs need both the reader and the selected OCR languages."] : []),
      "Hide message can create and reveal PNG messages offline after you have opened it once while connected. The JPEG mode loads an extra codec on its first use, so try it once online before relying on it offline.",
      "Media Inspector works offline after you have inspected one file while connected. That first inspection also loads the separate Content Credentials verifier.",
      "The header status reports image OCR readiness only. It does not mean every optional tool component is cached.",
    ],
  },
  {
    id: "keep-it-ready", heading: "Keep it ready over time",
    paragraphs: [
      "Browsers treat cached site files as removable. Clearing browsing data or site data for this site removes them, and browsers may evict them when the device is low on storage. Safari and other WebKit browsers can delete storage for websites that you have not used for some days, although web apps added to the Home Screen are treated differently. Before a trip or an important offline session, open the page once while connected and confirm that the header still reads ready for your languages.",
      "When the site is updated, your browser fetches the new application files on your next connected visit. Recheck the status afterwards, especially before you depend on offline use.",
    ],
    links: [{ label: "WebKit: tracking prevention and storage limits", to: "https://webkit.org/tracking-prevention/" }],
  },
  {
    id: "before-you-rely", heading: "Before you rely on this",
    bullets: [
      "OCR produces a draft. Check names, numbers, dates and codes against the image before you use the text.",
      "Printed text works best. Handwriting, stylised fonts, very small text and poor lighting reduce accuracy offline and online alike.",
      "Offline mode stops the site sending data, but it does not control browser extensions, device monitoring software, clipboard sync or where you save downloaded text. Those apply when you reconnect.",
      "Readiness describes this browser on this device. Another browser, profile or device needs its own preparation.",
    ],
  },
  ],
  faqs: [
  { question: "Can I use OCR without an internet connection?", answer: "Yes. Prepare Extract text once while connected so the site files and your selected language models are cached, then the tool recognises printed text in images with the device offline." },
  { question: "Do I need to install an app for offline OCR?", answer: "No. Your browser caches the site’s files. There is no download to install and no account. If your browser offers to install the site as an app, that is optional." },
  { question: "Which languages work offline?", answer: "Only the languages whose models you downloaded while connected. The header status lists them, for example ready for English, Spanish." },
  { question: "Is offline OCR more private than online OCR here?", answer: "Your image is not uploaded in either case, because recognition always runs in the browser. Being offline removes the network as a possible path entirely, which some people prefer for confidential documents." },
  ],
} satisfies GuideContent;
