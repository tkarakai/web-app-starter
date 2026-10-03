import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";
import { createDisposableUser } from "./helpers/fixtures";

test("owner can upload, download and delete a private 1 MiB attachment", async ({ page }) => {
  test.setTimeout(60_000);
  const user = await createDisposableUser();
  await signIn(page, user.email, user.password);
  await page.getByTitle("New project", { exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Private files");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.getByRole("tab", { name: "Attachments", exact: true }).click();

  const contents = Buffer.alloc(1_048_576, "x");
  await page.locator('input[type="file"]').setInputFiles({
    name: "private.txt", mimeType: "text/plain", buffer: contents,
  });
  await expect(page.getByText("private.txt", { exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "View", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("private.txt");
  const file = await download.path();
  expect(file).not.toBeNull();
  expect(await readFile(file!)).toEqual(contents);

  await page.getByRole("button", { name: "Delete file", exact: true }).click();
  await expect(page.getByText("private.txt", { exact: true })).toHaveCount(0);
});
