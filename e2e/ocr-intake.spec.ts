import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function dropImage(page: Page, bytes: Uint8Array, type: string) {
  const reportedType = await page.evaluate(({ input, type }) => {
    const file = new File([new Uint8Array(input)], "private-intake-SENTINEL.bin", { type });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document.querySelector(".dropzone")!.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
    );
    return file.type;
  }, { input: [...bytes], type });
  // setInputFiles can infer MIME metadata from a filename. Constructing the File
  // in-browser exercises an actually empty type through the normal drop path.
  expect(reportedType).toBe(type);
}

for (const fixture of [
  { extension: "png", type: "image/png" },
  { extension: "jpg", type: "image/jpeg" },
  { extension: "webp", type: "image/webp" },
  { extension: "bmp", type: "image/bmp" },
]) {
  test(`real ${fixture.extension} OCR accepts matching, absent and generic MIME metadata locally`, async ({ page, baseURL }, testInfo) => {
    const requests: { url: string; method: string }[] = [];
    const pageErrors: string[] = [];
    page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const bytes = await readFile(path.resolve(`tests/fixtures/ocr-intake/synthetic-text.${fixture.extension}`));
    await page.goto("/");

    for (const type of [fixture.type, "", "application/octet-stream"]) {
      await test.step(`MIME metadata: ${type || "absent"}`, async () => {
        await dropImage(page, bytes, type);
        const result = page.getByRole("textbox", { name: /^Tidied/ });
        await expect(result).toHaveValue(/LOCAL\s+OCR\s+INTAKE\s+7429/i, { timeout: 120_000 });
        await expect(result).toHaveValue(/SYNTHETIC\s+TEST\s+IMAGE/i);
        if (fixture.extension === "png" && type === "application/octet-stream") {
          await page.screenshot({ path: testInfo.outputPath("generic-mime-ocr.png"), fullPage: true });
        }
        await page.getByRole("button", { name: "Clear", exact: true }).first().click();
        await expect(page.getByRole("heading", { name: "Add an image" })).toBeVisible();
      });
    }

    const origin = new URL(baseURL!).origin;
    expect(requests.filter(({ url }) => url.startsWith("http") && new URL(url).origin !== origin)).toEqual([]);
    expect(requests.filter(({ method }) => !["GET", "HEAD"].includes(method))).toEqual([]);
    expect(JSON.stringify(requests)).not.toContain("SENTINEL");
    expect(pageErrors).toEqual([]);
  });
}

test("generic MIME intake rejects unsupported content, contradictory types and truncated payloads", async ({ page }) => {
  const bytes = await readFile(path.resolve("tests/fixtures/ocr-intake/synthetic-text.png"));
  await page.goto("/");
  for (const type of ["", "application/octet-stream"]) {
    for (const content of [
      "<svg xmlns='http://www.w3.org/2000/svg'><text>test</text></svg>",
      "%PDF-1.7\n1 0 obj <<>> endobj",
      "GIF89a\u0001\u0000\u0001\u0000",
      "\u0000\u0000\u0000\u0018ftypheic\u0000\u0000\u0000\u0000heic",
      "plain text",
      "",
    ]) {
      await dropImage(page, new TextEncoder().encode(content), type);
      await expect(page.getByText("The file contents are not a supported raster image. SVG, PDF and HEIC are not accepted.", { exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: /^Tidied/ })).toHaveCount(0);
    }

    // The dimension header is intact; full decode must still reject this
    // truncated payload rather than treating header inspection as sufficient.
    await dropImage(page, bytes.subarray(0, 24), type);
    await expect(page.getByText("This image could not be decoded safely by the browser.", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^Tidied/ })).toHaveCount(0);
  }

  await dropImage(page, bytes, "image/jpeg");
  await expect(page.getByText("The image contents do not match the file type reported by the browser.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Tidied/ })).toHaveCount(0);
});
