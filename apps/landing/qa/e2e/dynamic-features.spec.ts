import { expect, test } from "@playwright/test";
import messages from "@repo/messages/en.json";
import { appConfig } from "@web-app-starter/app-config";

const text = messages.landing;
test.beforeEach(async ({ page }) => {
  await page.route("**/api/announcements/active", route => route.fulfill({ json: { announcement: null } }));
  await page.route("**/api/waitlist/status", route => route.fulfill({ json: { onboardingType: "inviteOnly" } }));
});

for (const mode of ["publicSignup", "inviteOnly"] as const) {
  test(`${mode} shows the correct localized web links`, async ({ page }) => {
    await page.route("**/api/waitlist/status", route => route.fulfill({ json: { onboardingType: mode } }));
    await page.goto("/en/");
    await expect(page.getByRole("link", { name: text.signIn, exact: true })).toHaveAttribute("href", /\/en\/sign-in$/);
    if (mode === "publicSignup") await expect(page.getByRole("link", { name: text.getStarted })).toHaveAttribute("href", /\/en\/sign-up$/);
    else await expect(page.getByRole("link", { name: text.getStarted })).toHaveCount(0);
    await expect(page.locator("#waitlist-email")).toHaveCount(0);
  });
}

test(appConfig.features.waitlist
  ? "inline waitlist submits sample answers directly from the browser"
  : "disabled waitlist stays closed despite a publicWaitlist backend response", async ({ page }) => {
  await page.route("**/api/waitlist/status", route => route.fulfill({ json: { onboardingType: "publicWaitlist" } }));
  let submitted: { email: string; meta: string } | undefined;
  await page.route("**/api/waitlist/join", route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { success: true } });
  });
  await page.goto("/en/");
  await expect(page.getByRole("link", { name: text.signIn, exact: true })).toHaveAttribute("href", /\/en\/sign-in$/);
  if (!appConfig.features.waitlist) {
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel(text.waitlist.emailLabel)).toHaveCount(0);
    await expect(page.getByLabel(text.waitlist.companyLabel)).toHaveCount(0);
    await expect(page.getByRole("button", { name: text.waitlist.submit, exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: text.getStarted })).toHaveCount(0);
    expect(submitted).toBeUndefined();
    return;
  }
  await page.getByLabel(text.waitlist.emailLabel).fill("Visitor@Example.com");
  await expect(page.getByRole("button", { name: text.waitlist.submit, exact: true })).toBeEnabled();
  await page.locator("#waitlist-superpowers").click();
  await page.getByRole("menuitemcheckbox", { name: text.waitlist.superpowers["coffee-to-code"], exact: true }).click();
  await page.keyboard.press("Escape");
  await page.locator("#waitlist-excitement").click();
  await page.getByRole("menuitemcheckbox", { name: text.waitlist.excitement["cant-wait"], exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByLabel(text.waitlist.companyLabel).fill("  Example Company  ");
  await page.getByLabel(text.waitlist.useCaseLabel).fill("  Plan a launch  ");
  await expect(page.getByRole("link", { name: "Terms of Service", exact: true }).first()).toHaveAttribute("href", /\/en\/terms\/?$/);
  await page.getByRole("button", { name: text.waitlist.submit, exact: true }).click();
  await expect(page.getByText(text.waitlist.successTitle, { exact: true })).toBeVisible();
  expect(submitted?.email).toBe("visitor@example.com");
  expect(JSON.parse(submitted!.meta)).toEqual({ superpowers: ["coffee-to-code"], excitement: ["cant-wait"], company: "Example Company", useCase: "Plan a launch" });
  await expect(page.getByRole("link", { name: text.waitlist.signIn, exact: true })).toHaveAttribute("href", /\/en\/sign-in$/);
});

test("a backend outage preserves marketing and sign-in, then recovers", async ({ page }) => {
  let available = false;
  await page.route("**/api/waitlist/status", route => available
    ? route.fulfill({ json: { onboardingType: "publicSignup" } })
    : route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/en/");
  await expect(page.getByText(text.fallback.title)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: text.signIn, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: text.getStarted })).toHaveCount(0);
  available = true;
  await expect(page.getByRole("link", { name: text.getStarted })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(text.fallback.title)).toHaveCount(0);
});

test(appConfig.features.announcements
  ? "announcements show details, reserve space, persist dismissal and show new announcements"
  : "disabled announcements expose no banner, details, or reserved space", async ({ page }) => {
  let announcement = {
    _id: "first", name: "Release", bannerText: "A new release is ready",
    callToActionName: "Explore release", callToActionUrl: "https://example.test/release",
    learnMoreName: "Read details", learnMoreContent: "<h1>Release details</h1>",
  };
  let announcementRequests = 0;
  await page.route("**/api/announcements/active", route => {
    announcementRequests++;
    return route.fulfill({ json: { announcement } });
  });
  await page.goto("/en/");
  const banner = page.getByRole("region", { name: "Announcement", exact: true });
  if (!appConfig.features.announcements) {
    // Sign-in appears after the onboarding effect settles, so absence is checked after hydration.
    await expect(page.getByRole("link", { name: text.signIn, exact: true })).toBeVisible();
    for (const destination of [undefined, "/en/about/"]) {
      if (destination) await page.goto(destination);
      await page.waitForLoadState("networkidle");
      await expect(banner).toHaveCount(0);
      await expect(page.getByText(announcement.bannerText, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Explore release" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Read details" })).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--announcement-banner-h"))).toBe("");
    }
    expect(announcementRequests).toBe(0);
    expect(await page.evaluate(() => window.localStorage.getItem("announcementDismissedPermanentId"))).toBeNull();
    return;
  }
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: "Explore release" })).toHaveAttribute("href", announcement.callToActionUrl);
  expect(await page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue("--announcement-banner-h")))).toBeGreaterThan(0);
  await banner.getByRole("button", { name: "Read details" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.frameLocator('iframe[title="Read details"]').getByRole("heading", { name: "Release details" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).first().click();
  await banner.getByRole("button", { name: "Dismiss announcement" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem("announcementDismissedPermanentId"))).toBe("first");
  announcement = { ...announcement, _id: "second", bannerText: "Another release is ready" };
  await expect(page.getByText(announcement.bannerText)).toBeVisible({ timeout: 20_000 });
  await page.goto("/en/about/");
  await expect(page.getByText(announcement.bannerText)).toBeVisible();
});
