import { expect, test } from "@playwright/test";
import { readFile, stat } from "node:fs/promises";

import { explicitDownload, generatePng, revealFile } from "./steganography-helpers";

test.describe("maximum-size carrier", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "The deliberately slow maximum-size integration is Chromium-only",
  );

  test("encodes and reopens a noisy 4096 by 4096 carrier", async ({ page }) => {
    test.slow();
    test.setTimeout(300_000);

    await page.goto("/hide-message");
    await page.evaluate(async () => {
      const width = 4_096;
      const height = 4_096;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");

      const image = context.createImageData(width, height);
      let random = 0x4c_54_53_47;
      for (let offset = 0; offset < image.data.length; offset += 4) {
        if ((offset & 7) === 0) {
          random ^= random << 13;
          random ^= random >>> 17;
          random ^= random << 5;
        }
        const value = random & 0xff;
        image.data[offset] = value;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value;
        image.data[offset + 3] = 255;
      }
      context.putImageData(image, 0, 0);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error("PNG encode failed")),
          "image/png",
        );
      });
      if (blob.size > 25 * 1024 * 1024) throw new Error("Fixture exceeds Hide limit");
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], "maximum-noisy.png", { type: "image/png" }));
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) throw new Error("File input unavailable");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await expect(page.getByText(/Message size: .* bytes used/)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("4096 × 4096", { exact: true })).toBeVisible();
    await generatePng(page, "maximum dimensions round trip");

    const download = await explicitDownload(page);
    const outputPath = await download.path();
    expect(outputPath).not.toBeNull();
    expect((await stat(outputPath!)).size).toBeLessThanOrEqual(80 * 1024 * 1024);
    const signature = (await readFile(outputPath!)).subarray(0, 8);
    expect(Array.from(signature)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    await page.getByRole("button", { name: "Clear" }).last().click();
    const revealed = await revealFile(page, outputPath!);
    await expect(page.getByText("4096 × 4096", { exact: true })).toBeVisible();
    await expect(revealed).toHaveValue(
      "maximum dimensions round trip",
      { timeout: 120_000 },
    );
  });
});
