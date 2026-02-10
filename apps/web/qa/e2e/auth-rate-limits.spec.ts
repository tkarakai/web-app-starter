import { test, expect } from "@playwright/test";

/**
 * Auth Rate Limit E2E Tests
 *
 * Verify that the sign-in/sign-up forms handle rate limiting correctly:
 * - Better Auth rate limits: sign-in (3/10s), sign-up (5/60s)
 * - The UI shows a user-friendly rate limit message
 *
 * NOTE: These tests hit the real auth endpoints and may trigger actual
 * rate limits. They use unique emails to avoid side effects.
 */

test.describe("Sign-In Rate Limiting", () => {
  test("shows rate limit error when server returns 429", async ({
    page,
  }) => {
    await page.goto("/en/sign-in");
    await expect(page.locator("#email")).toBeVisible();

    // Mock the auth endpoint to return a 429 rate limit response
    await page.route("**/api/auth/sign-in/email", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ message: "Rate limit exceeded" }),
      });
    });

    await page.fill("#email", "ratelimit-test@example.com");
    await page.fill("#password", "wrongpassword");
    await page.click('button[type="submit"]');

    // The UI should show the user-friendly rate limit message
    const errorBox = page.locator(".rounded-md.border.bg-muted");
    await expect(errorBox).toBeVisible({ timeout: 10000 });

    const errorText = await errorBox.textContent();
    expect(errorText).toBe("Too many attempts. Please wait a moment before trying again.");
  });

  test("rate limit error message does not expose internals", async ({
    page,
  }) => {
    await page.goto("/en/sign-in");
    await page.waitForLoadState("networkidle");

    // Even if rate limited, the message should be user-friendly
    // and not expose server details.
    for (let i = 0; i < 5; i++) {
      await page.fill("#email", "ratelimit-internal@example.com");
      await page.fill("#password", "wrong");
      await page.click('button[type="submit"]');
      await page.waitForTimeout(300);
    }

    const errorBox = page.locator(".rounded-md.border.bg-muted");
    if (await errorBox.isVisible()) {
      const text = await errorBox.textContent();
      // Should never expose server error details
      expect(text).not.toContain("429");
      expect(text).not.toContain("rate_limit");
      expect(text).not.toContain("Too Many Requests");
      expect(text).not.toContain("x-forwarded-for");
    }
  });
});

test.describe("Sign-In Form Security", () => {
  test("submit button is disabled while request is pending", async ({
    page,
  }) => {
    await page.goto("/en/sign-in");
    await page.waitForLoadState("networkidle");

    await page.fill("#email", "pending-test@example.com");
    await page.fill("#password", "somepassword123");

    // Intercept the auth request to delay it
    await page.route("**/api/auth/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });

    await page.click('button[type="submit"]');

    // Button should be disabled while pending
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeDisabled();
  });

  test("error is cleared when form is resubmitted", async ({ page }) => {
    await page.goto("/en/sign-in");
    await expect(page.locator("#email")).toBeVisible();

    // First attempt: trigger an error
    await page.fill("#email", "error-clear@example.com");
    await page.fill("#password", "wrong");
    await page.click('button[type="submit"]');

    const errorBox = page.locator(".rounded-md.border.bg-muted");
    await expect(errorBox).toBeVisible({ timeout: 10000 });

    // Intercept the next request to hold it pending so we can observe
    // the error being cleared before a new response arrives
    await page.route("**/api/auth/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });

    // Second attempt: error should be cleared during submission
    await page.fill("#password", "anotherpassword");
    await page.click('button[type="submit"]');

    // While the request is pending, the old error should be hidden
    await expect(errorBox).not.toBeVisible({ timeout: 2000 });
  });
});
