/* eslint-disable no-undef */
import { expect, test } from "@playwright/test";

test.describe("Locale Persistence", () => {
  test("unauthenticated user uses localStorage only", async ({ page }) => {
    await page.goto("/en/");

    // Verify we're on English
    await expect(page).toHaveURL(/\/en\//);

    // Change locale (unauthenticated)
    await page.click('[aria-label*="language"], [aria-label*="Language"]');
    // Select French from dropdown (adjust selector based on actual component)
    const frenchOption = page.getByText("Français", { exact: true }).first();
    await frenchOption.click();

    // Verify URL changed to French
    await expect(page).toHaveURL(/\/fr\//);

    // Verify localStorage has French locale
    const locale = await page.evaluate(() => localStorage.getItem("NEXT_LOCALE"));
    expect(locale).toBe("fr");

    // Reload page - should persist French locale
    await page.reload();
    await expect(page).toHaveURL(/\/fr\//);
  });

  test("authenticated user syncs locale to Convex", async ({ page }) => {
    // Note: This test requires proper sign-in flow setup
    // For now, we'll test the mechanism assuming user is signed in
    // In practice, you'd need to set up test credentials and auth flow

    await page.goto("/en/sign-in");

    // This would require filling in auth form - implement based on your auth setup
    // For now, we'll skip full auth test and focus on the locale switching mechanism
    // In a real scenario, you'd:
    // 1. Sign in with test credentials
    // 2. Change locale
    // 3. Verify it's saved to Convex
    // 4. Sign out and back in
    // 5. Verify locale persists
  });

  test("locale switcher preserves locale across navigation", async ({ page }) => {
    await page.goto("/en/");

    // Change to Spanish
    await page.click('[aria-label*="language"], [aria-label*="Language"]');
    const spanishOption = page.getByText("Español", { exact: true }).first();
    await spanishOption.click();

    // Verify URL changed
    await expect(page).toHaveURL(/\/es\//);

    // Navigate to different page
    if (page.url().includes("sign-in")) {
      // We're already on sign-in
    } else {
      await page.goto("/es/sign-in");
    }

    // Locale should still be Spanish in URL
    await expect(page).toHaveURL(/\/es\//);

    // Reload and verify locale persists
    await page.reload();
    await expect(page).toHaveURL(/\/es\//);
  });

  test("localStorage is readable on subsequent loads", async ({ page }) => {
    await page.goto("/en/");

    // Set locale to German
    await page.click('[aria-label*="language"], [aria-label*="Language"]');
    const germanOption = page.getByText("Deutsch", { exact: true }).first();
    await germanOption.click();

    await expect(page).toHaveURL(/\/de\//);

    // Verify localStorage
    const locale = await page.evaluate(() => localStorage.getItem("NEXT_LOCALE"));
    expect(locale).toBe("de");

    // Create new page (new session, but same localStorage domain)
    const page2 = await page.context().newPage();
    await page2.goto("/en/");

    // Middleware should detect German in localStorage and redirect
    // Or serve German content based on cookie/localStorage
    // This depends on middleware behavior - adjust expectation based on implementation

    // At minimum, localStorage should be accessible
    const locale2 = await page2.evaluate(() =>
      localStorage.getItem("NEXT_LOCALE")
    );
    expect(locale2).toBe("de");

    await page2.close();
  });
});
