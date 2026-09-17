/**
 * Authenticated E2E helpers for the admin app.
 *
 * Admin specs used to "authenticate" by planting a fabricated
 * `better-auth.session_token` cookie. That satisfies the proxy, which only
 * checks the cookie is present, but not the dashboard layout, which validates
 * the session server-side — so every such test actually landed on /sign-in.
 * Strict assertions failed; lenient ones passed vacuously, which is worse.
 *
 * These helpers sign in for real against a disposable admin account.
 *
 * @module qa/e2e/helpers/auth
 */

import { createHmac } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { createDisposableUser, type DisposableUser } from "./fixtures";

/**
 * Type into a controlled input and confirm the value stuck.
 *
 * `locator.fill()` sets the value and fires one synthetic event, which these
 * controlled components discard — the field reads back empty and the submit
 * silently does nothing. `pressSequentially` sends real key events.
 */
export async function fillStable(page: Page, selector: string, value: string): Promise<void> {
  await page.bringToFront();

  const field = page.locator(selector);
  await field.waitFor({ state: "visible", timeout: 15_000 });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await field.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await field.pressSequentially(value, { delay: 15 });

    if ((await field.inputValue()) === value) return;
    await page.waitForTimeout(250);
  }

  throw new Error(`Could not get "${selector}" to hold its value after 3 attempts`);
}

/**
 * Sign in as a freshly minted admin. Sign-in is a two-step form: the email step
 * must be submitted before #password exists.
 */
export async function signInAsAdmin(page: Page): Promise<DisposableUser> {
  const user = await createDisposableUser({ isAdmin: true });

  await page.goto("/sign-in");
  await fillStable(page, "#email", user.email);
  await page.locator('form:has(#email) button[type="submit"]').click();

  await expect(page.locator("#password")).toBeVisible({ timeout: 15_000 });
  await fillStable(page, "#password", user.password);
  await page.locator('form:has(#password) button[type="submit"]').click();

  await page.waitForURL((url) => !url.pathname.includes("/sign-in"), { timeout: 20_000 });

  // The credentials are the caller's only way back into password-gated flows
  // (2FA enable/disable, backup-code regeneration) — there is no other copy.
  return user;
}

// ---------------------------------------------------------------------------
// Settings navigation
// ---------------------------------------------------------------------------

export const SECURITY_TABS = ["password", "2fa", "passkeys", "sessions"] as const;
export type SecurityTab = (typeof SECURITY_TABS)[number];

/**
 * Open a tab of the Security card on /settings.
 *
 * There are two nested tab layers and both read the same `?tab=` query param,
 * so the inner one cannot be deep-linked: `?tab=security` selects the outer
 * Security tab and leaves the inner layer on its "password" default. Radix
 * unmounts inactive `TabsContent`, so the inner triggers do not exist until the
 * outer tab is active — the outer click has to come first.
 */
export async function openSecurityTab(page: Page, tab: SecurityTab): Promise<void> {
  await page.bringToFront();
  if (!page.url().includes("/settings")) {
    await page.goto("/settings?tab=security");
  }

  const outer = page.getByRole("tab", { name: "Security", exact: true });
  await expect(outer).toBeVisible({ timeout: 20_000 });
  await outer.click();
  await expect(outer).toHaveAttribute("data-state", "active", { timeout: 10_000 });

  const inner = page.getByRole("tab", { name: TAB_LABELS[tab], exact: true });
  await expect(inner).toBeVisible({ timeout: 20_000 });
  await inner.click();
  await expect(inner).toHaveAttribute("data-state", "active", { timeout: 10_000 });
}

const TAB_LABELS: Record<SecurityTab, string> = {
  password: "Password",
  "2fa": "Two-factor",
  passkeys: "Passkeys",
  sessions: "Sessions",
};

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------
// Ported from apps/web/qa/e2e/helpers/auth.ts. Deliberately dependency-free:
// pulling an OTP package in would mean testing the auth stack with the auth
// stack.

/** Decode an RFC 4648 base32 string (no padding) into bytes. */
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");

  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of cleaned) {
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

/**
 * Compute the current 6-digit TOTP for a base32 secret, matching the
 * `twoFactor` plugin's configuration in `auth.ts` (SHA-1, 30s period, 6 digits).
 */
export function generateTotp(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", base32Decode(secret)).update(counterBuf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

/** Seconds remaining in the current TOTP window. */
export function totpSecondsRemaining(atMs: number = Date.now()): number {
  return 30 - (Math.floor(atMs / 1000) % 30);
}

/**
 * Wait for a fresh TOTP window if the current one is nearly over, so a code
 * cannot expire mid-request and read as a product failure.
 */
export async function awaitStableTotpWindow(minSeconds = 5): Promise<void> {
  const remaining = totpSecondsRemaining();
  if (remaining < minSeconds) {
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1000));
  }
}
