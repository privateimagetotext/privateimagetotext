import { expect, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const fixturePath = path.resolve("e2e/fixtures/localtext-ocr.png");

export async function chooseCarrier(page: Page, name = "carrier.png") {
  const buffer = await readFile(fixturePath);
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "image/png",
    buffer,
  });
  await expect(page.getByText(/Message size:/)).toBeVisible();
}
export async function chooseTransparentCarrier(page: Page) {
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#476a8f";
    context.fillRect(20, 20, 216, 216);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("PNG encode failed")),
        "image/png",
      );
    });
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([blob], "transparent-carrier.png", { type: "image/png" }),
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("File input unavailable");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByText(/Message size:/)).toBeVisible();
}
export async function generatePng(
  page: Page,
  message: string,
  password?: string,
) {
  await page.getByRole("textbox", { name: "Message" }).fill(message);
  if (password) {
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
  } else {
    await page.getByRole("radio", { name: /^No password/ }).check();
  }
  await page.getByRole("button", { name: "Create PNG with hidden message" }).click();
  await expect(page.getByRole("heading", { name: "Download your hidden-message image" })).toBeVisible({
    timeout: 60_000,
  });
}

export async function explicitDownload(page: Page): Promise<Download> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  return pending;
}

export async function revealFile(
  page: Page,
  filePath: string,
  password?: string,
) {
  await page.getByRole("radio", { name: /Reveal a message/ }).check();
  await page.locator('input[type="file"]').setInputFiles(filePath);
  if (password) {
    const field = page.getByLabel("Password", { exact: true });
    await expect(field).toBeVisible();
    await field.fill(password);
    await page.getByRole("button", { name: "Reveal message", exact: true }).click();
  }
  return page.getByLabel("Message text");
}

export async function mutateEncodedPng(
  page: Page,
  bytes: Uint8Array,
  target: "header-nonce" | "payload",
) {
  const input = Array.from(bytes);
  const output = await page.evaluate(
    async ({ inputBytes, mutation }) => {
      const blob = new Blob([new Uint8Array(inputBytes)], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas unavailable");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = image.data;
      const domain = canvas.width * canvas.height * 3;
      const channels: number[] = [];
      const header = new Uint8Array(84);
      for (let physical = 0; physical < domain && channels.length < 672; physical += 1) {
        const pixel = Math.floor(physical / 3);
        if (pixels[pixel * 4 + 3] !== 255) continue;
        const channel = physical % 3;
        const offset = pixel * 4 + channel;
        const bit = channels.length;
        header[Math.floor(bit / 8)] |= (pixels[offset] & 1) << (7 - (bit % 8));
        channels.push(physical);
      }
      if (channels.length !== 672) throw new Error("missing header");
      const byteOffset = (physical: number) => Math.floor(physical / 3) * 4 + (physical % 3);
      if (mutation === "header-nonce") {
        pixels[byteOffset(channels[32 * 8])] ^= 1;
      } else {
        const view = new DataView(header.buffer);
        const start = view.getUint32(76, false);
        const step = view.getUint32(80, false);
        const excluded = new Set(channels);
        let physical = start;
        for (let visited = 0; visited < domain; visited += 1) {
          const pixel = Math.floor(physical / 3);
          if (!excluded.has(physical) && pixels[pixel * 4 + 3] === 255) {
            pixels[byteOffset(physical)] ^= 1;
            break;
          }
          physical = (physical + step) % domain;
        }
      }
      context.putImageData(image, 0, 0);
      const changed = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encode failed")), "image/png");
      });
      return Array.from(new Uint8Array(await changed.arrayBuffer()));
    },
    { inputBytes: input, mutation: target },
  );
  return Buffer.from(output);
}
