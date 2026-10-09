import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { fillOtp, generateTotp, awaitStableTotpWindow, markConvexLogPosition, waitForAuthEmail } from "./customer-auth.ts";
import type { OrganizationObservation } from "./secret-safe-report.ts";

const diagnosticStarts = new WeakMap<TestInfo, number>();
/** Start before page setup and the test body, using only public fixture APIs. */
export const organizationTest = test.extend<{ organizationDiagnosticClock: void }>({
  // Playwright requires destructuring even when a fixture has no dependencies.
  // eslint-disable-next-line no-empty-pattern
  organizationDiagnosticClock: [async ({}, useFixture, info) => {
    diagnosticStarts.set(info, performance.now());
    try { await useFixture(); } finally { diagnosticStarts.delete(info); }
  }, { auto: true, box: true }],
});

/** Read only after an assertion fails, inside the remaining original test budget. */
export async function expectOrganizationTransition(page: Page, organizationId: string | null, assertion: () => Promise<void>, memberRow?: Locator) {
  try { await assertion(); }
  catch (failure) {
    const info = test.info();
    const started = diagnosticStarts.get(info);
    // Without our clock, or near the deadline, preserve the failure immediately.
    const budget = started === undefined ? 0 : info.timeout === 0 ? 2_000
      : Math.min(2_000, info.timeout - (performance.now() - started) - 250);
    if (budget <= 0) throw failure;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Identifiers/URLs/text stay inside this comparison, never in step titles or reports.
      const capture = (async () => {
        const observations = await page.evaluate<OrganizationObservation[], string | null>(expected => {
          const result: OrganizationObservation[] = [];
          const url = new URL(window.location.href);
          if (!expected) result.push("org-expected-id-missing");
          result.push(expected && url.searchParams.get("organizationId") === expected ? "org-url-expected" : "org-url-other");
          const route = url.pathname;
          result.push(route.endsWith("/organization-invitation") ? "org-invitation-page"
            : route.endsWith("/dashboard/organization") ? "org-organization-page"
            : route.endsWith("/dashboard") ? "org-dashboard-page"
            : route.endsWith("/sign-in") ? "org-sign-in-page" : "org-page-other");
          result.push(document.visibilityState === "visible" ? "org-visible" : "org-hidden");
          if (document.readyState === "loading") result.push("org-document-loading");
          const label = [...document.querySelectorAll("label")].find(element => element.textContent?.trim() === "Organization context");
          const control = label ? document.getElementById(label.htmlFor) : null;
          if (control instanceof window.HTMLSelectElement) {
            result.push(control.value === expected ? "org-context-match" : "org-context-mismatch");
            result.push([...control.options].some(option => option.value === expected) ? "org-option-present" : "org-option-absent");
          } else result.push("org-context-absent");
          if (document.querySelector('[data-personal-data-state="loading"]')) result.push("org-app-loading");
          if (document.querySelector('[data-personal-data-state="unavailable"]')) result.push("org-app-unavailable");
          const alerts = [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent ?? "");
          result.push(alerts.length ? "org-feedback-present" : "org-feedback-absent");
          const knownFeedback: Array<[string, OrganizationObservation]> = [
            ["Access is unavailable.", "org-feedback-unavailable"],
            ["Verify your identity again", "org-feedback-reauthentication"],
            ["Too many attempts.", "org-feedback-rate-limit"],
            ["This invitation is unavailable", "org-feedback-invitation"],
            ["Organization setup is not ready.", "org-feedback-not-ready"],
            ["An error occurred", "org-feedback-generic"],
          ];
          for (const [text, category] of knownFeedback) if (alerts.some(alert => alert.includes(text))) result.push(category);
          return result;
        }, organizationId);
        if (memberRow) {
          const texts = await memberRow.allTextContents();
          observations.push(texts.length === 0 ? "org-row-absent" : texts.some(text => /\bPending\b/.test(text)) ? "org-row-pending" : "org-row-not-pending");
        }
        return observations;
      })();
      // A stalled renderer must not turn diagnostics into another long wait.
      const observations = await Promise.race([capture, new Promise<OrganizationObservation[]>(resolve => {
        timer = setTimeout(() => resolve(["org-read-failed"]), budget);
      })]);
      for (const observation of observations) await test.step(observation, async () => {});
    } catch {
      try { await test.step("org-read-failed", async () => {}); } catch { /* The original assertion remains authoritative. */ }
    } finally {
      clearTimeout(timer);
    }
    throw failure;
  }
}

export async function addOrganizationAuthenticator(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
}

/** Real enrollment UI; no role, assurance, enrollment receipt or membership fixture patch. */
export async function completeOrganizationEnrollment(page: Page, password: string) {
  await page.locator("#organization-password").fill(password);
  await page.locator("form:has(#organization-password)").getByRole("button", { name: "Verify", exact: true }).click();
  await page.getByRole("button", { name: "Enable 2FA", exact: true }).click();
  await page.locator("[id='2fa-password']").fill(password);
  await page.locator("form:has([id='2fa-password']) button[type='submit']").click();
  const manual = page.getByRole("button", { name: "Can't scan? Enter this key manually", exact: true });
  await expect(manual).toBeVisible({ timeout: 20_000 }); await manual.click();
  const secretField = page.locator("code, [class*='font-mono']").filter({ hasText: /^[A-Z2-7\s]{16,}$/ }).first();
  await expect(secretField).toBeVisible();
  const secret = (await secretField.innerText()).replace(/\s/g, "");
  await awaitStableTotpWindow(); await fillOtp(page, generateTotp(secret));
  const codes = page.locator('[data-slot="copyable-field"] pre').first();
  await expect(codes).toBeVisible({ timeout: 20_000 });
  const backupCodes = (await codes.innerText()).split("\n").map(code => code.trim()).filter(Boolean);
  expect(backupCodes.length).toBeGreaterThanOrEqual(2);
  await page.locator("#organization-recovery-password").fill(password);
  await page.locator("#organization-code-one").fill(backupCodes[0]!);
  await page.locator("#organization-code-two").fill(backupCodes[1]!);
  await page.locator("form:has(#organization-code-two)").getByRole("button", { name: "Verify", exact: true }).click();
  const passkeyName = page.locator("#new-passkey-name");
  // The fixture keeps the deployed policy. Required policy gets a real WebAuthn ceremony.
  if (await passkeyName.isVisible()) {
    await passkeyName.fill("Organization security key");
    await page.getByRole("button", { name: "Add passkey", exact: true }).click();
    await expect(page.getByText("Organization security key", { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByText("Verify your identity", { exact: true }).first().click();
    await page.getByRole("button", { name: "Use a passkey", exact: true }).first().click();
  }
  await page.getByRole("checkbox").check();
  const complete = page.getByRole("button", { name: "Continue", exact: true });
  await expect(complete).toBeEnabled({ timeout: 20_000 }); await complete.click();
  await expect(page.getByText("Members", { exact: true })).toBeVisible({ timeout: 20_000 });
  return { secret, backupCodes };
}

export async function issueOrganizationInvitation(page: Page, email: string) {
  const offset = markConvexLogPosition();
  await page.locator("#member-email").fill(email);
  await page.getByRole("button", { name: "Invite a member", exact: true }).click();
  const url = new URL(await waitForAuthEmail("custom", offset));
  expect(url.search).not.toContain("token"); expect(url.hash).toContain("token=");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  return `${url.pathname}${url.search}${url.hash}`;
}
