import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@web-app-starter/i18n/messages/en.json";
import { AcceptInvitation, ResumeInvitation } from "../../src/components/accept-invitation";
import { rememberInvitation } from "../../src/lib/organization";

const mocks = vi.hoisted(() => ({
  auth: { isAuthenticated: true, isLoading: false },
  invitation: undefined as unknown,
  assurance: undefined as unknown,
  sendVerificationEmail: vi.fn(),
  acceptInvitation: vi.fn(),
  rejectInvitation: vi.fn(),
  setActive: vi.fn(),
  signOut: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => mocks.auth,
  useQuery: (_query: unknown, args: unknown) => (args && typeof args === "object" && "id" in args ? mocks.invitation : mocks.assurance),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("../../src/lib/use-sign-out", () => ({ useSignOut: () => mocks.signOut }));
vi.mock("@web-app-starter/auth/client", () => ({
  isAuthRateLimited: (error: { status?: number }) => error.status === 429,
  authClient: {
    sendVerificationEmail: mocks.sendVerificationEmail,
    organization: { acceptInvitation: mocks.acceptInvitation, rejectInvitation: mocks.rejectInvitation, setActive: mocks.setActive },
  },
}));
vi.mock("@web-app-starter/design-system", async (importOriginal) => ({
  ...await importOriginal<typeof import("@web-app-starter/design-system")>(),
  toast: { success: mocks.success, error: mocks.error },
}));

const t = messages.organization.invitation;
const details = { organizationName: "Acme", inviterName: "Ada", role: "member", email: "bob@example.test" };
const stored = () => window.localStorage.getItem("organization-invitation");

function renderPage() {
  render(<NextIntlClientProvider locale="en" messages={messages}><AcceptInvitation invitationId="inv-1" /></NextIntlClientProvider>);
}

describe("accept invitation page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.auth = { isAuthenticated: true, isLoading: false };
    mocks.invitation = undefined;
    for (const mock of [mocks.sendVerificationEmail, mocks.acceptInvitation, mocks.rejectInvitation, mocks.setActive]) {
      mock.mockReset().mockResolvedValue({ data: {} });
    }
    mocks.push.mockReset();
    mocks.signOut.mockReset();
    mocks.success.mockReset();
  });

  it("reveals nothing while signed out, and remembers the link for after sign-in", () => {
    mocks.auth = { isAuthenticated: false, isLoading: false };
    renderPage();
    expect(screen.getByTestId("accept-invitation")).toHaveAttribute("data-state", "signedOut");
    expect(screen.queryByText(/Acme|Ada/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: t.signIn })).toHaveAttribute("href", "/en/sign-in");
    expect(screen.getByRole("link", { name: t.signUp })).toHaveAttribute("href", "/en/sign-up?invitation=inv-1");
    expect(JSON.parse(stored()!)).toMatchObject({ id: "inv-1" });
  });

  it("forgets the remembered link once signed in, whatever the answer", () => {
    rememberInvitation("inv-1");
    mocks.invitation = { state: "invalid" };
    renderPage();
    expect(stored()).toBeNull();
  });

  it("says vaguely that a spent, expired or unknown invitation is no longer valid", () => {
    mocks.invitation = { state: "invalid" };
    renderPage();
    expect(screen.getByText(t.invalidTitle)).toBeInTheDocument();
    expect(screen.getByText(t.invalidDescription)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.accept })).not.toBeInTheDocument();
  });

  it("tells another signed-in account the invitation isn't theirs, without naming its address", () => {
    mocks.invitation = { state: "wrongAccount", signedInAs: "eve@example.test" };
    renderPage();
    expect(screen.getByText(t.wrongAccountTitle)).toBeInTheDocument();
    expect(screen.getByText(/eve@example\.test/)).toBeInTheDocument();
    expect(screen.queryByText(/bob@example\.test|Acme/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.accept })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.switchAccount }));
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it("sends the verification email in place and returns to this invitation afterwards", async () => {
    mocks.invitation = { state: "verify", ...details };
    renderPage();
    expect(screen.getByText(t.verifyTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.verify }));
    await waitFor(() => expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      email: "bob@example.test", callbackURL: "/en/accept-invitation/inv-1",
    }));
    expect(mocks.success).toHaveBeenCalledWith(messages.auth.verifyEmail.resent);
  });

  it("sends a session that must finish security setup to the dashboard, to come back after", () => {
    mocks.invitation = { state: "security", ...details };
    renderPage();
    expect(screen.getByText(t.securityTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: t.continueSetup }));
    expect(JSON.parse(stored()!)).toMatchObject({ id: "inv-1" });
  });

  it("opens the organization for someone who is already a member", async () => {
    mocks.invitation = { state: "member", organizationId: "org-1", organizationName: "Acme" };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Open Acme" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/en/dashboard"));
    expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: "org-1" });
  });

  it("accepts and opens the dashboard in the new organization", async () => {
    mocks.invitation = { state: "open", ...details };
    renderPage();
    expect(screen.getByText("Ada invited you to join Acme as Member.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.accept }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/en/dashboard"));
    expect(mocks.acceptInvitation).toHaveBeenCalledWith({ invitationId: "inv-1" });
    expect(mocks.success).toHaveBeenCalledWith("You joined Acme.");
  });

  it("declines and says so", async () => {
    mocks.invitation = { state: "open", ...details };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: t.decline }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith(t.declined));
    expect(mocks.rejectInvitation).toHaveBeenCalledWith({ invitationId: "inv-1" });
  });
});

describe("returning to an invitation after sign-in", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.replace.mockReset();
  });

  const renderResume = () => render(<NextIntlClientProvider locale="en" messages={messages}><ResumeInvitation /></NextIntlClientProvider>);

  it("waits until the session may act, then opens the remembered invitation once", () => {
    rememberInvitation("inv-1");
    mocks.assurance = { allowed: false };
    const { rerender } = renderResume();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(stored()).not.toBeNull();

    mocks.assurance = { allowed: true };
    rerender(<NextIntlClientProvider locale="en" messages={messages}><ResumeInvitation /></NextIntlClientProvider>);
    expect(mocks.replace).toHaveBeenCalledWith("/en/accept-invitation/inv-1");
    expect(stored()).toBeNull();
  });

  it("ignores a stale link", () => {
    vi.useFakeTimers();
    try {
      rememberInvitation("inv-1");
      act(() => vi.advanceTimersByTime(25 * 60 * 60 * 1000));
      mocks.assurance = { allowed: true };
      renderResume();
      expect(mocks.replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
