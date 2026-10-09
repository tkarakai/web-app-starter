import { expect, type Page } from "@playwright/test";
import { fillOtp, generateTotp, awaitStableTotpWindow, markConvexLogPosition, waitForAuthEmail } from "./customer-auth.ts";

export async function addOrganizationAuthenticator(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
}

/** Real enrollment UI; no role, assurance, enrollment receipt or membership fixture patch. */
export async function completeOrganizationEnrollment(page: Page, password: string) {
  await page.locator("#organization-password").fill(password);
  await page.locator("form:has(#organization-password)").getByRole("button", { name: "Verify", exact: true }).click();
  await page.getByRole("button", { name: "Enable 2FA", exact: true }).click();
  await page.locator("[id='2fa-password']").fill(password);
  await page.locator("form:has([id='2fa-password']) button[type='submit']").click();
  const manual = page.getByRole("button", { name: "Can't scan? Enter this key manually", exact: true });
  await expect(manual).toBeVisible({ timeout: 20_000 }); await manual.click();
  const secretField = page.locator("code, [class*='font-mono']").filter({ hasText: /^[A-Z2-7\s]{16,}$/ }).first();
  await expect(secretField).toBeVisible();
  const secret = (await secretField.innerText()).replace(/\s/g, "");
  await awaitStableTotpWindow(); await fillOtp(page, generateTotp(secret));
  const codes = page.locator('[data-slot="copyable-field"] pre').first();
  await expect(codes).toBeVisible({ timeout: 20_000 });
  const backupCodes = (await codes.innerText()).split("\n").map(code => code.trim()).filter(Boolean);
  expect(backupCodes.length).toBeGreaterThanOrEqual(2);
  await page.locator("#organization-recovery-password").fill(password);
  await page.locator("#organization-code-one").fill(backupCodes[0]!);
  await page.locator("#organization-code-two").fill(backupCodes[1]!);
  await page.locator("form:has(#organization-code-two)").getByRole("button", { name: "Verify", exact: true }).click();
  const passkeyName = page.locator("#new-passkey-name");
  // The fixture keeps the deployed policy. Required policy gets a real WebAuthn ceremony.
  if (await passkeyName.isVisible()) {
    await passkeyName.fill("Organization security key");
    await page.getByRole("button", { name: "Add passkey", exact: true }).click();
    await expect(page.getByText("Organization security key", { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByText("Verify your identity", { exact: true }).first().click();
    await page.getByRole("button", { name: "Use a passkey", exact: true }).first().click();
  }
  await page.getByRole("checkbox").check();
  const complete = page.getByRole("button", { name: "Continue", exact: true });
  await expect(complete).toBeEnabled({ timeout: 20_000 }); await complete.click();
  await expect(page.getByText("Members", { exact: true })).toBeVisible({ timeout: 20_000 });
  return { secret, backupCodes };
}

export async function issueOrganizationInvitation(page: Page, email: string) {
  const offset = markConvexLogPosition();
  await page.locator("#member-email").fill(email);
  await page.getByRole("button", { name: "Invite a member", exact: true }).click();
  const url = new URL(await waitForAuthEmail("custom", offset));
  expect(url.search).not.toContain("token"); expect(url.hash).toContain("token=");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  return `${url.pathname}${url.search}${url.hash}`;
}
