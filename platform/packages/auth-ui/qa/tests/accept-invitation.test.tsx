import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@web-app-starter/i18n/messages/en.json";
import { AcceptInvitation } from "../../src/components/accept-invitation";

const mocks = vi.hoisted(() => ({
  auth: { isAuthenticated: true, isLoading: false },
  invitation: undefined as unknown,
  sendVerificationEmail: vi.fn(),
  acceptInvitation: vi.fn(),
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => mocks.auth,
  useQuery: () => mocks.invitation,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@web-app-starter/auth/client", () => ({
  isAuthRateLimited: (error: { status?: number }) => error.status === 429,
  authClient: {
    sendVerificationEmail: mocks.sendVerificationEmail,
    signOut: vi.fn(),
    organization: { acceptInvitation: mocks.acceptInvitation, rejectInvitation: vi.fn() },
  },
}));
vi.mock("@web-app-starter/design-system", async (importOriginal) => ({
  ...await importOriginal<typeof import("@web-app-starter/design-system")>(),
  toast: { success: mocks.success, error: mocks.error },
}));

const t = messages.organization.invitation;
const valid = {
  id: "inv-1", organizationName: "Acme", inviterName: "Ada", email: "bob@example.test", role: "member",
  status: "pending", expired: false, isRecipient: true, signedInAs: "bob@example.test",
  emailVerified: true, alreadyMember: false, ready: true,
};

function renderPage() {
  render(<NextIntlClientProvider locale="en" messages={messages}><AcceptInvitation invitationId="inv-1" /></NextIntlClientProvider>);
}

describe("accept invitation page", () => {
  beforeEach(() => {
    mocks.auth = { isAuthenticated: true, isLoading: false };
    mocks.sendVerificationEmail.mockReset().mockResolvedValue({ data: { status: true } });
    mocks.acceptInvitation.mockReset().mockResolvedValue({ data: {} });
    mocks.push.mockReset();
    mocks.success.mockReset();
  });

  it("sends a signed-out visitor to sign in or create an account for the invitation", () => {
    mocks.auth = { isAuthenticated: false, isLoading: false };
    renderPage();
    expect(screen.getByText(t.signedOutTitle)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t.signUp })).toHaveAttribute("href", "/en/sign-up?invitation=inv-1");
  });

  it("sends the verification email in place and returns to this invitation afterwards", async () => {
    mocks.invitation = { ...valid, emailVerified: false, ready: false };
    renderPage();
    expect(screen.getByText(t.verifyTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.verify }));
    await waitFor(() => expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      email: "bob@example.test", callbackURL: "/en/accept-invitation/inv-1",
    }));
    expect(mocks.success).toHaveBeenCalledWith(messages.auth.verifyEmail.resent);
  });

  it("explains a missing security step, a different account and an unknown invitation", () => {
    mocks.invitation = { ...valid, ready: false };
    renderPage();
    expect(screen.getByText(t.securityTitle)).toBeInTheDocument();
  });

  it("names both addresses when signed in as someone else", () => {
    mocks.invitation = { ...valid, isRecipient: false, signedInAs: "eve@example.test" };
    renderPage();
    expect(screen.getByText(t.wrongAccountTitle)).toBeInTheDocument();
    expect(screen.getByText(/eve@example\.test/)).toBeInTheDocument();
  });

  it("accepts and opens the dashboard in the new organization", async () => {
    mocks.invitation = valid;
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: t.accept }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/en/dashboard"));
    expect(mocks.acceptInvitation).toHaveBeenCalledWith({ invitationId: "inv-1" });
  });

  it("reports an unknown invitation", () => {
    mocks.invitation = null;
    renderPage();
    expect(screen.getByText(t.notFoundTitle)).toBeInTheDocument();
  });
});
