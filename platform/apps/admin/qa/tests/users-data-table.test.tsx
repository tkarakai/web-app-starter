import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * User-visible behaviour of the users table: server-side sorting parameters, the client-side status
 * sort and filter, column visibility, row selection (never self or protected admins) and
 * "Load more". It goes through the rendered UI only, so it holds across table-library versions.
 */
type Params = Record<string, string | undefined>;
const mocks = vi.hoisted(() => ({
  users: [] as Array<Record<string, unknown>>,
  loading: false,
  hasMore: false,
  total: 0,
  loadMore: vi.fn(),
  refresh: vi.fn(),
  calls: [] as Params[],
}));

vi.mock("@repo/backend", () => ({
  api: new Proxy({}, { get: () => new Proxy({}, { get: () => new Proxy({}, { get: (_target, key) => String(key) }) }) }),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: vi.fn(), mutation: vi.fn() }),
  useMutation: () => vi.fn(),
  useQuery: () => ["protected@example.test"],
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/admin-api", () => ({ banUser: vi.fn(), unbanUser: vi.fn() }));
vi.mock("@/components/auth/auth-guard", () => ({ useAuthUser: () => ({ id: "u-self" }) }));
vi.mock("@/hooks/use-users", () => ({
  useUsers: (params: Params) => {
    mocks.calls.push(params);
    const rows = params.status ? mocks.users.filter(row => params.status === "banned" ? row.banned : !row.banned) : mocks.users;
    return { users: rows, total: rows.length, loading: mocks.loading, loadingMore: false, hasMore: mocks.hasMore, loadMore: mocks.loadMore, refresh: mocks.refresh, error: null };
  },
}));
vi.mock("../../src/components/users/user-sessions-dialog", () => ({ UserSessionsDialog: () => null }));

import { UsersDataTable } from "../../src/components/users/users-data-table";

const user = (id: string, name: string, email: string, banned = false) => ({
  id, name, email, role: "admin", banned, banReason: null, banExpires: null, image: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
  emailVerified: true, phoneNumber: null, phoneNumberVerified: false, twoFactorEnabled: false,
});
const SELF = user("u-self", "Sam Self", "self@example.test");
const PROTECTED = user("u-prot", "Pat Protected", "protected@example.test");
const ANN = user("u-ann", "Ann", "ann@example.test");
const BEN = user("u-ben", "Ben", "ben@example.test", true);
const CY = user("u-cy", "Cy", "cy@example.test");

/** The email cell of each body row (the name cell sits right before it, so match the whole cell). */
const emails = (): string[] =>
  screen.getAllByRole("row").slice(1).map((row) =>
    within(row).queryAllByRole("cell").map((cell) => cell.textContent ?? "").find((text) => /^[a-z]+@example\.test$/.test(text)) ?? "");
const header = (name: RegExp) => screen.getByRole("button", { name });
const lastParams = (): Params => mocks.calls[mocks.calls.length - 1];

function renderTable(users: Array<Record<string, unknown>> = [SELF, PROTECTED, ANN, BEN, CY], options: { loading?: boolean; hasMore?: boolean } = {}) {
  mocks.users = users;
  mocks.total = users.length;
  mocks.loading = options.loading ?? false;
  mocks.hasMore = options.hasMore ?? false;
  return render(<UsersDataTable />);
}

const openMenu = (trigger: HTMLElement) => fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });

describe("users table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls = [];
  });

  test("lists the users with the default columns; optional columns start hidden", () => {
    renderTable();
    expect(emails()).toEqual(["self@example.test", "protected@example.test", "ann@example.test", "ben@example.test", "cy@example.test"]);
    expect(screen.getByText("5 operators loaded")).toBeInTheDocument();
    for (const label of ["Name", "Email", "Account"]) expect(screen.getByRole("columnheader", { name: label })).toBeInTheDocument();
    for (const label of [/^Status/, /^Created/]) expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    for (const hidden of ["Email Verified", "Phone", "Phone Verified", "2FA"]) {
      expect(screen.queryByRole("columnheader", { name: hidden })).not.toBeInTheDocument();
    }
  });

  test("shows and hides optional columns from the Columns menu", () => {
    renderTable();
    // An open menu hides the rest of the page from role queries, hence `hidden: true`.
    const visible = { hidden: true };
    openMenu(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "2FA" }));
    expect(screen.getByRole("columnheader", { name: "2FA", ...visible })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Created" }));
    expect(screen.queryByRole("button", { name: /^Created/, ...visible })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "2FA" }));
    expect(screen.queryByRole("columnheader", { name: "2FA", ...visible })).not.toBeInTheDocument();
  });

  test("only creation-time sorting is offered to the server", () => {
    renderTable();
    expect(lastParams()).toEqual({});
    expect(screen.queryByRole("button", { name: /^Name/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Email/ })).not.toBeInTheDocument();
    fireEvent.click(header(/^Created/));
    expect(lastParams()).toEqual({ sortBy: "createdAt", sortDirection: "asc" });
    fireEvent.click(header(/^Created/));
    expect(lastParams()).toEqual({ sortBy: "createdAt", sortDirection: "desc" });
    // The server owns the order: the rows stay as returned.
    expect(emails()[0]).toBe("self@example.test");
  });

  test("sorting by status happens in the browser, not on the server", () => {
    renderTable();
    fireEvent.click(header(/^Status/));
    expect(lastParams()).toEqual({});
    expect(emails()).toEqual(["self@example.test", "protected@example.test", "ann@example.test", "cy@example.test", "ben@example.test"]);
    fireEvent.click(header(/^Status/));
    expect(emails()).toEqual(["ben@example.test", "self@example.test", "protected@example.test", "ann@example.test", "cy@example.test"]);
  });

  test("searching asks the server after a short pause", async () => {
    renderTable();
    fireEvent.change(screen.getByPlaceholderText("Search operators by name or email..."), { target: { value: "an" } });
    await waitFor(() => expect(lastParams()).toEqual({ searchValue: "an" }));
  });

  test("requests status filtering from the server", async () => {
    renderTable();
    openMenu(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Banned" }));
    await waitFor(() => expect(emails()).toEqual(["ben@example.test"]));
    expect(lastParams()).toEqual({ status: "banned" });
    expect(screen.getByText("1 operator loaded")).toBeInTheDocument();
  });

  test("selects every selectable row, never yourself or a protected admin", () => {
    renderTable();
    const rows = () => screen.getAllByRole("row").slice(1);
    expect(within(rows()[0]).getByRole("checkbox", { name: "Select row" })).toBeDisabled(); // self
    expect(within(rows()[1]).getByRole("checkbox", { name: "Select row" })).toBeDisabled(); // protected
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    for (const name of ["Ban", "Unban"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    // Self and protected rows are not selected.
    expect(within(rows()[0]).getByRole("checkbox", { name: "Select row" })).toHaveAttribute("aria-checked", "false");
    expect(within(rows()[1]).getByRole("checkbox", { name: "Select row" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.queryByText(/ selected$/)).not.toBeInTheDocument();
  });

  test("selects a single row and keeps it selected", () => {
    renderTable();
    const rows = screen.getAllByRole("row").slice(1);
    fireEvent.click(within(rows[2]).getByRole("checkbox", { name: "Select row" })); // ann
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(within(rows[3]).getByRole("checkbox", { name: "Select row" })); // ben
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(within(rows[2]).getByRole("checkbox", { name: "Select row" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  test("clears the selection when the sort changes", () => {
    renderTable();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Created/ }));
    expect(screen.queryByText(/ selected$/)).not.toBeInTheDocument();
  });

  test("loads more users on request", () => {
    renderTable([ANN], { hasMore: true });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(mocks.loadMore).toHaveBeenCalledTimes(1);
  });

  test("shows an empty state, and a loading state", () => {
    const { unmount } = renderTable([]);
    expect(screen.getByText("No operators found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    unmount();
    renderTable([], { loading: true });
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("No operators found.")).not.toBeInTheDocument();
  });

  test("operator menus retain sessions and ban/unban without deletion or role conversion", () => {
    renderTable();
    const row = screen.getAllByRole("row")[3];
    openMenu(within(row).getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("menuitem", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Ban operator" })).toBeInTheDocument();
    for (const label of [/Delete/, /Make admin/, /Remove admin/]) expect(screen.queryByRole("menuitem", { name: label })).not.toBeInTheDocument();
  });
});
