import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const platformVersion = readFileSync(
  join(__dirname, "../../../../VERSION"), "utf8",
).trim();

test("the app banner displays the installed starter version", async ({ page }) => {
  await page.goto("/components/button");
  const banner = page.getByRole("status", { name: "Environment: development" });
  await expect(banner.getByRole("button")).toContainText(`starter v${platformVersion}`);
  await banner.hover();
  await expect(banner.getByText("starter", { exact: true })).toBeVisible();
  await expect(banner.getByText(`v${platformVersion}`, { exact: true })).toBeVisible();
});
