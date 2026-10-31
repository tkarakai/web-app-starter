import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { fillStable, markConvexLogPosition, signIn, signOut, toRelativeUrl, waitForAuthEmail } from "./helpers/auth";
import { createDisposableUser, disposableEmail, disposablePassword } from "./helpers/fixtures";
import { test as onboardingTest } from "./helpers/onboarding";

/** Open the organization page the way a user does: the account menu's Organization entry. */
async function openOrganizationPage(page: Page): Promise<void> {
  await page.bringToFront();
  await page.goto("/en/dashboard");
  await page.locator('[data-slot="sidebar-footer"] button').first().click();
  await page.getByRole("menuitem", { name: "Organization", exact: true }).click();
  await page.waitForURL(/\/dashboard\/organization$/);
  await expect(page.getByTestId("organization-settings")).toBeVisible();
}

async function renameOrganization(page: Page, name: string): Promise<void> {
  await openOrganizationPage(page);
  await page.getByLabel("Organization name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByTestId("organization-settings").getByText(name, { exact: true }).first()).toBeVisible();
}

/** Invite an address from the organization page; returns the emailed link. */
async function invite(page: Page, email: string): Promise<string> {
  await openOrganizationPage(page);
  const logPosition = markConvexLogPosition();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByTestId("organization-invitations").getByText(email)).toBeVisible();
  const url = toRelativeUrl(await waitForAuthEmail("custom", logPosition));
  expect(url).toMatch(/^\/accept-invitation\//);
  return url;
}

async function withPage<T>(browser: Browser, run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext();
  try {
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
}

test("an invited teammate signs in from the link, joins, shares the organization's projects and loses access when removed", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const owner = await createDisposableUser();
  const teammate = await createDisposableUser();
  const organization = `Org ${randomUUID().slice(0, 8)}`;

  await signIn(page, owner.email, owner.password);
  await renameOrganization(page, organization);
  await page.goto("/en/dashboard");
  await page.getByTitle("New project", { exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Shared roadmap");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shared roadmap", level: 1 })).toBeVisible();
  const invitationUrl = await invite(page, teammate.email);

  await withPage(browser, async (teammatePage) => {
    // Signed out, the link reveals nothing; after signing in, the teammate is brought back to it.
    await teammatePage.goto(invitationUrl);
    await expect(teammatePage.getByTestId("accept-invitation")).toHaveAttribute("data-state", "signedOut");
    await expect(teammatePage.getByText(organization)).toHaveCount(0);
    await signIn(teammatePage, teammate.email, teammate.password);
    await teammatePage.waitForURL(/\/accept-invitation\//);
    await expect(teammatePage.getByRole("heading", { name: `Join ${organization}` })).toBeVisible();
    await teammatePage.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await teammatePage.waitForURL(/\/dashboard$/);
    await expect(teammatePage.getByTestId("active-organization")).toHaveText(organization);
    await expect(teammatePage.getByRole("button", { name: "Shared roadmap" })).toBeVisible();

    // The spent link now just says they're a member.
    await teammatePage.goto(invitationUrl);
    await expect(teammatePage.getByTestId("accept-invitation")).toHaveAttribute("data-state", "member");

    // Switch to the personal organization (no projects) and back.
    await teammatePage.goto("/en/dashboard");
    await teammatePage.getByRole("button", { name: "Switch organization" }).click();
    await teammatePage.getByRole("menuitem", { name: "E2E User", exact: true }).click();
    await expect(teammatePage.getByTestId("active-organization")).toHaveText("E2E User");
    await expect(teammatePage.getByRole("button", { name: "Shared roadmap" })).toHaveCount(0);
    await teammatePage.getByRole("button", { name: "Switch organization" }).click();
    await teammatePage.getByRole("menuitem", { name: organization, exact: true }).click();
    await expect(teammatePage.getByRole("button", { name: "Shared roadmap" })).toBeVisible();

    // The owner removes them; the teammate's view drops the organization live and says why.
    await openOrganizationPage(page);
    const members = page.getByTestId("organization-members");
    await expect(members.getByText(teammate.email, { exact: false })).toBeVisible();
    await members.getByRole("button", { name: /^Remove / }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();
    await expect(members.getByText(teammate.email, { exact: false })).toHaveCount(0);

    await expect(teammatePage.getByText(`You no longer have access to ${organization}.`)).toBeVisible();
    await expect(teammatePage.getByTestId("active-organization")).toHaveText("E2E User");
    await expect(teammatePage.getByRole("button", { name: "Shared roadmap" })).toHaveCount(0);
  });
});

test("an invitation answers only its own address; a declined one is spent and shows as declined; an owner can delete the organization", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const owner = await createDisposableUser();
  const invitee = await createDisposableUser();
  const stranger = await createDisposableUser();
  const organization = `Org ${randomUUID().slice(0, 8)}`;

  await signIn(page, owner.email, owner.password);
  await renameOrganization(page, organization);
  const invitationUrl = await invite(page, invitee.email);

  await withPage(browser, async (strangerPage) => {
    // Someone else who opens the link and signs in is told, kindly, that it isn't theirs.
    await strangerPage.goto(invitationUrl);
    await signIn(strangerPage, stranger.email, stranger.password);
    await strangerPage.waitForURL(/\/accept-invitation\//);
    const card = strangerPage.getByTestId("accept-invitation");
    await expect(card).toHaveAttribute("data-state", "wrongAccount");
    await expect(card).toContainText(`You're signed in as ${stranger.email}`);
    await expect(card).not.toContainText(organization);
    await expect(card).not.toContainText(invitee.email);
    await expect(strangerPage.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
    // The same when they open it while already signed in.
    await strangerPage.reload();
    await expect(card).toHaveAttribute("data-state", "wrongAccount");
  });

  await withPage(browser, async (inviteePage) => {
    // An existing user also finds the invitation on their dashboard.
    await signIn(inviteePage, invitee.email, invitee.password);
    await expect(inviteePage.getByTestId("organization-invitations-banner")).toContainText(`invited you to join ${organization}`);
    await inviteePage.goto(invitationUrl);
    await inviteePage.getByRole("button", { name: "Decline", exact: true }).click();
    await inviteePage.waitForURL(/\/dashboard$/);
    await inviteePage.goto(invitationUrl);
    await expect(inviteePage.getByTestId("accept-invitation")).toHaveAttribute("data-state", "invalid");
    await expect(inviteePage.getByText("This invitation is no longer valid")).toBeVisible();
  });

  // The inviter sees the answer, and can invite again.
  await openOrganizationPage(page);
  const declined = page.getByTestId("organization-invitations").locator('[data-status="declined"]');
  await expect(declined).toContainText(invitee.email);
  await expect(declined.getByRole("button", { name: "Invite again" })).toBeVisible();
  // Re-invite, then delete once: the older declined invitation must not reappear.
  await declined.getByRole("button", { name: "Invite again" }).click();
  const pending = page.getByTestId("organization-invitations").locator('[data-status="pending"]');
  await expect(pending).toContainText(invitee.email);
  await pending.getByRole("button", { name: `Delete the invitation to ${invitee.email}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("organization-invitations")).toHaveCount(0);

  // Deleting needs the name typed; the account stays signed in without an organization.
  await page.getByRole("button", { name: "Delete organization", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(`Type ${organization} to confirm`).fill(organization);
  await dialog.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByTestId("active-organization")).toHaveText("No organization");
  await expect(page.getByTestId("no-organization")).toBeVisible();
  await expect(page.getByText(`You no longer have access to ${organization}.`)).toHaveCount(0);
});

test("deleting the last organization keeps account controls and invitations, persists across sign-in, and allows joining or creating explicitly", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const owner = await createDisposableUser();
  const host = await createDisposableUser();
  const doomed = `Delete ${randomUUID().slice(0, 8)}`;
  const invited = `Join ${randomUUID().slice(0, 8)}`;
  const created = `Create ${randomUUID().slice(0, 8)}`;
  await signIn(page, owner.email, owner.password);
  await renameOrganization(page, doomed);
  await withPage(browser, async hostPage => {
    await signIn(hostPage, host.email, host.password);
    await renameOrganization(hostPage, invited);
    await invite(hostPage, owner.email);
  });

  await page.bringToFront();
  await page.getByRole("button", { name: "Delete organization", exact: true }).click();
  await page.getByRole("dialog").getByLabel(`Type ${doomed} to confirm`).fill(doomed);
  await page.getByRole("dialog").getByRole("button", { name: "Delete permanently", exact: true }).click();
  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByTestId("active-organization")).toHaveText("No organization");
  await expect(page.getByTestId("no-organization")).toBeVisible();
  await expect(page.getByTitle("New project", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Projects", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("organization-invitations-banner")).toContainText(invited);
  await page.getByRole("button", { name: "Switch organization" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await expect(page.getByRole("menuitem", { name: "Create organization" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator('[data-slot="sidebar-footer"] button').first().click();
  await expect(page.getByRole("menuitem", { name: "Organization", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dark theme", exact: true })).toBeVisible();
  const settings = page.getByRole("menuitem", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await settings.click();
  await page.waitForURL(/\/dashboard\/settings$/);
  await expect(page.getByRole("tab", { name: "Profile", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Security", exact: true })).toBeVisible();
  await expect(page.getByTestId("organization-invitations-banner")).toContainText(invited);
  await expect(page.locator("#profile-name")).toBeVisible();
  await page.getByRole("tab", { name: "Security", exact: true }).click();
  await expect(page.locator("#current-password")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("active-organization")).toHaveText("No organization");
  await signOut(page);
  await signIn(page, owner.email, owner.password);
  await expect(page.getByTestId("active-organization")).toHaveText("No organization");
  await page.getByTestId("organization-invitations-banner").getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByTestId("active-organization")).toHaveText(invited);
  await expect(page.getByTitle("New project", { exact: true })).toBeVisible();

  // A member can leave their only organization; another owner's organization survives.
  await openOrganizationPage(page);
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.getByTestId("active-organization")).toHaveText("No organization");
  await page.getByRole("button", { name: "Switch organization" }).click();
  await page.getByRole("menuitem", { name: "Create organization" }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(created);
  await page.getByRole("dialog").getByRole("button", { name: "Create organization", exact: true }).click();
  await expect(page.getByTestId("active-organization")).toHaveText(created);
  await expect(page.getByText("You're the only owner. Invite another owner and wait for them to accept before leaving.")).toBeVisible();
});

onboardingTest("a new person creates an account from the link while sign-up is closed, and comes back to it to join", async ({ page, browser, onboarding }) => {
  onboardingTest.setTimeout(150_000);
  await onboarding.setMode("inviteOnly");
  const owner = await createDisposableUser();
  const newcomer = { name: "New Person", email: disposableEmail(), password: disposablePassword() };
  const organization = `Org ${randomUUID().slice(0, 8)}`;

  const invitationUrl = await withPage(browser, async (ownerPage) => {
    await signIn(ownerPage, owner.email, owner.password);
    await renameOrganization(ownerPage, organization);
    return await invite(ownerPage, newcomer.email);
  });

  await page.goto(invitationUrl);
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await page.waitForURL(/\/sign-up\?invitation=/);
  await expect(page.getByTestId("organization-invitation-signup")).toBeVisible();
  await fillStable(page, "#name", newcomer.name);
  await fillStable(page, "#email", newcomer.email);
  await fillStable(page, "#password", newcomer.password);
  await fillStable(page, "#confirm-password", newcomer.password);
  const logPosition = markConvexLogPosition();
  await page.locator('form:has(#confirm-password) button[type="submit"]').click();
  await page.waitForURL(/\/(verify-email|dashboard|accept-invitation)/);

  // With email verification on, confirm the address, then sign in if the link didn't.
  if (page.url().includes("/verify-email")) {
    await page.goto(toRelativeUrl(await waitForAuthEmail("verification", logPosition)));
    await page.goto("/en/dashboard");
    if (page.url().includes("/sign-in")) await signIn(page, newcomer.email, newcomer.password);
  }
  await page.waitForURL(/\/accept-invitation\//);
  await expect(page.getByRole("heading", { name: `Join ${organization}` })).toBeVisible();
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByTestId("active-organization")).toHaveText(organization);
});

test("on a phone, choosing the page that is already open from the account menu still closes the drawer", async ({ page }) => {
  const user = await createDisposableUser();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, user.email, user.password);
  await page.goto("/en/dashboard/organization");
  await expect(page.getByTestId("organization-settings")).toBeVisible();

  const drawer = page.locator('[data-sidebar="sidebar"][data-mobile="true"]');
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(drawer).toBeVisible();
  await drawer.locator('[data-slot="sidebar-footer"] button').first().click();
  await expect(page.getByRole("menuitem", { name: "Language" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Organization", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByTestId("organization-settings")).toBeVisible();
});
