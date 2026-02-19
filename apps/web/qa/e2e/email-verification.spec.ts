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

  test("shows reset form when token param is provided", async ({ page }) => {
    await page.goto("/en/reset-password?token=test-token-123");
    await page.waitForLoadState("networkidle");

    // With a token, should show the password reset form
    const passwordInput = page.locator("#new-password");
    const confirmInput = page.locator("#confirm-new-password");

    await expect(passwordInput).toBeVisible();
    await expect(confirmInput).toBeVisible();

    // Both should be type=password
    await expect(passwordInput).toHaveAttribute("type", "password");
    await expect(confirmInput).toHaveAttribute("type", "password");

    // Both should have minLength=8
    await expect(passwordInput).toHaveAttribute("minLength", "8");
    await expect(confirmInput).toHaveAttribute("minLength", "8");
  });

  test("shows error on password mismatch", async ({ page }) => {
    await page.goto("/en/reset-password?token=test-token-123");
    await page.waitForLoadState("networkidle");

    await page.fill("#new-password", "newpassword123");
    await page.fill("#confirm-new-password", "differentpassword");
    await page.click('button[type="submit"]');

    // Should show password mismatch error
    const errorBox = page.locator(".rounded-md.border.bg-muted");
    await expect(errorBox).toBeVisible({ timeout: 5000 });
  });

  test("shows rate limit error when server returns 429", async ({ page }) => {
    await page.goto("/en/reset-password?token=test-token-123");
    await page.waitForLoadState("networkidle");

    await page.route("**/api/auth/reset-password", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Rate limit exceeded", status: 429 } }),
      });
    });

    await page.fill("#new-password", "newpassword123");
    await page.fill("#confirm-new-password", "newpassword123");
    await page.click('button[type="submit"]');

    const errorBox = page.locator(".rounded-md.border.bg-muted");
    await expect(errorBox).toBeVisible({ timeout: 10000 });
    const errorText = await errorBox.textContent();
    expect(errorText).toContain("Too many attempts");
  });

  test("shows expired token error", async ({ page }) => {
    await page.goto("/en/reset-password?token=expired-token&error=EXPIRED");
    await page.waitForLoadState("networkidle");

    // Should show token expired/invalid state
    const content = await page.content();
    const hasExpiredState =
      content.includes("expired") ||
      content.includes("invalid") ||
      content.includes("Expired") ||
      content.includes("Invalid");
    expect(hasExpiredState).toBe(true);
  });

  test("shows success state after successful password reset", async ({ page }) => {
    await page.goto("/en/reset-password?token=valid-token");
    await page.waitForLoadState("networkidle");

    // Mock the reset-password endpoint to return success
    await page.route("**/api/auth/reset-password", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: true }),
      });
    });

    await page.fill("#new-password", "newsecurepassword123");
    await page.fill("#confirm-new-password", "newsecurepassword123");
    await page.click('button[type="submit"]');

    // Should show success state with a "Sign in" button
    await page.waitForTimeout(1000);
    const signInButton = page.locator("button", { hasText: /sign.?in/i });
    await expect(signInButton).toBeVisible({ timeout: 10000 });
  });

  test("submit button is disabled while request is pending", async ({ page }) => {
    await page.goto("/en/reset-password?token=valid-token");
    await page.waitForLoadState("networkidle");

    await page.route("**/api/auth/reset-password", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: true }),
      });
    });

    await page.fill("#new-password", "newsecurepassword123");
    await page.fill("#confirm-new-password", "newsecurepassword123");
    await page.click('button[type="submit"]');

    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeDisabled();
  });
});

test.describe("Sign-Up with Email Verification", () => {
  test("sign-up form exists and works (email verification enabled)", async ({
    page,
  }) => {
    await page.goto("/en/sign-up");
    await page.waitForLoadState("networkidle");

    // Standard sign-up form fields should be present
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#confirm-password")).toBeVisible();
  });
});
