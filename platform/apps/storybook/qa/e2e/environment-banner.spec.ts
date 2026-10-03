import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const platformVersion = readFileSync(
  join(__dirname, "../../../../VERSION"), "utf8",
).trim();

test("the app banner displays the installed starter version", async ({ page }) => {
  await page.goto("/components/button");
  const banner = page.getByRole("status", { name: "Environment: development" });
  const trigger = banner.getByRole("button", { name: /^DEV/ });
  await expect(trigger).toContainText(`starter v${platformVersion}`);
  await trigger.focus();
  await trigger.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(banner.getByText("starter", { exact: true })).toBeVisible();
  await expect(banner.getByText(`v${platformVersion}`, { exact: true })).toBeVisible();
});
