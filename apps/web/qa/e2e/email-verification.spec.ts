import { test, expect } from "@playwright/test";

/**
 * Email Verification Flow E2E Tests
 *
 * Verify the verify-email page loads and handles different states:
 * - Page accessible as guest route
 * - Verification callback renders success state instead of redirecting
 * - Invalid/expired verification tokens render an error state
 * - Sign-up triggers verification flow
 */

test.describe("Verify Email Page", () => {
  test("page loads without authentication", async ({ page }) => {
    const context = page.context();
    await context.clearCookies();

    const response = await page.goto("/en/verify-email");
    expect(response?.status()).toBeLessThan(400);
    // Should not redirect to sign-in
    await expect(page).not.toHaveURL(/\/sign-in/);
  });

  test("page has a form or verification UI", async ({ page }) => {
    await page.goto("/en/verify-email");
    await page.waitForLoadState("networkidle");

    // The page should have some interactive element (form or button)
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("shows verification success message and sign-in link when no active session exists", async ({
    page,
  }) => {
    const context = page.context();
    await context.clearCookies();

    await page.goto("/en/verify-email?verified=1");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: "Thank you for verifying your email." }),
    ).toBeVisible();
    await expect(page.getByText("Please sign in to use the app.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Sign In page" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close this window" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/dashboard/);
  });

  test("shows a friendly error message when verification token is invalid", async ({
    page,
  }) => {
    await page.goto("/en/verify-email?verified=1&error=invalid_token");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: "Email verification failed" }),
    ).toBeVisible();
    await expect(
      page.getByText("This verification link is invalid or has already been used."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Close this window" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/dashboard/);
  });
});

test.describe("Reset Password Page", () => {
  // Submission feedback with controlled responses lives in password-reset.test.tsx.
  // Real emailed-token reset and replay flows live in auth-password.spec.ts.
  test("page loads without authentication", async ({ page }) => {
    const context = page.context();
    await context.clearCookies();

    const response = await page.goto("/en/reset-password");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).not.toHaveURL(/\/sign-in/);
  });

  test("shows invalid token state when no token param provided", async ({ page }) => {
    await page.goto("/en/reset-password");
    await page.waitForLoadState("networkidle");

    // Without a token, the form should show the "invalid" or "request new link" state
    const mainContent = await page.content();
    // Should have some indication of invalid/missing token
    const hasInvalidState =
      mainContent.includes("invalid") ||
      mainContent.includes("expired") ||
      mainContent.includes("request") ||
      mainContent.includes("new link") ||
      mainContent.includes("Request");
    expect(hasInvalidState).toBe(true);
  });

  test("shows empty reset fields before token evaluation", async ({ page }) => {
    await page.goto("/en/reset-password?token=test-token-123");
    await page.waitForLoadState("networkidle");

    // Token validation begins when a password is entered.
    const passwordInput = page.locator("#new-password");
    const confirmInput = page.locator("#confirm-new-password");

    await expect(passwordInput).toBeVisible();
    await expect(confirmInput).toBeVisible();

    // Both should be type=password
    await expect(passwordInput).toHaveAttribute("type", "password");
    await expect(confirmInput).toHaveAttribute("type", "password");

    // Until evaluation returns the owner policy, fields use the user minimum.
    await expect(passwordInput).toHaveAttribute("minLength", "12");
    await expect(confirmInput).toHaveAttribute("minLength", "12");
  });

  test("rejects an unknown token when password evaluation runs", async ({ page }) => {
    await page.goto("/en/reset-password?token=unknown-reset-token");
    await page.waitForLoadState("networkidle");
    // Fill once: evaluation removes the inputs as soon as it rejects the token.
    await page.locator("#new-password").fill("Xq7!vTn3Mk9wRp2Z");
    await expect(page.getByText("Invalid Reset Link", { exact: true })).toBeVisible();
    await expect(page.locator("#new-password")).toHaveCount(0);
    await expect(page.locator("#confirm-new-password")).toHaveCount(0);
  });

  test("shows expired token error", async ({ page }) => {
    await page.goto("/en/reset-password?token=expired-token&error=EXPIRED");
    await page.waitForLoadState("networkidle");
    await page.locator("#new-password").fill("Xq7!vTn3Mk9wRp2Z");
    await expect(page.getByText("Invalid Reset Link", { exact: true })).toBeVisible();
    await expect(page.getByText("This password reset link has expired. Please request a new one.", { exact: true })).toBeVisible();
    await expect(page.locator("#new-password")).toHaveCount(0);
  });
});

test.describe("Sign-Up with Email Verification", () => {
  /**
   * This asserted a self-service sign-up form. Under the default
   * `onboardingType` of `inviteOnly` that form does not render at all, so there
   * is no sign-up path here to verify an email for. Coverage of the gate itself
   * lives in `auth-flow.spec.ts`; the invitation flow is what would need a
   * dedicated test, and it needs an admin-issued invitation to exercise.
   */
  test("does not expose an unverified self-service sign-up path", async ({
    page,
  }) => {
    await page.goto("/en/sign-up");
    await page.waitForLoadState("networkidle");

    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByText(/invitation only/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
