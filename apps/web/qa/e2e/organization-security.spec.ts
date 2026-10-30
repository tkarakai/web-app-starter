import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@repo/backend";
import { signIn, generateTotp, awaitStableTotpWindow, markConvexLogPosition, waitForAuthEmail, throttlePasswordResetRequest, toRelativeUrl } from "./helpers/auth";
import { createDisposableUser, disposablePassword, localConvexUrl } from "./helpers/fixtures";
import { addOrganizationAuthenticator, completeOrganizationEnrollment, issueOrganizationInvitation } from "./helpers/organizations";

// These tests hold real credentials/recovery material in memory. Never capture
// traces, screenshots or response bodies containing them in the test artifacts.
test.describe.configure({ mode: "default", timeout: 240_000 });
test.use({ actionTimeout: 20_000, trace: "off", screenshot: "off", video: "off" });

// authStepUp refills five tokens/minute. Enrollment already spent several; pace
// subsequent real proofs without resetting/bypassing server budgets.
const lastProofAt = new WeakMap<Page, number>();
async function proof<T>(page: Page, run: () => Promise<T>): Promise<T> {
  const delay = Math.max(0, (lastProofAt.get(page) ?? 0) + 12_250 - Date.now());
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  lastProofAt.set(page, Date.now());
  return run();
}
async function authPost(page: Page, path: string, data: Record<string, unknown>) {
  if (["/change-password", "/two-factor/disable", "/two-factor/verify-backup-code"].includes(path)) {
    return proof(page, () => page.request.post(`/api/auth${path}`, { data, headers: { Origin: new URL(page.url()).origin } }));
  }
  return page.request.post(`/api/auth${path}`, { data, headers: { Origin: new URL(page.url()).origin } });
}
async function convex(page: Page) {
  const response = await page.request.get("/api/auth/convex/token");
  expect(response.status(), "real session can issue a scoped Convex token").toBe(200);
  const body = await response.json() as { token: string };
  expect(typeof body.token).toBe("string");
  const client = new ConvexHttpClient(localConvexUrl(), { logger: false });
  client.setAuth(body.token);
  return client;
}
async function strongLogin(page: Page, email: string, password: string, secret: string) {
  await page.context().clearCookies();
  const signedIn = await authPost(page, "/sign-in/email", { email, password });
  expect(signedIn.status(), "password accepted").toBe(200);
  expect((await signedIn.json()).twoFactorRedirect).toBe(true);
  await awaitStableTotpWindow();
  const verified = await proof(page, () => authPost(page, "/two-factor/verify-totp", { code: generateTotp(secret) }));
  expect(verified.status(), "actual TOTP proof accepted").toBe(200);
  return convex(page);
}
async function startEnrolledOrganization(page: Page) {
  await addOrganizationAuthenticator(page);
  const user = await createDisposableUser();
  await signIn(page, user.email, user.password);
  await page.goto("/en/dashboard/organization");
  await page.locator("#organization-name").fill("Independent security acceptance");
  await page.locator("#organization-slug").fill(`security-${randomUUID().slice(0, 12)}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const factors = await completeOrganizationEnrollment(page, user.password).catch(async error => {
    const organizationId = await page.locator("[data-organization-id]").getAttribute("data-organization-id");
    if (organizationId) {
      const status = await (await convex(page)).query(api.platform.organizationEnrollment.status, { organizationId });
      console.error("Enrollment gate diagnostics", { allowed: status.allowed, reason: status.reason, recent: status.recent,
        hasTotp: status.hasTotp, hasPasskey: status.hasPasskey, passkeyPolicy: status.passkeyPolicy,
        passwordVerified: status.setup.passwordVerified, backupAcknowledged: status.setup.backupAcknowledged });
    }
    throw error;
  });
  lastProofAt.set(page, Date.now());
  const organizationId = await page.locator("[data-organization-id]").getAttribute("data-organization-id");
  expect(organizationId).toBeTruthy();
  const client = await convex(page);
  expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ scope: "user", securityScope: "admin", allowed: true });
  expect((await client.query(api.platform.memberManagement.directory, { organizationId: organizationId!, paginationOpts: { cursor: null, numItems: 100 } })).page.filter(row => row.enrolled)).toHaveLength(1);
  return { user, factors, organizationId: organizationId!, client };
}

test("earned sole admin survives native password change/reset and limited recovery with staged TOTP replacement", async ({ page }) => {
  const { user, factors, organizationId, client } = await startEnrolledOrganization(page);
  const changedPassword = disposablePassword();
  expect((await authPost(page, "/change-password", { currentPassword: user.password, newPassword: changedPassword, revokeOtherSessions: false })).status()).toBe(200);
  // Cached pre-change JWT must not revive its old security proof.
  expect((await client.query(api.platform.sessionAssurance.status, {}))?.allowed).toBe(false);
  const fresh = await strongLogin(page, user.email, changedPassword, factors.secret);
  const future = await fresh.query(api.platform.sessionAssurance.status, {});
  expect(future).toMatchObject({ scope: "user", securityScope: "admin", hasTotp: true });
  if (future?.passkeyPolicy === "required") {
    expect(future).toMatchObject({ allowed: false, reason: "passkey_verification" });
  } else {
    expect(future?.allowed).toBe(true);
  }

  // Real email capability issuance and consumption; no reset-token fixture.
  await page.context().clearCookies();
  const resetPassword = disposablePassword();
  await throttlePasswordResetRequest();
  const offset = markConvexLogPosition();
  expect((await authPost(page, "/request-password-reset", { email: user.email, redirectTo: `${new URL(page.url()).origin}/en/reset-password` })).status()).toBe(200);
  const resetUrl = await waitForAuthEmail("reset-password", offset);
  await page.goto(toRelativeUrl(resetUrl));
  const token = new URL(page.url()).searchParams.get("token");
  expect(Boolean(token)).toBe(true);
  expect((await authPost(page, "/reset-password", { token, newPassword: resetPassword })).status()).toBe(200);
  expect((await authPost(page, "/reset-password", { token, newPassword: changedPassword })).status()).not.toBe(200);
  await strongLogin(page, user.email, resetPassword, factors.secret);

  const recovered = await authPost(page, "/two-factor/verify-backup-code", { code: factors.backupCodes[0] });
  expect(recovered.status()).toBe(200);
  const recovery = await convex(page);
  expect(await recovery.query(api.platform.sessionAssurance.status, {})).toMatchObject({ scope: "user", securityScope: "admin", allowed: false, reason: "recovery" });
  await expect(recovery.query(api.platform.memberManagement.directory, { organizationId, paginationOpts: { cursor: null, numItems: 100 } })).rejects.toThrow();
  expect(await recovery.query(api.platform.organizations.list, { paginationOpts: { cursor: null, numItems: 100 } })).toBeNull();
  expect((await authPost(page, "/organization/create", { name: "Raw forbidden", slug: randomUUID() })).status()).not.toBe(200);

  const staged = await proof(page, () => recovery.action(api.platform.organizationFactorReplacement.begin, { password: resetPassword }));
  const nextSecret = new URL(staged.totpURI).searchParams.get("secret")!;
  expect(Boolean(nextSecret)).toBe(true);
  await expect(proof(page, () => recovery.action(api.platform.organizationFactorReplacement.complete, {
    changeId: staged.changeId, code: "not-a-code", backupCodes: staged.backupCodes.slice(0, 2),
  }))).rejects.toThrow(/INVALID_TOTP/);
  expect((await recovery.query(api.platform.sessionAssurance.status, {}))?.reason).toBe("recovery");
  await awaitStableTotpWindow();
  await proof(page, () => recovery.action(api.platform.organizationFactorReplacement.complete, {
    changeId: staged.changeId, code: generateTotp(nextSecret), backupCodes: staged.backupCodes.slice(0, 2),
  }));
  const replaced = await recovery.query(api.platform.sessionAssurance.status, {});
  expect(replaced).toMatchObject({ scope: "user", securityScope: "admin", hasTotp: true });
  expect(replaced?.reason).not.toBe("recovery");
  if (replaced?.passkeyPolicy === "required") expect(replaced).toMatchObject({ allowed: false, reason: "passkey_verification" });
  else expect(replaced?.allowed).toBe(true);
  await expect(proof(page, () => recovery.action(api.platform.organizationFactorReplacement.complete, {
    changeId: staged.changeId, code: generateTotp(nextSecret), backupCodes: staged.backupCodes.slice(0, 2),
  }))).rejects.toThrow();
  await strongLogin(page, user.email, resetPassword, nextSecret);
  // Old recovery material no longer authenticates after atomic replacement.
  expect((await authPost(page, "/two-factor/verify-backup-code", { code: factors.backupCodes[1] })).status()).not.toBe(200);
});

test("two genuinely enrolled admins concurrently disable their own factors and exactly one remains effective", async ({ page, browser }) => {
  const owner = await startEnrolledOrganization(page);
  const second = await createDisposableUser();
  const link = await issueOrganizationInvitation(page, second.email);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const peer = await context.newPage();
  try {
    await addOrganizationAuthenticator(peer);
    await signIn(peer, second.email, second.password);
    await peer.goto(link);
    await peer.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(peer).toHaveURL(/\/dashboard/);
    const row = page.locator("[data-member-id]").filter({ has: page.getByText(second.email, { exact: true }) });
    await row.getByRole("button", { name: "Invite to admin role", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Continue", exact: true }).click();
    await peer.goto(`/en/dashboard/organization?organizationId=${owner.organizationId}`);
    await completeOrganizationEnrollment(peer, second.password);
    lastProofAt.set(peer, Date.now());
    const peerClient = await convex(peer);
    const directoryArgs = { organizationId: owner.organizationId, paginationOpts: { cursor: null, numItems: 100 } };
    expect((await owner.client.query(api.platform.memberManagement.directory, directoryArgs)).page.filter(member => member.enrolled)).toHaveLength(2);
    const results = await Promise.all([
      authPost(page, "/two-factor/disable", { password: owner.user.password }),
      authPost(peer, "/two-factor/disable", { password: second.password }),
    ]);
    expect(results.filter(response => response.status() === 200)).toHaveLength(1);
    expect(results.filter(response => response.status() !== 200)).toHaveLength(1);
    const survivor = results[0]!.status() === 200 ? peerClient : owner.client;
    const loser = results[0]!.status() === 200 ? owner.client : peerClient;
    expect((await survivor.query(api.platform.memberManagement.directory, directoryArgs)).page.filter(member => member.enrolled)).toHaveLength(1);
    await expect(loser.query(api.platform.memberManagement.directory, directoryArgs)).rejects.toThrow();
    await expect(survivor.query(api.platform.organizations.list, { paginationOpts: { cursor: null, numItems: 100 } })).rejects.toThrow();
  } finally { await context.close(); }
});
