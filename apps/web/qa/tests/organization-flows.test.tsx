import { StrictMode, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import platformMessages from "@web-app-starter/i18n/messages/en.json";
import appMessages from "@repo/messages/en.json";
import type { PersonalDataContext } from "../../src/hooks/personal-data-context";

const mocks = vi.hoisted(() => ({
  data: {} as Record<string, unknown>, query: vi.fn(), calls: {} as Record<string, ReturnType<typeof vi.fn>>,
  context: {} as PersonalDataContext,
  snapshot: {} as Record<string, unknown>,
  session: { data: null as null | { user: { id: string; email: string; emailVerified: boolean } }, isPending: false },
  authenticated: false, push: vi.fn(), signOut: vi.fn(), signIn: vi.fn(), getSession: vi.fn(), sendVerification: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: mocks.authenticated, isLoading: false }),
  // These flow fixtures use settled matching actors; organization-transitions
  // separately exercises mismatched, pending, revoked and rejected identities.
  useQueries: (queries: Record<string, { query: string; args: unknown }>) => Object.fromEntries(Object.entries(queries).map(([key, { query, args }]) => { mocks.query(query, args); return [key, query === "currentUser" ? mocks.session.data ? { _id: mocks.session.data.user.id } : null : mocks.data[query]]; })),
  useAction: (name: string) => mocks.calls[name] ??= vi.fn().mockResolvedValue(undefined),
  useMutation: (name: string) => mocks.calls[name] ??= vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@repo/backend", () => ({ api: { platform: {
  auth: { getCurrentUser: "currentUser" },
  tenantContext: { get: "contextDetail" },
  organizationEnrollment: { begin: "begin", status: "status", verifyCredential: "credential", acknowledgeRecovery: "recovery", complete: "complete" },
  memberManagement: { leave: "leave", directory: "directory", audit: "audit", change: "change", setContact: "contact" },
  memberInvitations: { list: "invitations", issue: "issue", resend: "resend", cancel: "cancel", preview: "preview", claim: "claim", register: "register", requestVerification: "verifyEmail", requestRegistrationVerification: "registrationVerification", accept: "accept" },
} } }));
vi.mock("@/hooks/use-personal-data", () => ({ usePersonalDataContext: () => mocks.context, useOrganizationSnapshot: () => mocks.snapshot }));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: { useSession: () => mocks.session, getSession: (...args: unknown[]) => mocks.getSession(...args), signOut: mocks.signOut, signIn: { email: mocks.signIn, passkey: vi.fn() }, twoFactor: { verifyTotp: vi.fn() }, sendVerificationEmail: mocks.sendVerification } }));
vi.mock("@web-app-starter/i18n/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@web-app-starter/auth-ui", async () => {
  const React = await import("react");
  return { ChangePasswordForm: () => React.createElement("div", null, "Password ceremony"), TwoFactorSection: () => { const [codes, setCodes] = React.useState(false); return React.createElement("div", null, codes ? "One-time recovery codes" : React.createElement("button", { onClick: () => setCodes(true) }, "Authenticator ceremony")); }, PasskeySection: () => React.createElement("div", null, "Passkey ceremony"), PasswordInput: (props: object) => React.createElement("input", { ...props, type: "password" }), EMAIL_VERIFICATION_CALLBACK_URL: "/verify-email?verified=1" };
});
vi.mock("@/components/projects/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/announcement-banner-host", () => ({ AnnouncementBannerHost: () => null }));
vi.mock("../../src/components/organizations/organization-picker", () => ({ OrganizationPicker: () => null }));
import { OrganizationContent } from "../../src/components/organizations/organization-client";
import { EnrollmentPanel } from "../../src/components/organizations/enrollment-panel";
import { MemberManagement } from "../../src/components/organizations/member-management";
import { InvitationClient } from "../../src/components/organizations/invitation-client";
import { readOrganizationInvitation } from "../../src/components/organizations/invitation-state";

const t = appMessages.organizations;
function wrap(children: ReactNode) { return <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ ...platformMessages, ...appMessages }}>{children}</NextIntlClientProvider>; }
function setContext(organizationId: string) { mocks.context = { state: "ready", userId: "user", ownerId: "user", tenant: { kind: "tenant", userId: "user", ownerId: "user", organizationId }, legacy: null }; }
function submitInput(view: ReturnType<typeof render>, selector: string, value: string) {
  const input = view.container.querySelector(selector)!; fireEvent.change(input, { target: { value } }); fireEvent.submit(input.closest("form")!);
}
const token = "a".repeat(64); const capability = "b".repeat(64);
function inviteUrl() { window.history.replaceState({}, "", `/en/organization-invitation#organizationId=org-a&token=${token}`); }

beforeEach(() => {
  vi.clearAllMocks(); mocks.calls = {}; mocks.data = {}; setContext("org-a");
  mocks.authenticated = false; mocks.session = { data: null, isPending: false };
  mocks.getSession.mockImplementation(async () => mocks.session); mocks.signOut.mockResolvedValue({}); mocks.signIn.mockResolvedValue({ data: {} }); mocks.sendVerification.mockResolvedValue({});
  window.sessionStorage.clear(); window.history.replaceState({}, "", "/");
  mocks.calls.preview = vi.fn().mockResolvedValue({ organizationId: "org-a", name: "Company", email: "invitee@example.test", role: "member", expiresAt: Date.now() + 10000 });
  mocks.calls.claim = vi.fn().mockResolvedValue({ capability });
  mocks.calls.accept = vi.fn().mockResolvedValue({ organizationId: "org-a", memberId: "member", adminPending: false });
});

describe("organization enrollment and membership UI", () => {
  it("removes the member directory from the DOM when discovery withdraws authority", () => {
    const own = { organizationId: "org-a", name: "Company", lifecycle: "active", personal: true, experience: "collaborative", role: "org-admin" };
    mocks.snapshot = { userId: "user", mine: { userId: "user", contexts: [own] }, error: null };
    mocks.data.contextDetail = { ...own, memberId: "member-a", canManageMembers: true, enrollmentStarted: true, enrollmentPending: false };
    mocks.data.directory = { page: [{ memberId: "private-member", name: "Private member", email: "private@example.test", role: "member", adminPending: false, enrolled: false }], isDone: true };
    mocks.data.invitations = { page: [], isDone: true }; mocks.data.audit = [];
    mocks.session.data = { user: { id: "user", email: "owner@example.test", emailVerified: true } };
    const view = render(wrap(<OrganizationContent />));
    expect(view.getByText("private@example.test")).toBeInTheDocument();
    // The directory subscription may still hold its last result when discovery
    // first disappears. Hidden DOM must not retain that result or its controls.
    mocks.snapshot = { userId: undefined, mine: undefined, error: null }; mocks.data.contextDetail = undefined;
    view.rerender(wrap(<OrganizationContent />));
    expect(view.container.innerHTML).not.toContain("private@example.test");
    expect(view.queryByRole("button", { name: t.sendInvitation, hidden: true })).not.toBeInTheDocument();
  });

  it("discards one-time enrollment values on definitive membership revocation", () => {
    const own = { organizationId: "org-a", name: "Personal", lifecycle: "active", personal: true, experience: "personal", role: "org-admin" };
    mocks.snapshot = { userId: "user", mine: { userId: "user", contexts: [own] }, error: null };
    mocks.data.contextDetail = { ...own, memberId: "member-a", canManageMembers: false, enrollmentStarted: true, enrollmentPending: true };
    mocks.session.data = { user: { id: "user", email: "owner@example.test", emailVerified: true } };
    const view = render(wrap(<OrganizationContent />));
    fireEvent.click(view.getByRole("button", { name: "Authenticator ceremony" }));
    expect(view.getByText("One-time recovery codes")).toBeInTheDocument();
    mocks.snapshot = { userId: "user", mine: { userId: "user", contexts: [] }, error: null }; mocks.data.contextDetail = undefined;
    view.rerender(wrap(<OrganizationContent />));
    expect(view.container.innerHTML).not.toContain("One-time recovery codes");
  });

  it("preserves a mounted enrollment through transient discovery loss but discards it for another identity", async () => {
    const own = { organizationId: "org-a", name: "Personal", lifecycle: "active", personal: true, experience: "personal", role: "org-admin" };
    const snapshot = { userId: "user", mine: { userId: "user", contexts: [own] }, error: null };
    const detail = { ...own, memberId: "member-a", canManageMembers: false, enrollmentStarted: true, enrollmentPending: true };
    mocks.snapshot = snapshot; mocks.data.contextDetail = detail;
    mocks.session.data = { user: { id: "user", email: "owner@example.test", emailVerified: true } };
    const view = render(wrap(<OrganizationContent />));
    fireEvent.click(view.getByRole("button", { name: "Authenticator ceremony" }));
    const codes = view.getByText("One-time recovery codes");
    mocks.snapshot = { userId: undefined, mine: undefined, error: null }; mocks.data.contextDetail = undefined;
    view.rerender(wrap(<OrganizationContent />));
    expect(codes).not.toBeVisible();
    mocks.snapshot = snapshot; mocks.data.contextDetail = detail;
    view.rerender(wrap(<OrganizationContent />));
    expect(view.getByText("One-time recovery codes")).toBe(codes); expect(codes).toBeVisible();
    mocks.session.data = { user: { id: "other", email: "other@example.test", emailVerified: true } };
    mocks.snapshot = { userId: undefined, mine: undefined, error: null }; mocks.data.contextDetail = undefined;
    view.rerender(wrap(<OrganizationContent />));
    expect(view.queryByText("One-time recovery codes")).not.toBeInTheDocument();
  });

  it("starts/resumes the same ID and only completes after server proofs plus contact disclosure", async () => {
    const view = render(wrap(<EnrollmentPanel organizationId="org-a" personal started={false} />));
    fireEvent.change(view.getByLabelText(t.name), { target: { value: "Company" } });
    fireEvent.change(view.getByLabelText(t.slug), { target: { value: "company" } });
    fireEvent.submit(view.getByLabelText(t.name).closest("form")!);
    await waitFor(() => expect(mocks.calls.begin).toHaveBeenCalledWith({ organizationId: "org-a", name: "Company", slug: "company" }));
    await waitFor(() => expect(view.getByText(t.enrollment)).toBeInTheDocument());
    expect(view.getByRole("button", { name: t.complete })).toBeDisabled();
    mocks.data.status = { allowed: true, recent: true, hasTotp: true, passkeyPolicy: "required", setup: { passwordVerified: true, backupAcknowledged: false } };
    view.rerender(wrap(<EnrollmentPanel organizationId="org-a" personal started />));
    expect(view.getByText("Passkey ceremony")).toBeInTheDocument();
    submitInput(view, "#organization-password", "strong-password");
    await waitFor(() => expect(mocks.calls.credential).toHaveBeenCalledWith({ organizationId: "org-a", password: "strong-password" }));
    expect(view.container.querySelector("#organization-password")).toHaveValue("");
    fireEvent.change(view.container.querySelector("#organization-recovery-password")!, { target: { value: "strong-password" } });
    fireEvent.change(view.getByLabelText(t.firstCode), { target: { value: "saved-one" } });
    submitInput(view, "#organization-code-two", "saved-two");
    await waitFor(() => expect(mocks.calls.recovery).toHaveBeenCalledWith({ organizationId: "org-a", password: "strong-password", codes: ["saved-one", "saved-two"] }));
    fireEvent.click(view.getByRole("checkbox"));
    expect(view.getByRole("button", { name: t.complete })).toBeDisabled();
    mocks.data.status = { ...mocks.data.status as object, setup: { passwordVerified: true, backupAcknowledged: true } };
    view.rerender(wrap(<EnrollmentPanel organizationId="org-a" personal started />));
    mocks.calls.complete.mockRejectedValueOnce(new Error("ORGANIZATION_READINESS_REQUIRED"));
    fireEvent.click(view.getByRole("button", { name: t.complete }));
    await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent(t.notReady));
    expect(mocks.calls.complete).toHaveBeenCalledWith({ organizationId: "org-a" });
  });

  it("binds directory cursors, expired-invite resend, contact and destructive change to the displayed organization", async () => {
    mocks.data.directory = { page: [{ memberId: "member-a", name: "Contact", email: "contact@example.test", role: "org-admin", adminPending: false, enrolled: true, isContact: true }], isDone: false, continueCursor: "cursor-a" };
    mocks.data.invitations = { page: [{ invitationId: "invite-a", email: "pending@example.test", role: "member", status: "expired", deliveryState: "sent" }], isDone: true }; mocks.data.audit = [];
    const view = render(wrap(<MemberManagement key="org-a" organizationId="org-a" />));
    expect(view.getByText(new RegExp(t.currentContact))).toBeInTheDocument();
    fireEvent.click(view.getAllByRole("button", { name: t.next })[0]!);
    expect(mocks.query).toHaveBeenCalledWith("directory", { organizationId: "org-a", paginationOpts: { cursor: "cursor-a", numItems: 25 } });
    fireEvent.click(view.getByRole("button", { name: t.resend }));
    await waitFor(() => expect(mocks.calls.resend).toHaveBeenCalledWith({ organizationId: "org-a", invitationId: "invite-a" }));
    await waitFor(() => expect(view.getByRole("button", { name: t.setContact })).not.toBeDisabled());
    fireEvent.click(view.getByRole("button", { name: t.setContact }));
    await waitFor(() => expect(mocks.calls.contact).toHaveBeenCalledWith({ organizationId: "org-a", memberId: "member-a" }));
    await waitFor(() => expect(view.getByRole("button", { name: t.remove })).not.toBeDisabled());
    fireEvent.click(view.getByRole("button", { name: t.remove }));
    expect(mocks.calls.change).not.toHaveBeenCalled();
    mocks.calls.change.mockRejectedValueOnce(new Error("LAST_ORGANIZATION_ADMIN"));
    fireEvent.click(within(view.getByRole("alertdialog")).getByRole("button", { name: t.confirm }));
    await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent(t.lastAdmin));
    expect(mocks.calls.change).toHaveBeenCalledWith({ organizationId: "org-a", memberId: "member-a", operation: "remove" });
    setContext("org-b"); view.rerender(wrap(<MemberManagement key="org-b" organizationId="org-b" />));
    expect(view.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mocks.query).toHaveBeenLastCalledWith("audit", { organizationId: "org-b" });
    expect(mocks.query).toHaveBeenCalledWith("directory", { organizationId: "org-b", paginationOpts: { cursor: null, numItems: 25 } });
  });

  it("contains directory revocation and removes all member detail and actions", () => {
    mocks.data.directory = new Error("NOT_ORGANIZATION_ADMIN");
    const view = render(wrap(<MemberManagement organizationId="org-a" />));
    expect(view.getByRole("alert")).toHaveTextContent(t.unavailable);
    expect(view.queryByRole("button", { name: t.sendInvitation })).not.toBeInTheDocument();
  });
});

describe("invitation identity and capability boundaries", () => {
  it("consumes the fragment without rendering the bearer or moving it into a query and preserves tab-local resume", async () => {
    inviteUrl(); const view = render(wrap(<InvitationClient />));
    await waitFor(() => expect(view.getByText("Company")).toBeInTheDocument());
    expect(window.location.hash).toBe(""); expect(window.location.search).toBe("");
    expect(view.container.innerHTML).not.toContain(token);
    expect(readOrganizationInvitation()).toEqual({ organizationId: "org-a", token });
    expect(mocks.calls.preview).toHaveBeenCalledWith({ organizationId: "org-a", token });
    expect(view.getByText("Company").closest("[data-agent-sensitive]")).not.toBeNull();
  });

  it("deduplicates StrictMode previews and processes a replacement fragment in the same document", async () => {
    inviteUrl(); const view = render(<StrictMode>{wrap(<InvitationClient />)}</StrictMode>);
    await waitFor(() => expect(view.getByText("Company")).toBeInTheDocument());
    expect(mocks.calls.preview).toHaveBeenCalledOnce();
    const nextToken = "c".repeat(64);
    act(() => { window.history.replaceState({}, "", `/en/organization-invitation#organizationId=org-b&token=${nextToken}`); window.dispatchEvent(new Event("hashchange")); });
    await waitFor(() => expect(mocks.calls.preview).toHaveBeenCalledTimes(2));
    expect(mocks.calls.preview).toHaveBeenLastCalledWith({ organizationId: "org-b", token: nextToken });
    expect(window.location.hash).toBe(""); expect(view.container.innerHTML).not.toContain(nextToken);
  });

  it("claims registration, sends actual signup arguments, and can resend before the first authenticated session", async () => {
    inviteUrl(); const view = render(wrap(<InvitationClient />));
    await waitFor(() => expect(view.getByRole("button", { name: t.newAccount })).toBeInTheDocument());
    fireEvent.click(view.getByRole("button", { name: t.newAccount }));
    fireEvent.change(view.getByLabelText(t.yourName), { target: { value: "New member" } });
    submitInput(view, "#invitation-password", "strong password");
    await waitFor(() => expect(mocks.calls.register).toHaveBeenCalledWith({ capability, email: "invitee@example.test", name: "New member", password: "strong password" }));
    expect(mocks.calls.claim).toHaveBeenCalledWith({ organizationId: "org-a", token });
    expect(readOrganizationInvitation()?.capability).toBe(capability);
    fireEvent.click(await view.findByRole("button", { name: t.sendVerification }));
    await waitFor(() => expect(mocks.calls.registrationVerification).toHaveBeenCalledWith({ capability, email: "invitee@example.test" }));
    expect(mocks.calls.accept).not.toHaveBeenCalled();
  });

  it("offers account switching to the wrong identity and force-verifies the correct unverified one", async () => {
    inviteUrl(); mocks.authenticated = true; mocks.session.data = { user: { id: "wrong", email: "wrong@example.test", emailVerified: true } };
    const view = render(wrap(<InvitationClient />));
    await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent(t.wrongAccount));
    expect(view.queryByRole("button", { name: t.acceptInvitation })).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: t.switchAccount }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    mocks.session.data = { user: { id: "right", email: "invitee@example.test", emailVerified: false } };
    view.rerender(wrap(<InvitationClient />));
    expect(await view.findByRole("button", { name: t.acceptInvitation })).toBeDisabled();
    fireEvent.click(view.getByRole("button", { name: t.sendVerification }));
    await waitFor(() => expect(mocks.calls.verifyEmail).toHaveBeenCalledWith({ organizationId: "org-a", token }));
  });

  it("rejects expired links and never uses a token supplied through the query string", async () => {
    window.history.replaceState({}, "", `/?organizationId=org-a&token=${token}`);
    const view = render(wrap(<InvitationClient />));
    await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent(t.invalidInvitation));
    expect(mocks.calls.preview).not.toHaveBeenCalled(); expect(mocks.calls.accept).not.toHaveBeenCalled();
    view.unmount(); inviteUrl(); mocks.calls.preview.mockRejectedValueOnce(new Error("INVALID_MEMBER_INVITATION"));
    const expired = render(wrap(<InvitationClient />));
    await waitFor(() => expect(expired.getByRole("alert")).toHaveTextContent(t.invalidInvitation));
    expect(expired.queryByRole("button", { name: t.newAccount })).not.toBeInTheDocument();
  });

  it("holds a late accepted result after account change and retains the invitation for retry", async () => {
    inviteUrl(); mocks.authenticated = true; mocks.session.data = { user: { id: "right", email: "invitee@example.test", emailVerified: true } };
    let release!: (result: object) => void; mocks.calls.accept.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const view = render(wrap(<InvitationClient />));
    fireEvent.click(await view.findByRole("button", { name: t.acceptInvitation }));
    mocks.session.data = { user: { id: "other", email: "other@example.test", emailVerified: true } }; view.rerender(wrap(<InvitationClient />));
    await act(async () => release({ organizationId: "org-a", adminPending: true }));
    expect(mocks.push).not.toHaveBeenCalled(); expect(readOrganizationInvitation()?.token).toBe(token);
    expect(window.sessionStorage.getItem("organization-context:right")).toBeNull();
  });

  it("accepts an exact verified account and opens pending administrator setup with its immutable ID", async () => {
    inviteUrl(); mocks.authenticated = true; mocks.session.data = { user: { id: "right", email: "invitee@example.test", emailVerified: true } };
    mocks.calls.accept.mockResolvedValue({ organizationId: "org-a", adminPending: true });
    const view = render(wrap(<InvitationClient />));
    fireEvent.click(await view.findByRole("button", { name: t.acceptInvitation }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard/organization?organizationId=org-a"));
    expect(readOrganizationInvitation()).toBeNull(); expect(window.sessionStorage.getItem("organization-context:right")).toBe("org-a");
  });

  it("does not let an old acceptance replace a newer invitation in the same tab", async () => {
    inviteUrl(); mocks.authenticated = true; mocks.session.data = { user: { id: "right", email: "invitee@example.test", emailVerified: true } };
    let release!: (result: object) => void; mocks.calls.accept.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const view = render(wrap(<InvitationClient />));
    fireEvent.click(await view.findByRole("button", { name: t.acceptInvitation }));
    const nextToken = "c".repeat(64);
    act(() => { window.history.replaceState({}, "", `/en/organization-invitation#organizationId=org-b&token=${nextToken}`); window.dispatchEvent(new Event("hashchange")); });
    await waitFor(() => expect(mocks.calls.preview).toHaveBeenCalledTimes(2));
    await act(async () => release({ organizationId: "org-a", adminPending: false }));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(readOrganizationInvitation()).toEqual({ organizationId: "org-b", token: nextToken });
    expect(window.sessionStorage.getItem("organization-context:right")).toBeNull();
  });

  it("does not register from a delayed claim after replacing the invitation", async () => {
    inviteUrl(); let release!: (result: object) => void;
    mocks.calls.claim.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const view = render(wrap(<InvitationClient />));
    fireEvent.click(await view.findByRole("button", { name: t.newAccount }));
    fireEvent.change(view.getByLabelText(t.yourName), { target: { value: "New member" } });
    submitInput(view, "#invitation-password", "strong password");
    await waitFor(() => expect(mocks.calls.claim).toHaveBeenCalledOnce());
    const nextToken = "c".repeat(64);
    act(() => { window.history.replaceState({}, "", `/en/organization-invitation#organizationId=org-b&token=${nextToken}`); window.dispatchEvent(new Event("hashchange")); });
    await act(async () => release({ capability }));
    expect(mocks.calls.register).not.toHaveBeenCalled();
    expect(readOrganizationInvitation()).toEqual({ organizationId: "org-b", token: nextToken });
  });
});
