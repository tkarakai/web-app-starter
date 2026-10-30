import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { markConvexLogPosition, signIn, toRelativeUrl, waitForAuthEmail } from "./helpers/auth";
import { createDisposableUser } from "./helpers/fixtures";

async function openOrganizationSettings(page: Page): Promise<void> {
  await page.goto("/en/dashboard/settings?tab=organization");
  await expect(page.getByTestId("organization-settings")).toBeVisible();
}

test("an owner invites a teammate who joins, shares the organization's projects, switches back and loses access when removed", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const owner = await createDisposableUser();
  const teammate = await createDisposableUser();
  const organization = `Org ${randomUUID().slice(0, 8)}`;

  // The owner names their personal organization and creates a project in it.
  await signIn(page, owner.email, owner.password);
  await openOrganizationSettings(page);
  await page.getByLabel("Organization name", { exact: true }).fill(organization);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: organization, exact: true })).toBeVisible();

  await page.goto("/en/dashboard");
  await page.getByTitle("New project", { exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Shared roadmap");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shared roadmap", level: 1 })).toBeVisible();

  // Invite the teammate.
  await openOrganizationSettings(page);
  const logPosition = markConvexLogPosition();
  await page.getByLabel("Email address", { exact: true }).fill(teammate.email);
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByTestId("organization-invitations").getByText(teammate.email)).toBeVisible();
  const invitationUrl = toRelativeUrl(await waitForAuthEmail("custom", logPosition));
  expect(invitationUrl).toMatch(/^\/accept-invitation\//);

  // The teammate sees the invitation on their dashboard and accepts it from the email link.
  const teammateContext = await browser.newContext();
  const teammatePage = await teammateContext.newPage();
  try {
    await signIn(teammatePage, teammate.email, teammate.password);
    await expect(teammatePage.getByTestId("organization-invitations-banner"))
      .toContainText(`invited you to join ${organization}`);
    await expect(teammatePage.getByRole("button", { name: "Shared roadmap" })).toHaveCount(0);

    await teammatePage.goto(invitationUrl);
    await expect(teammatePage.getByRole("heading", { name: `Join ${organization}` })).toBeVisible();
    await teammatePage.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await teammatePage.waitForURL(/\/dashboard$/);
    await expect(teammatePage.getByTestId("active-organization")).toHaveText(organization);
    await expect(teammatePage.getByRole("button", { name: "Shared roadmap" })).toBeVisible();

    // Two organizations: the header is a switcher. The personal organization has no projects.
    await teammatePage.getByRole("button", { name: "Switch organization" }).click();
    await teammatePage.getByRole("menuitem", { name: "E2E User", exact: true }).click();
    await expect(teammatePage.getByTestId("active-organization")).toHaveText("E2E User");
    await expect(teammatePage.getByRole("button", { name: "Shared roadmap" })).toHaveCount(0);
    await teammatePage.getByRole("button", { name: "Switch organization" }).click();
    await teammatePage.getByRole("menuitem", { name: organization, exact: true }).click();
    await expect(teammatePage.getByRole("button", { name: "Shared roadmap" })).toBeVisible();

    // The owner sees the new member and removes them; the teammate's view loses the organization live.
    await page.reload();
    const members = page.getByTestId("organization-members");
    await expect(members.getByText(teammate.email, { exact: false })).toBeVisible();
    await members.getByRole("button", { name: /^Remove / }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();
    await expect(members.getByText(teammate.email, { exact: false })).toHaveCount(0);

    await expect(teammatePage.getByTestId("active-organization")).toHaveText("E2E User");
    await expect(teammatePage.getByRole("button", { name: "Shared roadmap" })).toHaveCount(0);
    await expect(teammatePage.getByRole("button", { name: "Switch organization" })).toHaveCount(0);
  } finally {
    await teammateContext.close();
  }
});
