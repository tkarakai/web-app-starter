import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import english from "@web-app-starter/i18n/messages/en.json";
import french from "@web-app-starter/i18n/messages/fr.json";
import { SessionAccessGate } from "../../src/components/session-access-gate";

const mocks = vi.hoisted(() => ({ status: null as Record<string, unknown> | null, verify: vi.fn(), totp: vi.fn(), backup: vi.fn(), passkey: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery: () => mocks.status }));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: {
  $fetch: mocks.verify, twoFactor: { verifyTotp: mocks.totp, verifyBackupCode: mocks.backup }, signIn: { passkey: mocks.passkey }, signOut: vi.fn(),
} }));
vi.mock("../../src/settings/two-factor-section", () => ({ TwoFactorSection: ({ recover, onComplete }: { recover?: boolean; onComplete: () => void }) => <div><p>{recover ? "Replace authenticator" : "Enroll authenticator"}</p><button onClick={onComplete}>Save backup codes</button></div> }));
vi.mock("../../src/settings/passkey-section", () => ({ PasskeySection: () => <p>Add authenticator passkey</p> }));
function ready() {
  return { reason: "ready", allowed: true, scope: "user", hasTotp: false, hasPasskey: false, strongForChanges: false, recent: true,
    recentUntil: Date.now() + 300000, primaryRecentUntil: Date.now() + 300000, expiresAt: Date.now() + 3600000, passkeyPolicy: "optional" };
}
function view(props = {}, locale = "en") {
  return <NextIntlClientProvider locale={locale} messages={locale === "fr" ? french : english}><SessionAccessGate {...props}><input aria-label="Work in progress" defaultValue="Keep me" /></SessionAccessGate></NextIntlClientProvider>;
}
beforeEach(() => { vi.useFakeTimers(); mocks.status = ready(); vi.clearAllMocks(); mocks.verify.mockResolvedValue({ data: { status: true } }); });
afterEach(() => vi.useRealTimers());

describe("server-directed session access", () => {
  it("blocks ordinary content on a policy change and translates the required enrollment", () => {
    const result = render(view({}, "fr"));
    expect(screen.getByLabelText("Work in progress")).toBeVisible();
    mocks.status = { ...ready(), reason: "mfa_enrollment", allowed: false };
    result.rerender(view({}, "fr"));
    expect(screen.getByLabelText("Work in progress")).not.toBeVisible();
    expect(screen.getByText(french.accountSecurity.twoFactor.requiredNotice)).toBeVisible();
  });
  it("asks for current password when recent proof expires without a query update", async () => {
    render(view({ requireRecent: true }));
    await act(async () => vi.advanceTimersByTime(300001));
    fireEvent.change(screen.getByLabelText(english.accountSecurity.changePassword.currentPassword), { target: { value: "secret" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Verify" })));
    expect(mocks.verify).toHaveBeenCalledWith("/verify-password", { method: "POST", body: { password: "secret" } });
    expect(screen.getByLabelText("Work in progress")).not.toBeVisible(); // only a server update grants access
  });
  it("expires the UI at the absolute session deadline", async () => {
    mocks.status = { ...ready(), expiresAt: Date.now() + 1000 };
    render(view());
    await act(async () => vi.advanceTimersByTime(1001));
    expect(screen.getByText(english.accountSecurity.session.expired)).toBeVisible();
    expect(screen.getByLabelText("Work in progress")).not.toBeVisible();
  });
  it("requires the enrolled factor instead of offering a password substitute", () => {
    mocks.status = { ...ready(), recent: false, hasTotp: true, strongForChanges: true };
    render(view({ requireRecent: true }));
    expect(screen.queryByLabelText(english.accountSecurity.changePassword.currentPassword)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: english.accountSecurity.twoFactor.backupCodes })).toBeVisible();
  });
  it("retains recovery setup and backup acknowledgement across token rotation and successful proof", async () => {
    mocks.status = { ...ready(), reason: "recovery", allowed: false, hasTotp: true, strongForChanges: true };
    const result = render(view());
    fireEvent.click(screen.getByRole("button", { name: english.accountSecurity.twoFactor.enable }));
    expect(screen.getByText("Replace authenticator")).toBeVisible();
    mocks.status = null;
    result.rerender(view());
    expect(screen.getByText("Replace authenticator")).not.toBeVisible();
    mocks.status = ready(); result.rerender(view());
    expect(screen.queryByLabelText("Work in progress")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(300001));
    expect(screen.getByText("Replace authenticator")).not.toBeVisible();
    expect(screen.getByLabelText(english.accountSecurity.changePassword.currentPassword)).toBeVisible();
    mocks.status = ready(); result.rerender(view());
    expect(screen.getByText("Replace authenticator")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save backup codes" }));
    expect(screen.getByLabelText("Work in progress")).toBeVisible();
  });
  it("preserves wizard state while fresh verification is required", () => {
    const result = render(view({ requireRecent: true, enrollment: true }));
    const field = screen.getByLabelText("Work in progress");
    fireEvent.change(field, { target: { value: "Saved in memory" } });
    mocks.status = { ...ready(), reason: "enrollment", allowed: false, hasTotp: true, strongForChanges: true, recent: false };
    result.rerender(view({ requireRecent: true, enrollment: true }));
    expect(field).not.toBeVisible();
    mocks.status = { ...mocks.status, recent: true };
    result.rerender(view({ requireRecent: true, enrollment: true }));
    expect(field).toBeVisible(); expect(field).toHaveValue("Saved in memory");
  });
});

it("does not mount privileged children for an initially limited session", () => {
  const mount = vi.fn();
  function Consumer() { mount(); return <p>Privileged consumer</p>; }
  mocks.status = { ...ready(), reason: "mfa_enrollment", allowed: false };
  render(<NextIntlClientProvider locale="en" messages={english}><SessionAccessGate><Consumer /></SessionAccessGate></NextIntlClientProvider>);
  expect(mount).not.toHaveBeenCalled();
});
it.each([false, true])("ignores disabled passkeys during enrollment (bound=%s)", (enrollment) => {
  mocks.status = { ...ready(), reason: enrollment ? "enrollment" : "mfa_enrollment", allowed: false, hasPasskey: true, passkeyPolicy: "disabled", strongForChanges: true, recent: false, primaryRecentUntil: Date.now() - 1 };
  const result = render(view({ enrollment, requireRecent: true }));
  expect(screen.getByLabelText(english.accountSecurity.changePassword.currentPassword)).toBeVisible();
  expect(screen.queryByRole("button", { name: english.accountSecurity.session.usePasskey })).not.toBeInTheDocument();
  mocks.status = { ...mocks.status, primaryRecentUntil: Date.now() + 300000 };
  result.rerender(view({ enrollment, requireRecent: true }));
  if (enrollment) expect(screen.getByLabelText("Work in progress")).toBeVisible();
  else expect(screen.getByRole("button", { name: english.accountSecurity.twoFactor.enable })).toBeVisible();
});
