import type { ReactNode } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import platformMessages from "@web-app-starter/i18n/messages/en.json";
import appMessages from "@repo/messages/en.json";

const state = vi.hoisted(() => ({
  session: { data: null as null | { user: { id: string; email: string; emailVerified: boolean } }, isPending: false },
  authenticated: true, loading: false,
  backendUser: undefined as { _id: string; emailVerified: boolean } | null | undefined | Error,
  calls: {} as Record<string, ReturnType<typeof vi.fn>>, getSession: vi.fn(), push: vi.fn(),
}));
vi.mock("@repo/backend", () => ({ api: { platform: {
  auth: { getCurrentUser: "currentUser" },
  memberInvitations: { preview: "preview", claim: "claim", register: "register", requestVerification: "verifyEmail", requestRegistrationVerification: "registrationVerification", accept: "accept" },
} } }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: state.authenticated, isLoading: state.loading }),
  useQueries: (queries: Record<string, { query: string }>) => Object.fromEntries(Object.keys(queries).map(key => [key, state.backendUser])),
  useAction: (name: string) => state.calls[name] ??= vi.fn().mockResolvedValue(undefined),
  useMutation: (name: string) => state.calls[name] ??= vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: {
  useSession: () => state.session, getSession: state.getSession, signOut: vi.fn(),
  signIn: { email: vi.fn(), passkey: vi.fn() }, twoFactor: { verifyTotp: vi.fn() }, sendVerificationEmail: vi.fn(),
} }));
vi.mock("@web-app-starter/i18n/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@web-app-starter/auth-ui", () => ({ EMAIL_VERIFICATION_CALLBACK_URL: "/verify-email?verified=1" }));
vi.mock("@/components/ui/localized-controls", () => ({ PasswordInput: (props: object) => <input {...props} type="password" /> }));
import { InvitationClient } from "../../src/components/organizations/invitation-client";
import { readOrganizationInvitation } from "../../src/components/organizations/invitation-state";

const token = "a".repeat(64);
const t = appMessages.organizations;
function actor(id: string) {
  state.session = { data: { user: { id, email: "recipient@example.test", emailVerified: true } }, isPending: false };
}
function wrap(child: ReactNode) { return <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ ...platformMessages, ...appMessages }}>{child}</NextIntlClientProvider>; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); state.calls = {}; actor("recipient"); state.authenticated = true; state.loading = false;
  state.backendUser = { _id: "recipient", emailVerified: true };
  state.getSession.mockImplementation(async () => state.session);
  state.calls.preview = vi.fn().mockResolvedValue({ organizationId: "org-target", name: "Organization", email: "recipient@example.test", role: "member" });
  state.calls.accept = vi.fn().mockResolvedValue({ organizationId: "org-target", adminPending: false });
  window.sessionStorage.clear(); window.history.replaceState({}, "", `/en/organization-invitation#organizationId=org-target&token=${token}`);
});

describe("invitation acceptance during identity transitions", () => {
  it.each([
    ["backend actor still belongs to the account switched away from", () => { state.backendUser = { _id: "previous-actor", emailVerified: true }; }],
    ["backend identity has not arrived", () => { state.backendUser = undefined; }],
    ["backend session has been revoked", () => { state.backendUser = null; }],
    ["backend identity query rejects", () => { state.backendUser = new Error("NOT_AUTHENTICATED"); }],
    ["Convex authentication is still loading", () => { state.loading = true; }],
    ["browser session is pending with retained user data", () => { state.session.isPending = true; }],
  ])("does not dispatch while %s", async (_name, transition) => {
    transition(); const view = render(wrap(<InvitationClient />));
    const button = await view.findByRole("button", { name: t.acceptInvitation });
    fireEvent.click(button);
    expect(state.calls.accept).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    expect(state.push).not.toHaveBeenCalled();
    expect(readOrganizationInvitation()).toEqual({ organizationId: "org-target", token });
  });

  it("enables explicit acceptance after the backend agrees with the signed-in recipient", async () => {
    state.backendUser = { _id: "previous-actor", emailVerified: true };
    const view = render(wrap(<InvitationClient />));
    expect(await view.findByRole("button", { name: t.acceptInvitation })).toBeDisabled();
    state.backendUser = { _id: "recipient", emailVerified: true }; view.rerender(wrap(<InvitationClient />));
    fireEvent.click(view.getByRole("button", { name: t.acceptInvitation }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/dashboard?organizationId=org-target"));
    expect(state.calls.accept).toHaveBeenCalledExactlyOnceWith({ organizationId: "org-target", token });
    expect(readOrganizationInvitation()).toBeNull();
  });

  it("does not navigate from a late acceptance after actor A to B to A", async () => {
    const request = deferred<{ organizationId: string; adminPending: boolean }>(); state.calls.accept.mockReturnValue(request.promise);
    const view = render(wrap(<InvitationClient />));
    fireEvent.click(await view.findByRole("button", { name: t.acceptInvitation }));
    expect(state.calls.accept).toHaveBeenCalledOnce();
    actor("other"); state.backendUser = { _id: "other", emailVerified: true }; view.rerender(wrap(<InvitationClient />));
    actor("recipient"); state.backendUser = { _id: "recipient", emailVerified: true }; view.rerender(wrap(<InvitationClient />));
    await act(async () => request.resolve({ organizationId: "org-target", adminPending: false }));
    expect(state.push).not.toHaveBeenCalled();
    expect(readOrganizationInvitation()).toEqual({ organizationId: "org-target", token });
  });

  it("withdraws an already enabled acceptance when backend session authority disappears", async () => {
    const view = render(wrap(<InvitationClient />));
    expect(await view.findByRole("button", { name: t.acceptInvitation })).toBeEnabled();
    state.backendUser = null; view.rerender(wrap(<InvitationClient />));
    const button = view.getByRole("button", { name: t.acceptInvitation });
    expect(button).toBeDisabled(); fireEvent.click(button);
    expect(state.calls.accept).not.toHaveBeenCalled();
  });

  it("preserves an in-flight same-actor pending refresh but never enables a new dispatch during it", async () => {
    const request = deferred<{ organizationId: string; adminPending: boolean }>(); state.calls.accept.mockReturnValue(request.promise);
    const view = render(wrap(<InvitationClient />));
    fireEvent.click(await view.findByRole("button", { name: t.acceptInvitation }));
    state.session.isPending = true; view.rerender(wrap(<InvitationClient />));
    expect(view.getByRole("button", { name: t.acceptInvitation })).toBeDisabled();
    actor("recipient"); view.rerender(wrap(<InvitationClient />));
    await act(async () => request.resolve({ organizationId: "org-target", adminPending: false }));
    expect(state.calls.accept).toHaveBeenCalledOnce();
    expect(state.push).toHaveBeenCalledWith("/dashboard?organizationId=org-target");
  });

  it("retires acceptance across settled signout and permits only an explicit same-recipient retry", async () => {
    const request = deferred<{ organizationId: string; adminPending: boolean }>(); state.calls.accept.mockReturnValueOnce(request.promise);
    const view = render(wrap(<InvitationClient />));
    fireEvent.click(await view.findByRole("button", { name: t.acceptInvitation }));
    state.session = { data: null, isPending: false }; state.authenticated = false; state.backendUser = null;
    view.rerender(wrap(<InvitationClient />));
    actor("recipient"); state.authenticated = true; state.backendUser = { _id: "recipient", emailVerified: true };
    state.calls.preview.mockRejectedValue(new Error("INVALID_MEMBER_INVITATION"));
    view.rerender(wrap(<InvitationClient />));
    await act(async () => request.resolve({ organizationId: "org-target", adminPending: false }));
    expect(state.push).not.toHaveBeenCalled();
    expect(readOrganizationInvitation()).toEqual({ organizationId: "org-target", token });
    // The real server only permits this idempotent result for the same admitted recipient.
    fireEvent.click(await view.findByRole("button", { name: t.acceptInvitation }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/dashboard?organizationId=org-target"));
    expect(state.calls.accept).toHaveBeenCalledTimes(2);
  });

  it("renders a server reauthentication refusal without retrying or consuming the invitation", async () => {
    state.calls.accept.mockRejectedValue(new Error("NOT_AUTHENTICATED"));
    const view = render(wrap(<InvitationClient />));
    fireEvent.click(await view.findByRole("button", { name: t.acceptInvitation }));
    expect(await view.findByRole("alert")).toHaveTextContent(t.reauthenticate);
    expect(state.calls.accept).toHaveBeenCalledOnce();
    expect(state.push).not.toHaveBeenCalled();
    expect(readOrganizationInvitation()).toEqual({ organizationId: "org-target", token });
  });
});
