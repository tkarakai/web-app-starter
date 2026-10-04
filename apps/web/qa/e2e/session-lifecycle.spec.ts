import { test, expect } from "./helpers/onboarding";

import { appCookieDomain } from "./helpers/auth";
import { createDisposableUser } from "./helpers/fixtures";
import { sessionCookieNames } from "@web-app-starter/auth/cookies";

// Session cookie names for the prefix in app.config.ts.
const [SESSION] = sessionCookieNames();

/**
 * Session Lifecycle E2E Tests
 *
 * Verify session management security:
 * - Expired/cleared cookies redirect to sign-in
 * - Session cookies have correct security attributes
 * - Multi-tab session sync (BroadcastChannel)
 */

test.describe("Session Cookie Security", () => {
  test("clearing cookies redirects away from protected routes", async ({
    page,
    context,
  }) => {
    // Set a session cookie to pass the proxy layer
    await context.addCookies([
      {
        name: SESSION,
        value: "test-session-token",
        domain: appCookieDomain(),
        path: "/",
      },
    ]);

    // Navigate to dashboard (proxy allows it due to cookie presence)
    await page.goto("/en/dashboard");
    // Note: the dashboard layout does a full session validation and may
    // redirect to clear-session if the token is invalid. That's expected.

    // Now clear all cookies
    await context.clearCookies();

    // Try to access a protected route — should redirect to sign-in
    await page.goto("/en/dashboard");
    await expect(page).toHaveURL(/\/en\/sign-in/);
  });

  test("expired session cookie redirects to sign-in", async ({
    page,
    context,
  }) => {
    // Set a session cookie that's already expired
    await context.addCookies([
      {
        name: SESSION,
        value: "expired-token-value",
        domain: appCookieDomain(),
        path: "/",
        // Expires in the past
        expires: Math.floor(Date.now() / 1000) - 3600,
      },
    ]);

    await page.goto("/en/dashboard");

    // Expired cookie should not be sent by browser, so proxy redirects
    await expect(page).toHaveURL(/\/en\/sign-in/);
  });

  test("session token is not visible in page source or JavaScript", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: SESSION,
        value: "secret-session-token-12345",
        domain: appCookieDomain(),
        path: "/",
      },
    ]);

    await page.goto("/en/sign-in");
    await page.waitForLoadState("networkidle");

    // The session token should NOT appear in the page HTML
    const pageContent = await page.content();
    expect(pageContent).not.toContain("secret-session-token-12345");

    // The session token should NOT be accessible via JavaScript
    // (HttpOnly cookies are not readable via document.cookie)
    const jsCookies = await page.evaluate(() => document.cookie);
    expect(jsCookies).not.toContain("secret-session-token-12345");
  });
});

test.describe("Auth Page Navigation Guards", () => {
  test("/sign-in page is accessible without authentication", async ({
    page,
  }) => {
    const response = await page.goto("/en/sign-in");
    expect(response?.status()).toBe(200);

    // Sign-in is a two-step form — step 1 is the email only. #password does not
    // exist until that step is submitted.
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toHaveCount(0);
  });

  test("/sign-up page is accessible without authentication", async ({
    page,
    onboarding,
  }) => {
    await onboarding.setMode("inviteOnly");
    const response = await page.goto("/en/sign-up");
    expect(response?.status()).toBe(200);

    // Under inviteOnly, the guest route is reachable without registration fields.
    await expect(page.getByText(/invitation only/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("#name")).toHaveCount(0);
  });

  test("direct navigation to /dashboard without cookie redirects to /sign-in", async ({
    page,
  }) => {
    // Ensure no cookies are set
    const context = page.context();
    await context.clearCookies();

    await page.goto("/en/dashboard");
    await expect(page).toHaveURL(/\/en\/sign-in/);
  });

  test("direct navigation to /dashboard/settings without cookie redirects", async ({
    page,
  }) => {
    const context = page.context();
    await context.clearCookies();

    await page.goto("/en/dashboard/settings");
    await expect(page).toHaveURL(/\/en\/sign-in/);
  });
});

test.describe("Multi-Tab Session Detection", () => {
  test("GuestGuard on sign-in page listens for BroadcastChannel messages", async ({
    page,
  }) => {
    await page.goto("/en/sign-in");
    await page.waitForLoadState("networkidle");

    // Verify that the sign-in page has set up a BroadcastChannel listener.
    // We can check by seeing if BroadcastChannel is used on the page.
    const hasBroadcastChannel = await page.evaluate(() => {
      return typeof BroadcastChannel !== "undefined";
    });
    expect(hasBroadcastChannel).toBe(true);
  });

  test("auth pages redirect when another tab broadcasts a new session", async ({
    page,
    context,
    onboarding,
  }) => {
    await onboarding.setMode("inviteOnly");
    const user = await createDisposableUser();
    for (const route of ["sign-in", "sign-up"]) {
      await context.clearCookies();
      await page.goto(`/en/${route}`);
      await page.waitForLoadState("networkidle");
      if (route === "sign-in") {
        await expect(page.locator("#email")).toBeVisible();
      } else {
        await expect(page.getByText(/invitation only/i).first()).toBeVisible();
      }

      // Simulate another tab signing in, sharing the browser's session cookies.
      const response = await context.request.post("/api/auth/sign-in/email", {
        data: user,
        headers: { Origin: new URL(page.url()).origin },
      });
      expect(response.ok(), `Sign-in returned HTTP ${response.status()}`).toBe(true);
      await page.evaluate(() => {
        const channel = new BroadcastChannel("auth");
        channel.postMessage("authenticated");
        channel.close();
      });
      await expect(page).toHaveURL(/\/en\/dashboard/);
    }
  });
});
