# Contributing

Thanks for your interest. Private Image to Text (codename LocalText) is a
small, one-person project, so please open an issue to discuss anything larger
than a small fix before you start work on it.

## Privacy invariants come first

The privacy promise is the product. A change that weakens any of these is a
defect, even if every test passes, and it will not be merged.

1. Selected files, filenames, pixels, metadata, checksums, OCR text, messages,
   passwords, plaintext, ciphertext and generated outputs never leave the
   browser.
2. No new network destination, third-party script, iframe, remote font or
   image, tracking pixel or redirect wrapper on any route. Do not widen the
   Content Security Policy in [`public/_headers`](public/_headers).
3. The tool routes (`/`, `/hide-message`, `/media-inspector` and
   `/pdf-to-text`) never contain monetisation components or links inside the
   workspace: no advertising, sponsorship, affiliate, support or donation
   links.
4. No persistence of user content: not in `localStorage`, `sessionStorage`,
   IndexedDB, Cache Storage, cookies or URLs.
5. Copy describes implemented behaviour exactly. Do not claim "undetectable",
   "secure deletion", "AI detection", authenticity verdicts or anything that
   has not been measured.

Before you change privacy, networking or caching code, read
[docs/privacy-architecture.md](docs/privacy-architecture.md).

A new feature must answer yes to all of these:

- Does it keep images, OCR text, messages, passwords and payloads in the
  browser, with no new network destination or persistent store?
- Does it work under the existing Content Security Policy?
- Are its assets pinned, licensed, same-origin and cacheable without user data?
- Are memory and object lifetimes bounded, and can cancellation, replacement,
  navigation and Clear reject stale work?
- Is it usable by keyboard and touch, at 320px width and 200% zoom?
- Are its errors honest and recoverable, and does its copy describe exactly
  what it does?

## Set up

You need Node.js 22.22 or newer and pnpm 11.9.0 (pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm dev        # development server at http://127.0.0.1:5173/
```

Keep the development server bound to `127.0.0.1`.

## Checks

| Purpose | Command |
|---|---|
| Fast checks (before every push) | `pnpm run typecheck && pnpm run lint && pnpm run test:unit` |
| Build plus rendered-HTML, sitemap, structured-data and guide-quality tests | `pnpm run test` |
| End-to-end tests (needs a prior build) | `pnpm exec playwright test --project=chromium` |
| Full gate, as run in CI | `pnpm run verify` |

Add tests for every new behaviour. Never skip, disable or weaken an existing
test to make a change pass. In your pull request, say which checks you ran and
their results.

## Pull requests

- Keep each pull request focused on one change.
- Explain what changed and why, and include screenshots for visible changes at
  desktop and phone widths.
- Include a short privacy check: does the change add a network request, a
  stored value, a dependency or new copy that makes a claim?
- Site copy uses Australian English.
- Pin new runtime assets, serve them from the same origin, and record their
  licences in [NOTICE.md](NOTICE.md).

## Security issues

Do not open a public issue for a vulnerability. Follow
[SECURITY.md](SECURITY.md) instead.

## Guides are not open for contributions

The guide text, figures and evidence listed in
[LICENSE-CONTENT](LICENSE-CONTENT) are all rights reserved. Please report
errors in a guide as an issue instead of opening a pull request that changes
it.

## Licence

The code is licensed under the [GNU AGPL-3.0-only](LICENSE). By submitting a
contribution, you agree that it is licensed under the same terms. Guide content
is not open for contributions (see above).
