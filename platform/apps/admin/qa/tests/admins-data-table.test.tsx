import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/** User-visible behaviour of the admin-invitations table: sorting and "Load more". */
const mocks = vi.hoisted(() => ({
  page: { results: [] as unknown[], status: "Exhausted" as string, loadMore: vi.fn() },
}));

vi.mock("@repo/backend", () => ({
  api: new Proxy({}, { get: () => new Proxy({}, { get: () => new Proxy({}, { get: (_target, key) => String(key) }) }) }),
}));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn(), useQuery: () => undefined }));
vi.mock("convex-helpers/react", () => ({ usePaginatedQuery: () => mocks.page }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AdminsDataTable } from "../../src/components/onboarding/admins-data-table";

const invitation = (email: string, status: string, createdAt: number) => ({
  _id: `id-${email}`, _creationTime: createdAt, email, status, createdAt, invitationExpired: false,
});
const CAROL = invitation("carol@example.test", "invited", 3000);
const ALICE = invitation("alice@example.test", "claimed", 1000);
const BOB = invitation("bob@example.test", "invited", 2000);

const emails = (): string[] =>
  screen.getAllByRole("row").slice(1).map((row) => /[a-z]+@example\.test/.exec(row.textContent ?? "")?.[0] ?? "");

function renderTable(results: unknown[] = [CAROL, ALICE, BOB], status = "Exhausted") {
  mocks.page.results = results;
  mocks.page.status = status;
  return render(<AdminsDataTable />);
}

describe("app-operator invitations table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("lists the invitations in the order they arrive", () => {
    renderTable();
    expect(emails()).toEqual(["carol@example.test", "alice@example.test", "bob@example.test"]);
  });

  test("sorts by email, ascending then descending", () => {
    renderTable();
    const email = screen.getByRole("button", { name: /^Email/ });
    fireEvent.click(email);
    expect(emails()).toEqual(["alice@example.test", "bob@example.test", "carol@example.test"]);
    fireEvent.click(email);
    expect(emails()).toEqual(["carol@example.test", "bob@example.test", "alice@example.test"]);
  });

  test("sorts by status, keeping arrival order within a status", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));
    expect(emails()).toEqual(["alice@example.test", "carol@example.test", "bob@example.test"]);
  });

  test("loads more invitations on request", () => {
    renderTable([CAROL], "CanLoadMore");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(mocks.page.loadMore).toHaveBeenCalledTimes(1);
  });

  test("shows an empty state", () => {
    renderTable([]);
    expect(screen.getByText("No app-operator invitations found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});
