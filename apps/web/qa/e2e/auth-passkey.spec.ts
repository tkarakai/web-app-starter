import { expect, test, type CDPSession, type Page } from "@playwright/test";

import {
  openSecurityTab,
  fillStable,
  expectSignedIn,
  signIn,
  signOut,
  submitEmailStep,
  throttleSignIn,
} from "./helpers/auth";
import { createDisposableUser } from "./helpers/fixtures";

/**
 * Passkey (WebAuthn) E2E Tests
 *
 * Driven by Chrome DevTools Protocol's virtual authenticator, so registration
 * and assertion run through the real `@better-auth/passkey` plugin and the real
 * browser WebAuthn API — no mocking, and no physical key needed in CI.
 *
 * The default `userPasskeyPolicy` is `optional` (`securityPolicies.ts`), so the
 * passkey section renders without any admin setup.
 *
 * Previously quarantined because these mutate the shared dev-seed account and a
 * mid-flow failure stranded credentials on it. Each test now mints its own
 * disposable account, so nothing needs restoring.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

/**
 * Attach a virtual platform authenticator with user verification already
 * satisfied, so registration and assertion complete without a UI prompt.
 */
async function addVirtualAuthenticator(page: Page, es256Only = false): Promise<{ client: CDPSession; id: string }> {
  if (es256Only) {
    // Chromium can prefer Ed25519. Select the server-advertised ES256 option
    // while delegating creation and signing to the real browser authenticator.
    await page.addInitScript(() => {
      const create = navigator.credentials.create.bind(navigator.credentials);
      navigator.credentials.create = (options) => {
        if (options?.publicKey) {
          options.publicKey.pubKeyCredParams = options.publicKey.pubKeyCredParams.filter(
            parameter => parameter.alg === -7,
          );
        }
        return create(options);
      };
    });
  }
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");

  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  return { client, id: authenticatorId };
}

/** Register a passkey from the security tab and return its label. */
async function registerPasskey(page: Page, name: string): Promise<void> {
  await openSecurityTab(page, "passkeys");

  await expect(page.locator("#new-passkey-name")).toBeVisible({ timeout: 20_000 });
  await fillStable(page, "#new-passkey-name", name);
  await page.getByRole("button", { name: /^add/i }).first().click();

  // Registration adds a factor; sensitive settings now require its current-session proof.
  const verifyPasskey = page.getByRole("button", { name: "Use a passkey", exact: true });
  await expect(verifyPasskey).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(name)).not.toBeVisible();
  await verifyPasskey.click();
  await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });
}

/** Delete the fixture credential after the remounted list finishes loading. */
async function deletePasskey(page: Page, name: string): Promise<void> {
  await openSecurityTab(page, "passkeys");
  const deleteButton = page.getByRole("button", { name: `Delete passkey ${name}`, exact: true });
  await expect(deleteButton).toBeVisible({ timeout: 20_000 });
  const deleted = page.waitForResponse(response => response.url().endsWith("/passkey/delete-passkey"));
  await deleteButton.click();
  expect((await deleted).status()).toBe(200);
}

test.describe("Passkey registration and sign-in", () => {
  test("registers a passkey and lists it in settings", async ({ page }) => {
    await addVirtualAuthenticator(page);
    const user = await createDisposableUser();
    await signIn(page, user.email, user.password);

    await registerPasskey(page, "E2E Virtual Key");

    // A reload resets the inner security tabs to Password — the sub-tab is not
    // deep-linkable — so re-open Passkeys before asserting on the list.
    await page.reload();
    await openSecurityTab(page, "passkeys");
    await expect(page.getByText("E2E Virtual Key")).toBeVisible({ timeout: 20_000 });
  });

  test("signs in with a passkey instead of a password", async ({ page }) => {
    const { client, id: authenticatorId } = await addVirtualAuthenticator(page);
    const user = await createDisposableUser();
    await signIn(page, user.email, user.password);
    await registerPasskey(page, "E2E Sign-in Key");

    // Registration must have produced a real credential in the authenticator.
    const { credentials } = await client.send("WebAuthn.getCredentials", { authenticatorId });
    expect(credentials.length, "registration should store a credential").toBeGreaterThan(0);

    await signOut(page);

    // The credential is held by the virtual authenticator bound to this page's
    // CDP session, so the assertion has to happen in this same page.
    await throttleSignIn();
    await submitEmailStep(page, user.email);

    const passkeyButton = page.getByRole("button", { name: /passkey/i }).first();
    await expect(passkeyButton).toBeVisible({ timeout: 15_000 });
    await passkeyButton.click();

    await expectSignedIn(page);
  });

  test("renames a passkey", async ({ page }) => {
    await addVirtualAuthenticator(page);
    const user = await createDisposableUser();
    await signIn(page, user.email, user.password);
    await registerPasskey(page, "Before Rename");

    await page.getByRole("button", { name: /rename|edit/i }).first().click();

    // Not `input[value="..."]`: the attribute selector stops matching the moment
    // the field is cleared, so the locator cannot be re-resolved mid-edit.
    // fillStable also retries — the row re-renders on entering edit mode and can
    // pull focus back to the Rename button mid-keystroke.
    await expect(page.getByLabel("Passkey name").first()).toBeVisible({ timeout: 15_000 });
    await fillStable(page, 'input[aria-label="Passkey name"]', "After Rename");

    // Exact: the row's pencil button is also named "Rename passkey ...", and it
    // comes first in the DOM, so a loose /rename/i match would re-open the editor.
    await page.getByRole("button", { name: "Save changes", exact: true }).first().click();

    await expect(page.getByText("After Rename")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Before Rename")).toHaveCount(0);
  });

  test("deletes a passkey and it can no longer sign in", async ({ page }) => {
    await addVirtualAuthenticator(page);
    const user = await createDisposableUser();
    await signIn(page, user.email, user.password);
    await registerPasskey(page, "Doomed Key");

    await deletePasskey(page, "Doomed Key");

    // Deleting the credential used by this session invalidates its passkey proof.
    const password = page.getByLabel("Current password", { exact: true }).filter({ visible: true });
    await expect(password).toBeVisible({ timeout: 20_000 });
    await password.fill(user.password);
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByRole("tablist").nth(1)).toBeVisible({ timeout: 20_000 });

    // A reload resets the inner security tabs to Password — the sub-tab is not
    // deep-linkable — so re-open Passkeys before asserting on the list.
    await page.reload();
    await openSecurityTab(page, "passkeys");
    await expect(page.getByText("Doomed Key")).toHaveCount(0);

    // With no registered passkey, the account falls back to password auth.
    await signOut(page);
    await throttleSignIn();
    await submitEmailStep(page, user.email);
    await expect(page.locator("#password")).toBeVisible({ timeout: 15_000 });
  });

  test("authenticates a browser ES256 passkey through the settings gate", async ({ page }) => {
    await addVirtualAuthenticator(page, true);
    const user = await createDisposableUser();
    await signIn(page, user.email, user.password);
    await registerPasskey(page, "E2E ES256 Key");
  });
});
