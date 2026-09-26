import { expect, test } from "@playwright/test";

import {
  awaitStableTotpWindow,
  fillStable,
  generateTotp,
  openSecurityTab,
  signInAsAdmin,
} from "./helpers/auth";

/**
 * Admin 2FA enrolment E2E.
 *
 * The admin app has its own 2FA UI (`admin-two-factor-section.tsx`) and had no
 * E2E coverage at all — its specs were smoke, sessions and MFA policy. That gap
 * hid a real bug for as long as it existed: the component read `backupCodes`
 * off the `verifyTotp` response, which never carries them, and unconditionally
 * overwrote the state with `[]`. Better Auth returns the codes from
 * `/two-factor/enable`. An admin who enrolled therefore ended up with 2FA
 * enforced and zero recovery codes — on the highest-privilege accounts in the
 * system.
 *
 * TOTP codes are computed in-process from the secret the enrolment screen
 * renders for manual entry, so this suite does not depend on the library it is
 * testing.
 *
 * Serial: enrolment is slow and rate-limited, and the auth throttles are
 * per-process. Run with `--workers=1`.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("Admin TOTP enrolment", () => {
  test("issues a non-empty, de-duplicated set of backup codes", async ({ page }) => {
    const user = await signInAsAdmin(page);

    await openSecurityTab(page, "2fa");

    // idle -> password-enable
    await page
      .getByRole("button", { name: "Enable two-factor authentication", exact: true })
      .click();
    await expect(page.locator("#admin-2fa-enable-password")).toBeVisible({ timeout: 15_000 });

    await fillStable(page, "#admin-2fa-enable-password", user.password);
    await page
      .locator('form:has(#admin-2fa-enable-password) button[type="submit"]')
      .click();

    // password-enable -> totp-uri. The base32 secret sits behind a "Manual setup
    // key" collapsible and is not in the DOM until it is expanded.
    const manualKey = page.getByRole("button", { name: /manual setup key/i });
    await expect(manualKey).toBeVisible({ timeout: 20_000 });
    await manualKey.click();

    const secretField = page.locator('[data-slot="totp-secret"]');
    await expect(secretField).toBeVisible({ timeout: 20_000 });

    // Authenticator apps tolerate grouping whitespace; the algorithm does not.
    const secret = ((await secretField.textContent()) ?? "").replace(/\s/g, "");
    expect(secret, "the TOTP secret should be rendered for manual entry").toMatch(
      /^[A-Z2-7]{16,}$/,
    );

    // totp-uri -> verify-code
    await page.getByRole("button", { name: "Continue to verification", exact: true }).click();
    await expect(page.locator("#admin-2fa-code")).toBeVisible({ timeout: 15_000 });

    await awaitStableTotpWindow();
    await fillStable(page, "#admin-2fa-code", generateTotp(secret));
    await page.locator('form:has(#admin-2fa-code) button[type="submit"]').click();

    // verify-code -> backup-codes. These are shown exactly once.
    const codesPanel = page.locator('[data-slot="backup-codes"]');
    await expect(codesPanel).toBeVisible({ timeout: 20_000 });

    const backupCodes = (await codesPanel.locator("code").allTextContents())
      .map((value) => value.trim())
      .filter(Boolean);

    // The regression this spec exists for: enrolment used to render this panel
    // empty, so the assertion is on the codes themselves, not on the panel.
    expect(
      backupCodes.length,
      "enrolment must issue backup codes — without them 2FA is enforced with no recovery path",
    ).toBeGreaterThan(0);

    // A duplicate would silently halve the recovery set.
    expect(new Set(backupCodes).size).toBe(backupCodes.length);

    for (const code of backupCodes) {
      expect(code).not.toHaveLength(0);
    }
  });
});
