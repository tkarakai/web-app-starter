import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@repo/backend";
import { signInAsAdmin } from "./helpers/auth";
import { createDisposableUser, localConvexUrl } from "./helpers/fixtures";

test.use({ trace: "off", screenshot: "off", video: "off" });

test.describe("App-operator organization workflow", () => {
  test("organization routes require authentication", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/manage/organizations");
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/manage/organizations/unknown-organization");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("real directory preserves private data while disabling and reactivating the selected organization", async ({ page, request }, testInfo) => {
    const user = await createDisposableUser();
    const client = new ConvexHttpClient(localConvexUrl());
    const origin = new URL(testInfo.project.use.baseURL!).origin;
    // This request context is separate from the operator browser; there is no fabricated cookie/role.
    const signedIn = await request.post("/api/auth/sign-in/email", { data: user, headers: { Origin: origin } });
    expect(signedIn.ok(), `Ordinary fixture sign-in returned HTTP ${signedIn.status()}`).toBe(true);
    const tokenResponse = await request.get("/api/auth/convex/token");
    expect(tokenResponse.ok()).toBe(true);
    const { token } = await tokenResponse.json() as { token: string };
    expect(token).toBeTruthy(); client.setAuth(token);
    const context = await client.query(api.platform.tenantContext.mine, {});
    const organizationId = context?.personalOrganizationId;
    expect(organizationId).toBeTruthy();
    if (!organizationId) throw new Error("Disposable ordinary user has no canonical personal organization.");
    const privateName = `private-project-${randomUUID()}`;
    const projectId = await client.mutation(api.tenantProjects.create, { organizationId, name: privateName, description: "Retained private application data" });
    await signInAsAdmin(page);
    await page.getByRole("link", { name: "Organizations", exact: true }).click();
    await expect(page).toHaveURL(/\/manage\/organizations$/);
    await expect(page.getByRole("heading", { name: "Organizations", exact: true })).toBeVisible();
    const target = page.locator(`a[href="/manage/organizations/${encodeURIComponent(organizationId)}"]`);
    for (let count = 0; count < 100 && await target.count() === 0; count++) {
      await expect(page.getByRole("table")).toBeVisible();
      const next = page.getByRole("button", { name: "Next page" });
      if (!await next.isEnabled()) break;
      await next.click(); await expect(page.getByRole("table")).toBeVisible();
    }
    await expect(target).toBeVisible();
    for (const privateValue of [privateName, user.email, user.password]) expect(await page.locator("body").innerHTML()).not.toContain(privateValue);
    await target.click();
    await expect(page).toHaveURL(new RegExp(`/manage/organizations/${organizationId}$`));
    await expect(page.getByText("No current designated contact is available.")).toBeVisible();
    await page.getByRole("button", { name: "Disable organization", exact: true }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation.getByRole("heading", { name: "Disable this organization?" })).toBeVisible();
    for (const privateValue of [privateName, user.email, user.password]) expect(await page.locator("body").innerHTML()).not.toContain(privateValue);
    await confirmation.getByRole("button", { name: "Disable organization", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reactivate organization", exact: true })).toBeVisible();
    await expect(client.query(api.tenantProjects.get, { organizationId, id: projectId })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    await page.getByRole("button", { name: "Reactivate organization", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Reactivate organization", exact: true }).click();
    await expect(page.getByRole("button", { name: "Disable organization", exact: true })).toBeVisible();
    expect(await client.query(api.tenantProjects.get, { organizationId, id: projectId })).toMatchObject({ _id: projectId, name: privateName, organizationId });
    for (const privateValue of [privateName, user.email, user.password]) expect(await page.locator("body").innerHTML()).not.toContain(privateValue);
  });
});
