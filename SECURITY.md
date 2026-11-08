# Security policy

Private Image to Text (codename LocalText) is a static, browser-only site.
Its main security promise is that selected files and results stay in the
browser. A flaw that breaks that promise is a security issue, even if it
looks minor.

## Reporting a vulnerability

Please report security issues privately by email to
**contact@privateimagetotext.com**. Do not open a public issue for a
suspected vulnerability.

Include:

- what you found and why it matters;
- the route, browser and operating system you used;
- steps to reproduce, or a minimal test file (please do not send sensitive
  personal files);
- whether you plan to publish your findings, and when.

This is a one-person project, so responses are best effort. There is no bug
bounty.

## In scope

- Any path by which selected files, filenames, pixels, metadata, checksums, OCR
  text, messages, passwords, plaintext, ciphertext or generated files leave the
  browser, or reach a URL, analytics, logs or the Cloudflare analytics beacon.
- Persistence of user content in `localStorage`, `sessionStorage`, IndexedDB,
  Cache Storage, cookies or URLs.
- Content Security Policy or header weaknesses in
  [`public/_headers`](public/_headers), and script injection (XSS) through file
  contents, metadata, OCR output or revealed messages.
- Cryptographic flaws in the password-protected Hide message formats (see
  [format v1](docs/steganography-format-v1.md) and
  [format v2](docs/steganography-format-v2.md)).
- Parser crashes, hangs or memory exhaustion from crafted image, PDF or media
  files, where they could affect other work in the page.
- Service worker behaviour that caches user content or serves stale code
  unsafely.
- Media Inspector reporting a file as clean, or a Content Credential as valid,
  when it is not.

## Out of scope

- Steganalysis showing that a hidden message is present. The site does not
  claim that hidden messages are undetectable.
- Attacks that need a compromised device, browser or extension.
- Ordinary request data that Cloudflare processes to host the site, its
  Network Error Logging reports, and the documented Cloudflare Web Analytics
  beacon. Report it if any of these receives user content.
- Missing headers on third-party domains, and reports from automated scanners
  without a demonstrated impact.
- Denial of service against the hosting provider.

## Supported versions

Only the current production site at <https://privateimagetotext.com> and the
`main` branch are supported.
