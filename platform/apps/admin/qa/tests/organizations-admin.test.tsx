import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/** The admin Organizations page: listing, details, and the owner rule in the support actions. */
const mocks = vi.hoisted(() => ({
  page: { results: [] as unknown[], status: "Exhausted" as string, loadMore: vi.fn() },
  detail: undefined as unknown,
  mutation: vi.fn(),
}));

vi.mock("@repo/backend", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: new Proxy({}, { get: () => new Proxy({}, { get: () => new Proxy({}, { get: (_target, key) => String(key) }) }) }),
}));
vi.mock("convex-helpers/react", () => ({ usePaginatedQuery: () => mocks.page }));
vi.mock("convex/react", () => ({
  useQuery: (_ref: string, args: unknown) => (args === "skip" ? undefined : mocks.detail),
  useMutation: (ref: string) => (args: unknown) => mocks.mutation(ref, args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { OrganizationsDataTable } from "../../src/components/organizations/organizations-data-table";

const summary = {
  id: "org1", name: "Acme", createdAt: Date.UTC(2026, 9, 1), memberCount: 2, pendingInvitations: 1, morePendingInvitations: false,
  owners: [{ userId: "u1", name: "Ada", email: "ada@example.test", banned: false }],
};
const member = (userId: string, email: string, role: string) => ({
  memberId: `m-${userId}`, userId, name: "", email, role, joinedAt: Date.UTC(2026, 9, 2), banned: false,
});

function renderPage(members = [member("u1", "ada@example.test", "owner"), member("u2", "bob@example.test", "admin")]) {
  mocks.page.results = [summary];
  mocks.detail = { ...summary, members, invitations: [
    { id: "i1", email: "carol@example.test", role: "member", status: "pending", sentAt: Date.now(), expiresAt: Date.now() + 1 },
  ] };
  render(<OrganizationsDataTable />);
  fireEvent.click(screen.getByRole("button", { name: "Acme" }));
  return screen.getByRole("dialog");
}

describe("admin organizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutation.mockResolvedValue(null);
  });

  test("lists organizations with owners and counts", () => {
    mocks.page.results = [summary];
    render(<OrganizationsDataTable />);
    const row = screen.getAllByRole("row")[1]!;
    expect(row.textContent).toContain("Acme");
    expect(row.textContent).toContain("ada@example.test");
  });

  test("a list row caps the live pending invitation count at 100+", () => {
    mocks.page.results = [{ ...summary, pendingInvitations: 100, morePendingInvitations: true }];
    render(<OrganizationsDataTable />);
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells[3]!.textContent).toBe("100+");
  });

  test("the only owner offers no way to be removed; other members can be made owners", async () => {
    const dialog = renderPage();
    const rows = within(dialog).getAllByTestId("organization-member");
    expect(within(rows[0]!).getByText("Only owner")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Remove as owner" })).not.toBeInTheDocument();

    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Make owner" }));
    fireEvent.click(screen.getByRole("button", { name: "Make owner" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith("addOwner", { organizationId: "org1", userId: "u2" }));
  });

  test("with two owners either can be removed as owner, and a refusal is explained", async () => {
    mocks.mutation.mockRejectedValue(new Error("[CONVEX M(platform/adminOrganizations:removeOwner)] Uncaught Error: LAST_OWNER"));
    const dialog = renderPage([member("u1", "ada@example.test", "owner"), member("u2", "bob@example.test", "owner")]);
    expect(within(dialog).getAllByRole("button", { name: "Remove as owner" })).toHaveLength(2);
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Remove as owner" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Make admin" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Every organization needs an owner")));
  });

  test("deleting requires typing the organization's name", async () => {
    const dialog = renderPage();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete organization" }));
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: "Acme" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith("remove", { organizationId: "org1" }));
  });

  test("a pending invitation can be canceled", async () => {
    const dialog = renderPage();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel invitation" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith("cancelInvitation", { invitationId: "i1" }));
  });
});

describe("banning an organization's only owner who can act", () => {
  test("the ban dialog preselects a successor and passes it with the ban", async () => {
    const { BanDialog } = await import("../../src/components/users/ban-dialog");
    mocks.detail = [{
      organizationId: "org1", name: "Acme", role: "owner", memberCount: 2, soleOwner: true,
      onAccountDeletion: "ownershipPasses", successor: null,
      banSuccessor: { suggested: "u2", candidates: [{ userId: "u2", name: "", email: "bob@example.test", role: "admin" }] },
    }];
    const onConfirm = vi.fn();
    render(<BanDialog open onOpenChange={() => {}} onConfirm={onConfirm}
      users={[{ id: "u1", email: "ada@example.test" } as never]} />);
    expect(screen.getByTestId("ban-successors").textContent).toContain("Acme");
    fireEvent.change(screen.getByLabelText(/Ban reason/), { target: { value: "abuse" } });
    fireEvent.click(screen.getByRole("button", { name: "Ban user" }));
    expect(onConfirm).toHaveBeenCalledWith("abuse", undefined, [{ organizationId: "org1", userId: "u2" }]);
  });
});
