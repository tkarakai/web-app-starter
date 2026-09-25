import { expect, test } from "@playwright/test";
import french from "@repo/i18n/messages/fr.json";
import arabic from "@repo/i18n/messages/ar.json";

test("French sign-in renders the multi-step messages rather than missing keys", async ({ page }) => {
  await page.goto("/fr/sign-in");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("button", { name: french.auth.multiStep.emailStep.continue, exact: true })).toBeVisible();
  await expect(page.getByText(french.auth.multiStep.emailStep.title, { exact: true }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("auth.multiStep.");
});

test("Arabic reset-password labels remain localized when toggling password visibility", async ({ page }) => {
  await page.goto("/ar/reset-password?token=localization-check");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const password = page.locator("#new-password");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: arabic.common.showPassword }).first().click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: arabic.common.hidePassword })).toBeVisible();
});
