import { expect, test } from "@playwright/test";

import {
  chooseCarrier,
  chooseTransparentCarrier,
  explicitDownload,
  generatePng,
  revealFile,
} from "./steganography-helpers";

test("v1 plain and encrypted PNGs interoperate under production CSP", async ({ page }) => {
  await page.goto("/hide-message");
  await chooseTransparentCarrier(page);
  await generatePng(page, "plain π🙂\nline");
  const plain = await explicitDownload(page);
  const plainPath = await plain.path();
  await page.getByRole("button", { name: "Clear" }).last().click();
  await expect(await revealFile(page, plainPath!)).toHaveValue("plain π🙂\nline");

  await page.getByRole("button", { name: "Clear" }).last().click();
  await page.getByRole("radio", { name: /Hide a message/ }).check();
  await chooseCarrier(page, "smoke-encrypted.png");
  await generatePng(page, "encrypted π🙂", "smoke-password-012");
  const encrypted = await explicitDownload(page);
  const encryptedPath = await encrypted.path();
  await page.getByRole("button", { name: "Clear" }).last().click();
  await expect(
    await revealFile(page, encryptedPath!, "smoke-password-012"),
  ).toHaveValue("encrypted π🙂");
  await expect(page.locator("img[alt='Selected source preview']")).toHaveCount(0);
});
