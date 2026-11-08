// Prints two unmodified public W3C articles with the installed Chrome channel.
// Run the PDF skill operation marker before this authoring command.
/* global document, getComputedStyle */
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'tmp/pdf-diversity-20260906/browser-print');
await mkdir(out, { recursive: false });
const sha = data => createHash('sha256').update(data).digest('hex');
const relative = filename => path.relative(root, filename).replaceAll('\\', '/');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const records = [];
try {
  for (const [id, url] of [
    ['w3c-inline-bidi', 'https://www.w3.org/International/articles/inline-bidi-markup/'],
    ['w3c-vertical', 'https://www.w3.org/International/articles/vertical-text/'],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const requests = [], failures = [], pageErrors = [];
    context.on('request', request => {
      const parsed = new URL(request.url());
      if (['https:', 'http:'].includes(parsed.protocol)) requests.push({ origin: parsed.origin, path: parsed.pathname, method: request.method() });
    });
    page.on('requestfailed', request => failures.push({ url: new URL(request.url()).origin + new URL(request.url()).pathname, error: request.failure()?.errorText }));
    page.on('pageerror', error => pageErrors.push(error.name));
    // Source acquisition is separate from the app. Only read requests to the
    // article's own HTTPS host are allowed in this clean browser context.
    await context.route('**/*', async route => {
      const request = route.request();
      const parsed = new URL(request.url());
      if (['http:', 'https:'].includes(parsed.protocol) && (parsed.origin !== 'https://www.w3.org' || !['GET', 'HEAD'].includes(request.method()))) await route.abort('blockedbyclient');
      else await route.continue();
    });
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    if (!response?.ok()) throw new Error(`Public article did not load: ${id}`);
    const html = await response.body();
    await writeFile(path.join(out, `${id}-response.html`), html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every(image => image.complete), { timeout: 30000 });
    const sourceState = await page.evaluate(() => ({
      title: document.title,
      copyright: document.getElementById('copyright')?.innerText ?? '',
      footer: document.querySelector('footer')?.innerText ?? '',
      brokenImages: [...document.images].filter(image => !image.naturalWidth).map(image => ({ src: image.getAttribute('src'), alt: image.alt })),
      liveVertical: [...document.querySelectorAll('p, div, span')].filter(element => ['vertical-rl', 'vertical-lr'].includes(getComputedStyle(element).writingMode)).slice(0, 30).map(element => ({ text: element.textContent, writingMode: getComputedStyle(element).writingMode })),
      fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
    }));
    if (!sourceState.footer.includes('Copyright')) throw new Error(`Source copyright footer not loaded: ${id}`);
    await writeFile(path.join(out, `${id}-rendered.html`), await page.content());
    const filename = path.join(out, `${id}.pdf`);
    const pdf = await page.pdf({
      path: filename, format: 'A4', printBackground: true,
      margin: { top: '16mm', bottom: '18mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-family:Arial,sans-serif;font-size:7px;width:100%;margin:0 12mm;color:#333"><span>${escape(url)}</span><span style="float:right">Source print · <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
    });
    if (pdf.length > 25 * 1024 * 1024) throw new Error(`Printed PDF exceeds app size bound: ${id}`);
    const original = await readFile(path.join(root, `tmp/pdf-diversity-20260906/source/${id}.html`));
    records.push({ id, sourceUrl: url, sourceAcquiredAt: new Date().toISOString(), sourceHtmlSha256: sha(html), earlierHtmlSha256: sha(original), identicalToEarlierDownload: sha(html) === sha(original), browser: 'installed Google Chrome headless channel', browserVersion: browser.version(), creation: 'Playwright page.pdf using native Chromium print-to-PDF; complete source article unedited, with source URL/page-count print footer', pdfPath: relative(filename), pdfBytes: pdf.length, pdfSha256: sha(pdf), sourceState, requests, failures, pageErrors });
    await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(records, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ id, bytes: pdf.length, sha256: sha(pdf), brokenImages: sourceState.brokenImages, failures, pageErrors })}\n`);
    await context.close();
  }
} finally {
  await browser.close();
}
