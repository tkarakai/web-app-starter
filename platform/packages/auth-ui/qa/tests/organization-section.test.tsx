import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@web-app-starter/i18n/messages/en.json";
import { SidebarProvider } from "@web-app-starter/design-system";
import { EnsureOrganization } from "../../src/components/organization-invitations";
import { OrganizationSwitcher } from "../../src/components/organization-switcher";
import { OrganizationSection } from "../../src/settings/organization-section";

type Org = { id: string; name: string; role: string };
const mocks = vi.hoisted(() => ({
  active: undefined as unknown,
  mine: undefined as { activeOrganizationId: string | null; organizations: Org[] } | undefined,
  ensure: vi.fn(),
  inviteMember: vi.fn(),
  cancelInvitation: vi.fn(),
  leave: vi.fn(),
  deleteOrganization: vi.fn(),
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (query: Parameters<typeof getFunctionName>[0]) =>
      (getFunctionName(query) === "platform/organizations:active" ? mocks.active : mocks.mine),
    useMutation: () => mocks.ensure,
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
// The gate has its own tests; here it stands for "recently authenticated".
vi.mock("../../src/components/session-access-gate", () => ({ SessionAccessGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@web-app-starter/auth/client", () => ({
  authClient: {
    organization: {
      inviteMember: mocks.inviteMember, cancelInvitation: mocks.cancelInvitation, leave: mocks.leave,
      delete: mocks.deleteOrganization, update: vi.fn(), updateMemberRole: vi.fn(), removeMember: vi.fn(), setActive: vi.fn(),
    },
  },
}));
vi.mock("@web-app-starter/design-system", async (importOriginal) => ({
  ...await importOriginal<typeof import("@web-app-starter/design-system")>(),
  toast: { success: mocks.success, error: mocks.error, info: mocks.info },
}));

const t = messages.organization;
const you = { memberId: "m-1", name: "Ada", email: "ada@example.test", role: "owner", joinedAt: 1, isYou: true };
const bob = { memberId: "m-2", name: "Bob", email: "bob@example.test", role: "member", joinedAt: 2, isYou: false };
const DAY = 86_400_000;
const invitation = (email: string, status: string) => ({
  id: `inv-${email}`, email, role: "member", status, sentAt: Date.now() - DAY, expiresAt: Date.now() + 6 * DAY,
});
function organization(overrides: Record<string, unknown> = {}) {
  return { id: "org-1", name: "Acme", role: "owner", memberCount: 2, members: [you, bob], invitations: [], ...overrides };
}
const two = { activeOrganizationId: "org-1", organizations: [{ id: "org-1", name: "Acme", role: "owner" }, { id: "org-2", name: "Ada", role: "owner" }] };

function wrap(node: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">{node}</NextIntlClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const call of [mocks.inviteMember, mocks.cancelInvitation, mocks.leave, mocks.deleteOrganization]) call.mockResolvedValue({ data: {} });
  mocks.ensure.mockResolvedValue("org-new");
  mocks.active = organization();
  mocks.mine = two;
});

describe("organization page", () => {
  it("lines up the invite form in one row: email, role and send", () => {
    render(wrap(<OrganizationSection />));
    const form = screen.getByLabelText(t.invite.email).closest("form")!;
    expect(form.className).toMatch(/sm:grid-cols-\[minmax\(0,1fr\)_9rem_auto\]/);
    expect(form.className).toMatch(/sm:items-end/);
    expect(within(form).getByRole("button", { name: t.invite.send })).toBeInTheDocument();
  });

  it("lists pending, expired and declined invitations so the inviter sees what became of each", async () => {
    mocks.active = organization({
      invitations: [invitation("new@example.test", "pending"), invitation("late@example.test", "expired"), invitation("no@example.test", "declined")],
    });
    render(wrap(<OrganizationSection />));
    const rows = within(screen.getByTestId("organization-invitations")).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-status"))).toEqual(["pending", "expired", "declined"]);
    expect(within(rows[1]).getByText(t.pending.expired)).toBeInTheDocument();
    expect(within(rows[2]).getByText(t.pending.declined)).toBeInTheDocument();
    // A declined invitation can't be resent or canceled, only replaced by a new one.
    expect(within(rows[2]).queryByRole("button", { name: t.pending.cancel })).not.toBeInTheDocument();
    fireEvent.click(within(rows[2]).getByRole("button", { name: t.pending.inviteAgain }));
    await waitFor(() => expect(mocks.inviteMember).toHaveBeenCalledWith({
      organizationId: "org-1", email: "no@example.test", role: "member", resend: false,
    }));
    fireEvent.click(within(rows[1]).getByRole("button", { name: t.pending.resend }));
    await waitFor(() => expect(mocks.inviteMember).toHaveBeenCalledWith(expect.objectContaining({ email: "late@example.test", resend: true })));
  });

  it("has no create button; the last section is the owners' danger zone", () => {
    render(wrap(<OrganizationSection />));
    expect(screen.queryByRole("button", { name: t.create.action })).not.toBeInTheDocument();
    const sections = screen.getByTestId("organization-settings").children;
    expect(sections[sections.length - 1]).toHaveAttribute("data-testid", "organization-danger-zone");
  });

  it("hides the danger zone and member controls from members", () => {
    mocks.active = organization({ role: "member", members: [{ ...you, role: "member" }, { ...bob, role: "owner" }] });
    render(wrap(<OrganizationSection />));
    expect(screen.queryByTestId("organization-danger-zone")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t.invite.email)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.leave.action })).toBeInTheDocument();
  });

  it("offers Leave on your own row, except as the last owner or in your only organization", () => {
    const { rerender } = render(wrap(<OrganizationSection />));
    expect(screen.queryByRole("button", { name: t.leave.action })).not.toBeInTheDocument();
    mocks.active = organization({ members: [you, { ...bob, role: "owner" }] });
    rerender(wrap(<OrganizationSection />));
    expect(screen.getByRole("button", { name: t.leave.action })).toBeInTheDocument();
    mocks.mine = { ...two, organizations: two.organizations.slice(0, 1) };
    rerender(wrap(<OrganizationSection />));
    expect(screen.queryByRole("button", { name: t.leave.action })).not.toBeInTheDocument();
  });

  it("deletes only once the owner types the organization's name", async () => {
    render(wrap(<OrganizationSection />));
    fireEvent.click(screen.getByRole("button", { name: t.danger.delete }));
    const confirm = screen.getByRole("button", { name: t.danger.confirm });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type Acme to confirm"), { target: { value: "Acm" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type Acme to confirm"), { target: { value: "Acme" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.deleteOrganization).toHaveBeenCalledWith({ organizationId: "org-1" }));
    expect(mocks.success).toHaveBeenCalledWith("Acme was deleted.");
    expect(mocks.push).toHaveBeenCalledWith("/en/dashboard");
  });

  it("warns that deleting the only organization leaves a new, empty one", () => {
    mocks.mine = { ...two, organizations: two.organizations.slice(0, 1) };
    render(wrap(<OrganizationSection />));
    fireEvent.click(screen.getByRole("button", { name: t.danger.delete }));
    expect(screen.getByText(new RegExp(t.danger.onlyOrganization.replace(/[.,]/g, "\\$&")))).toBeInTheDocument();
  });
});

describe("organization switcher", () => {
  it("opens a menu to create an organization even with only one, and has no settings entry", async () => {
    mocks.mine = { ...two, organizations: two.organizations.slice(0, 1) };
    render(wrap(<SidebarProvider><OrganizationSwitcher logo={null} productName="Product" /></SidebarProvider>));
    const trigger = screen.getByRole("button", { name: t.switcher.label });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: t.switcher.create })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /settings/i })).not.toBeInTheDocument();
  });
});

describe("lost access", () => {
  it("tells the user when an organization disappears without their doing", () => {
    const { rerender } = render(wrap(<EnsureOrganization />));
    mocks.mine = { activeOrganizationId: "org-1", organizations: two.organizations.slice(0, 1) };
    act(() => rerender(wrap(<EnsureOrganization />)));
    expect(mocks.info).toHaveBeenCalledWith("You no longer have access to Ada.");
  });

  it("stays quiet when the user left it themselves", async () => {
    // Its own ID: other tests leave departures of org-1 behind.
    mocks.mine = { activeOrganizationId: "org-3", organizations: [{ id: "org-3", name: "Left", role: "member" }, two.organizations[1]] };
    mocks.active = organization({ id: "org-3", name: "Left", members: [you, { ...bob, role: "owner" }] });
    const page = () => wrap(<><EnsureOrganization /><OrganizationSection /></>);
    const { rerender } = render(page());
    fireEvent.click(screen.getByRole("button", { name: t.leave.action }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: t.leave.action }));
    await waitFor(() => expect(mocks.leave).toHaveBeenCalled());
    mocks.mine = { activeOrganizationId: "org-2", organizations: two.organizations.slice(1) };
    mocks.active = organization({ id: "org-2", name: "Ada" });
    act(() => rerender(page()));
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("gives a user left with no organization a new personal one", () => {
    mocks.mine = { activeOrganizationId: null, organizations: [] };
    render(wrap(<EnsureOrganization />));
    expect(mocks.ensure).toHaveBeenCalledWith({});
  });
});
