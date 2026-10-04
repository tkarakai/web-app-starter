import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import en from "@web-app-starter/i18n/messages/en.json";
import hu from "@web-app-starter/i18n/messages/hu.json";
import { api } from "@repo/backend";
import { createDisposableUser, disposableEmail } from "./helpers/fixtures";

// This spec changes onboarding briefly and restores it. Run with the supported CI=true single worker.
test("sign-in → sign-up accepts waitlist email inline in both locales, then respects mode changes", async ({ page, request }) => {
  const admin = await createDisposableUser({ isAdmin: true });
  const signedIn = await request.post("/api/auth/sign-in/email", { data: admin, headers: { Origin: test.info().project.use.baseURL! } });
  expect(signedIn.ok(), await signedIn.text()).toBe(true);
  const tokenResponse = await request.get("/api/auth/convex/token");
  expect(tokenResponse.ok()).toBe(true);
  const { token } = await tokenResponse.json() as { token: string };
  const env = readFileSync(resolve(__dirname, "../../.env.local"), "utf8");
  const convexUrl = process.env.CONVEX_URL ?? env.match(/^CONVEX_URL=(.+)$/m)?.[1]?.trim();
  if (!convexUrl) throw new Error("CONVEX_URL is required for the onboarding fixture");
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  const previous = await client.query(api.platform.appSettings.get, { key: "onboardingType" });
  const emails: string[] = [];
  try {
    await client.mutation(api.platform.appSettings.set, { key: "onboardingType", value: "publicWaitlist" });
    for (const locale of ["en", "hu"]) {
      await page.goto(`/${locale}/sign-in`);
      await page.getByRole("button", { name: `${(locale === "en" ? en : hu).auth.signIn.switchPrompt} ${(locale === "en" ? en : hu).auth.signIn.switchLink}` }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/sign-up`));
      await expect(page.locator("#waitlist-email")).toBeVisible();
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      const email = disposableEmail();
      emails.push(email);
      await page.locator("#waitlist-email").fill(email);
      await page.locator('form:has(#waitlist-email) button[type="submit"]').click();
      await expect(page.locator("#waitlist-email")).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/${locale}/sign-up`));
      const entries = await client.query(api.platform.waitlist.list, { paginationOpts: { numItems: 100, cursor: null } });
      expect(entries.page.some(entry => entry.email === email)).toBe(true);
    }
    await client.mutation(api.platform.appSettings.set, { key: "onboardingType", value: "publicSignup" });
    await page.goto("/en/sign-up");
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    await expect(page.locator("#waitlist-email")).toHaveCount(0);
    await client.mutation(api.platform.appSettings.set, { key: "onboardingType", value: "inviteOnly" });
    await page.goto("/hu/sign-up");
    await expect(page.locator("main a[href='/hu/sign-in']")).toBeVisible();
    await expect(page.locator("#waitlist-email")).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  } finally {
    await client.mutation(api.platform.appSettings.set, { key: "onboardingType", value: typeof previous === "string" ? previous : "inviteOnly" });
    const entries = await client.query(api.platform.waitlist.list, { paginationOpts: { numItems: 100, cursor: null } });
    for (const entry of entries.page.filter(entry => emails.includes(entry.email))) {
      await client.mutation(api.platform.waitlist.remove, { entryId: entry._id });
    }
  }
});
