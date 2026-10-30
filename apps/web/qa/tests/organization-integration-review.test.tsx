import { useState, type ReactNode } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import english from "@web-app-starter/i18n/messages/en.json";
import appMessages from "@repo/messages/en.json";

const mocks = vi.hoisted(() => ({
  status: {} as Record<string, unknown> | null | undefined,
  user: null as null | { _id: string; email: string },
  session: { data: null as null | { user: { id: string; email: string; emailVerified: boolean } }, isPending: false },
  calls: {} as Record<string, ReturnType<typeof vi.fn>>, verify: vi.fn(), getSession: vi.fn(), signIn: vi.fn(),
  verifyTotp: vi.fn(), sendVerification: vi.fn(), push: vi.fn(), signOut: vi.fn(), authenticated: false,
}));
vi.mock("@repo/backend", () => ({ api: { platform: {
  sessionAssurance: { status: "assurance" }, auth: { getCurrentUser: "currentUser" },
  memberInvitations: { preview: "preview", claim: "claim", register: "register", requestVerification: "verifyEmail", requestRegistrationVerification: "registrationVerification", accept: "accept" },
} } }));
vi.mock("convex/react", () => ({
  useQuery: (query: string) => query === "assurance" ? mocks.status : mocks.user,
  useQueries: (queries: Record<string, unknown>) => Object.fromEntries(Object.keys(queries).map(key => [key, mocks.user])),
  useConvexAuth: () => ({ isAuthenticated: mocks.authenticated, isLoading: false }),
  useAction: (name: string) => mocks.calls[name] ??= vi.fn().mockResolvedValue(undefined),
  useMutation: (name: string) => mocks.calls[name] ??= vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: {
  useSession: () => mocks.session, getSession: mocks.getSession, $fetch: mocks.verify,
  twoFactor: { verifyTotp: mocks.verifyTotp, verifyBackupCode: vi.fn() }, signIn: { email: mocks.signIn, passkey: vi.fn() },
  signOut: mocks.signOut, sendVerificationEmail: mocks.sendVerification,
} }));
vi.mock("@web-app-starter/i18n/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@web-app-starter/auth-ui", () => ({ EMAIL_VERIFICATION_CALLBACK_URL: "/verify-email?verified=1" }));
vi.mock("@/components/ui/localized-controls", () => ({ PasswordInput: (props: object) => <input {...props} type="password" /> }));
vi.mock("../../../../platform/packages/auth-ui/src/settings/two-factor-section", () => ({ TwoFactorSection: () => <div>Authenticator setup</div> }));
vi.mock("../../../../platform/packages/auth-ui/src/settings/passkey-section", () => ({ PasskeySection: () => <div>Passkey setup</div> }));
vi.mock("../../../../platform/packages/auth-ui/src/settings/organization-factor-replacement", () => ({ OrganizationFactorReplacement: () => <div>Replacement setup</div> }));
import { SessionAccessGate } from "../../../../platform/packages/auth-ui/src/components/session-access-gate";
import { InvitationClient } from "../../src/components/organizations/invitation-client";
import { readOrganizationInvitation } from "../../src/components/organizations/invitation-state";

function ready() { return { reason: "ready", allowed: true, scope: "user", hasTotp: false, hasPasskey: false,
  strongForChanges: false, recent: true, recentUntil: Date.now() + 300_000, primaryRecentUntil: Date.now() + 300_000,
  expiresAt: Date.now() + 3_600_000, passkeyPolicy: "optional" }; }
function actor(id: string | null) {
  mocks.user = id ? { _id: id, email: `${id}@example.test` } : null;
  mocks.session = { data: id ? { user: { id, email: `${id}@example.test`, emailVerified: true } } : null, isPending: false };
  mocks.authenticated = Boolean(id);
}
function wrap(child: ReactNode) { return <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ ...english, ...appMessages }}>{child}</NextIntlClientProvider>; }
function SensitiveDraft() { const [value, setValue] = useState(""); return <input aria-label="Private draft" value={value} onChange={event => setValue(event.target.value)} />; }
const tokenA = "a".repeat(64); const tokenB = "b".repeat(64);
function invitation(id: string, token: string) {
  window.history.replaceState({}, "", `/en/organization-invitation#organizationId=${id}&token=${token}`);
  window.dispatchEvent(new Event("hashchange"));
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.calls = {}; mocks.status = ready(); actor("alice");
  mocks.getSession.mockImplementation(async () => mocks.session);
  mocks.verify.mockResolvedValue({ data: {} }); mocks.signIn.mockResolvedValue({ data: {} }); mocks.signOut.mockResolvedValue({});
  mocks.calls.preview = vi.fn(async ({ organizationId }: { organizationId: string }) => ({ organizationId, name: organizationId,
    email: "recipient@example.test", role: "member", expiresAt: Date.now() + 10000 }));
  window.sessionStorage.clear(); window.history.replaceState({}, "", "/");
});

describe("independent integration identity and invitation leases", () => {
  it("SessionAccessGate discards sensitive child state on actor change, including A to B to A", () => {
    const view = render(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    fireEvent.change(view.getByLabelText("Private draft"), { target: { value: "alice-private-draft" } });
    actor("bob"); view.rerender(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    expect(view.queryByDisplayValue("alice-private-draft")).not.toBeInTheDocument();
    expect(view.getByLabelText("Private draft")).toHaveValue("");
    actor("alice"); view.rerender(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    expect(view.getByLabelText("Private draft")).toHaveValue("");
  });

  it("SessionAccessGate clears its own password form after actor change", () => {
    mocks.status = { ...ready(), allowed: false, reason: "reauthenticate", recent: false };
    const view = render(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    fireEvent.change(view.getByLabelText(english.accountSecurity.changePassword.currentPassword), { target: { value: "alice-proof-secret" } });
    actor("bob"); view.rerender(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    expect(view.queryByDisplayValue("alice-proof-secret")).not.toBeInTheDocument();
    expect(view.getByLabelText(english.accountSecurity.changePassword.currentPassword)).toHaveValue("");
  });

  it("same-actor transient proof refresh preserves the child draft without displaying it while denied", () => {
    const view = render(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    const draft = view.getByLabelText("Private draft");
    fireEvent.change(draft, { target: { value: "same-actor-draft" } });
    mocks.status = undefined; view.rerender(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    expect(draft).not.toBeVisible();
    mocks.status = ready(); view.rerender(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    expect(view.getByLabelText("Private draft")).toBe(draft);
    expect(draft).toHaveValue("same-actor-draft");
  });

  it("invitation password draft cannot survive another account signing in and out", async () => {
    actor(null); invitation("org-a", tokenA);
    const view = render(wrap(<InvitationClient />));
    const password = await view.findByLabelText(appMessages.organizations.currentPassword);
    fireEvent.change(password, { target: { value: "recipient-private-password" } });
    actor("other"); view.rerender(wrap(<InvitationClient />));
    expect(await view.findByText(appMessages.organizations.wrongAccount)).toBeVisible();
    actor(null); view.rerender(wrap(<InvitationClient />));
    expect(await view.findByLabelText(appMessages.organizations.currentPassword)).toHaveValue("");
  });

  it("late sign-in failure from a replaced invitation cannot overwrite the new form", async () => {
    actor(null); invitation("org-a", tokenA);
    let resolve!: (value: object) => void;
    mocks.signIn.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(wrap(<InvitationClient />));
    const field = await view.findByLabelText(appMessages.organizations.currentPassword);
    fireEvent.change(field, { target: { value: "old-password" } }); fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledOnce());
    act(() => invitation("org-b", tokenB));
    await view.findByText("org-b");
    fireEvent.change(view.getByLabelText(appMessages.organizations.currentPassword), { target: { value: "new-invitation-password" } });
    await act(async () => resolve({ error: { code: "EMAIL_NOT_VERIFIED" } }));
    expect(view.getByLabelText(appMessages.organizations.currentPassword)).toHaveValue("new-invitation-password");
    expect(view.queryByText(appMessages.organizations.verifyEmail)).not.toBeInTheDocument();
    expect(readOrganizationInvitation()).toEqual({ organizationId: "org-b", token: tokenB });
    expect(view.container.innerHTML).not.toContain(tokenA); expect(view.container.innerHTML).not.toContain(tokenB);
    expect(window.location.href).not.toContain(tokenB);
  });

  it("same-actor pending session refresh preserves a hidden draft until backend identity agrees", () => {
    const view = render(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    const draft = view.getByLabelText("Private draft");
    fireEvent.change(draft, { target: { value: "same-actor-refresh" } });
    mocks.session = { data: null, isPending: true }; mocks.user = null;
    view.rerender(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    expect(draft).not.toBeVisible();
    actor("alice"); view.rerender(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    expect(view.getByLabelText("Private draft")).toBe(draft);
    expect(draft).toHaveValue("same-actor-refresh");
    mocks.session = { data: { user: { id: "bob", email: "bob@example.test", emailVerified: true } }, isPending: false };
    view.rerender(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    expect(view.queryByDisplayValue("same-actor-refresh")).not.toBeInTheDocument();
    expect(view.queryByLabelText("Private draft")).not.toBeInTheDocument();
  });

  it("late proof completion from a previous actor cannot clear the new actor password", async () => {
    mocks.status = { ...ready(), allowed: false, reason: "reauthenticate", recent: false };
    let resolve!: (value: object) => void;
    mocks.verify.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    const field = view.getByLabelText(english.accountSecurity.changePassword.currentPassword);
    fireEvent.change(field, { target: { value: "alice-proof" } }); fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce());
    actor("bob"); view.rerender(wrap(<SessionAccessGate><SensitiveDraft /></SessionAccessGate>));
    fireEvent.change(view.getByLabelText(english.accountSecurity.changePassword.currentPassword), { target: { value: "bob-proof" } });
    await act(async () => resolve({ data: {} }));
    expect(view.getByLabelText(english.accountSecurity.changePassword.currentPassword)).toHaveValue("bob-proof");
  });

  it("late TOTP completion cannot replace a new invitation registration form", async () => {
    actor(null); invitation("org-a", tokenA);
    mocks.signIn.mockResolvedValueOnce({ data: { twoFactorRedirect: true } });
    let resolve!: (value: object) => void;
    mocks.verifyTotp.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(wrap(<InvitationClient />));
    const password = await view.findByLabelText(appMessages.organizations.currentPassword);
    fireEvent.change(password, { target: { value: "old-proof" } }); fireEvent.submit(password.closest("form")!);
    const code = await view.findByLabelText(appMessages.organizations.authenticatorCode);
    fireEvent.change(code, { target: { value: "123456" } }); fireEvent.submit(code.closest("form")!);
    await waitFor(() => expect(mocks.verifyTotp).toHaveBeenCalledOnce());
    act(() => invitation("org-b", tokenB)); await view.findByText("org-b");
    fireEvent.click(view.getByText(appMessages.organizations.newAccount));
    const nextPassword = view.getByLabelText(appMessages.organizations.newPassword);
    fireEvent.change(nextPassword, { target: { value: "new-proof" } });
    await act(async () => resolve({ data: {} }));
    expect(view.getByLabelText(appMessages.organizations.newPassword)).toHaveValue("new-proof");
    expect(view.getByLabelText(appMessages.organizations.yourName)).toBeVisible();
  });

  it("intended recipient sign-in resumes the same invitation with a fresh secret-free actor view", async () => {
    actor(null); invitation("org-a", tokenA);
    const view = render(wrap(<InvitationClient />));
    const password = await view.findByLabelText(appMessages.organizations.currentPassword);
    fireEvent.change(password, { target: { value: "recipient-proof" } }); fireEvent.submit(password.closest("form")!);
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledOnce());
    await act(async () => {});
    actor("recipient"); view.rerender(wrap(<InvitationClient />));
    expect(await view.findByText(appMessages.organizations.acceptInvitation)).toBeEnabled();
    expect(view.queryByDisplayValue("recipient-proof")).not.toBeInTheDocument();
    expect(readOrganizationInvitation()).toEqual({ organizationId: "org-a", token: tokenA });
    expect(view.container.innerHTML).not.toContain(tokenA);
    expect(window.location.href).not.toContain(tokenA);
  });

});
