import { test, expect } from "@playwright/test";

/**
 * Authentication Flow E2E Tests
 *
 * These tests verify the sign-in, sign-up, and sign-out flows work correctly
 * and that error handling prevents information leakage.
 *
 * NOTE: These tests require the dev server running with a real Convex backend.
 * Some tests create real user accounts — use unique emails per test run.
 */

const TEST_EMAIL_PREFIX = `e2e-auth-${Date.now()}`;

test.describe("Sign-In Flow", () => {
  test("shows generic error for wrong password (no email enumeration)", async ({
    page,
  }) => {
    await page.goto("/en/sign-in");
    await page.waitForLoadState("networkidle");

    await page.fill("#email", "nonexistent@example.com");
    await page.fill("#password", "wrongpassword123");
    await page.click('button[type="submit"]');

    // Wait for the error message to appear
    const errorBox = page.locator(".rounded-md.border.bg-muted");
    await expect(errorBox).toBeVisible({ timeout: 10000 });

    // Error must be generic — NOT "User not found" or similar
    const errorText = await errorBox.textContent();
    expect(errorText).toBe("Invalid email or password");
    expect(errorText).not.toContain("not found");
    expect(errorText).not.toContain("does not exist");
  });

  test("sign-in form has required email and password fields", async ({
    page,
  }) => {
    await page.goto("/en/sign-in");
    await page.waitForLoadState("networkidle");

    const emailInput = page.locator("#email");
    const passwordInput = page.locator("#password");

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    // Verify input types
    await expect(emailInput).toHaveAttribute("type", "email");
    await expect(passwordInput).toHaveAttribute("type", "password");

    // Verify required attribute
    await expect(emailInput).toHaveAttribute("required", "");
    await expect(passwordInput).toHaveAttribute("required", "");
  });

  test("unauthenticated user accessing /dashboard is redirected to /sign-in", async ({
    page,
  }) => {
    await page.goto("/en/dashboard");
    // Should end up on sign-in page
    await expect(page).toHaveURL(/\/en\/sign-in/);
  });

  test("password field is type=password (not plain text)", async ({ page }) => {
    await page.goto("/en/sign-in");
    await page.waitForLoadState("networkidle");

    const passwordInput = page.locator("#password");
    await expect(passwordInput).toHaveAttribute("type", "password");
  });
});

test.describe("Sign-Up Flow", () => {
  test("sign-up form enforces minimum password length", async ({ page }) => {
    await page.goto("/en/sign-up");
    await page.waitForLoadState("networkidle");

    const passwordInput = page.locator("#password");
    const confirmInput = page.locator("#confirm-password");

    // Both password fields should have minLength=8
    await expect(passwordInput).toHaveAttribute("minLength", "8");
    await expect(confirmInput).toHaveAttribute("minLength", "8");
  });

  test("sign-up form shows error on password mismatch", async ({ page }) => {
    await page.goto("/en/sign-up");
    await page.waitForLoadState("networkidle");

    await page.fill("#name", "Test User");
    await page.fill("#email", `${TEST_EMAIL_PREFIX}-mismatch@example.com`);
    await page.fill("#password", "password123");
    await page.fill("#confirm-password", "differentpassword");
    await page.click('button[type="submit"]');

    // Should show client-side password mismatch error
    const errorBox = page.locator(".rounded-md.border.bg-muted");
    await expect(errorBox).toBeVisible({ timeout: 5000 });
  });

  test("sign-up form has all required fields for new account", async ({
    page,
  }) => {
    await page.goto("/en/sign-up");
    await page.waitForLoadState("networkidle");

    // Sign-up requires name, email, password, confirm password
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#confirm-password")).toBeVisible();

    // All should be required
    await expect(page.locator("#name")).toHaveAttribute("required", "");
    await expect(page.locator("#email")).toHaveAttribute("required", "");
    await expect(page.locator("#password")).toHaveAttribute("required", "");
    await expect(page.locator("#confirm-password")).toHaveAttribute(
      "required",
      ""
    );
  });
});

test.describe("Auth Route Guards", () => {
  test("authenticated user accessing /sign-in is redirected to /dashboard", async ({
    page,
    context,
  }) => {
    // Set a session cookie to simulate an authenticated user.
    // The proxy layer checks cookie presence (not validity), so this
    // will trigger the redirect to /dashboard.
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: "fake-session-token",
        domain: "localhost",
        path: "/",
      },
    ]);

    // Intercept network to capture the redirect before Playwright follows it
    const redirectUrls: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 300 && response.status() < 400) {
        const location = response.headers()["location"];
        if (location) redirectUrls.push(location);
      }
    });

    await page.goto("/en/sign-in", { waitUntil: "commit" });

    // The proxy should issue a 307 redirect to /en/dashboard
    const dashboardRedirect = redirectUrls.some((url) =>
      url.includes("/dashboard")
    );
    expect(dashboardRedirect).toBe(true);
  });

  test("authenticated user accessing /sign-up is redirected to /dashboard", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: "fake-session-token",
        domain: "localhost",
        path: "/",
      },
    ]);

    const redirectUrls: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 300 && response.status() < 400) {
        const location = response.headers()["location"];
        if (location) redirectUrls.push(location);
      }
    });

    await page.goto("/en/sign-up", { waitUntil: "commit" });

    const dashboardRedirect = redirectUrls.some((url) =>
      url.includes("/dashboard")
    );
    expect(dashboardRedirect).toBe(true);
  });
});
