import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * User-visible behaviour of the waitlist table: client-side sorting, filtering and row selection,
 * and "Load more". It goes through the rendered UI only, so it holds across table-library versions.
 */
const mocks = vi.hoisted(() => ({
  page: { results: [] as unknown[], status: "Exhausted" as string, loadMore: vi.fn() },
}));

vi.mock("@repo/backend", () => ({
  api: new Proxy({}, { get: () => new Proxy({}, { get: () => new Proxy({}, { get: (_target, key) => String(key) }) }) }),
}));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn(), useQuery: () => undefined }));
vi.mock("convex-helpers/react", () => ({ usePaginatedQuery: () => mocks.page }));
vi.mock("../../src/components/waitlist/token-viewer-dialog", () => ({ TokenViewerDialog: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { WaitlistDataTable } from "../../src/components/waitlist/waitlist-data-table";

const entry = (email: string, status: string, createdAt: number) => ({
  _id: `id-${email}`, _creationTime: createdAt, email, meta: "{}", status, createdAt, invitationExpired: false,
});
const CAROL = entry("carol@example.test", "waiting", 3000);
const ALICE = entry("alice@example.test", "invited", 1000);
const BOB = entry("bob@example.test", "waiting", 2000);

/** Emails in the order the table shows them. */
const emails = (): string[] =>
  screen.getAllByRole("row").slice(1).map((row) => /[a-z]+@example\.test/.exec(row.textContent ?? "")?.[0] ?? "");

function renderTable(results: unknown[] = [CAROL, ALICE, BOB], status = "Exhausted") {
  mocks.page.results = results;
  mocks.page.status = status;
  return render(<WaitlistDataTable />);
}

describe("waitlist table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("lists the entries in the order they arrive", () => {
    renderTable();
    expect(emails()).toEqual(["carol@example.test", "alice@example.test", "bob@example.test"]);
    expect(screen.getByText("3 entries")).toBeInTheDocument();
  });

  test("sorts by a column header, ascending then descending", () => {
    renderTable();
    const email = screen.getByRole("button", { name: /^Email/ });
    fireEvent.click(email);
    expect(emails()).toEqual(["alice@example.test", "bob@example.test", "carol@example.test"]);
    fireEvent.click(email);
    expect(emails()).toEqual(["carol@example.test", "bob@example.test", "alice@example.test"]);
  });

  test("sorts by status", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));
    // "invited" sorts before "waiting"; ties keep their arrival order.
    expect(emails()).toEqual(["alice@example.test", "carol@example.test", "bob@example.test"]);
  });

  test("filters by the search box", async () => {
    renderTable();
    fireEvent.change(screen.getByPlaceholderText("Search by name or email..."), { target: { value: "BO" } });
    await waitFor(() => expect(emails()).toEqual(["bob@example.test"]));
    expect(screen.getByText("1 entries")).toBeInTheDocument();
  });

  test("selects every row, and a single row, and counts them", () => {
    renderTable();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    fireEvent.click(within(rows[0]).getByRole("checkbox", { name: "Select row" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("checkbox", { name: "Select row" })).toHaveAttribute("aria-checked", "false");
    expect(within(rows[1]).getByRole("checkbox", { name: "Select row" })).toHaveAttribute("aria-checked", "true");
    // A partly selected header checkbox selects everything; clicking it again clears the selection.
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.queryByText(/ selected$/)).not.toBeInTheDocument();
  });

  test("clears the selection when the filter changes", async () => {
    renderTable();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search by name or email..."), { target: { value: "a" } });
    await waitFor(() => expect(screen.queryByText(/ selected$/)).not.toBeInTheDocument());
  });

  test("selection follows the row when the table is sorted", () => {
    renderTable();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Select row" })[0]); // carol
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Email/ }));
    const selected = screen.getAllByRole("row").slice(1).filter((row) => within(row).getByRole("checkbox", { name: "Select row" }).getAttribute("aria-checked") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("carol@example.test");
  });

  test("loads more entries on request", () => {
    renderTable([CAROL], "CanLoadMore");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(mocks.page.loadMore).toHaveBeenCalledTimes(1);
  });

  test("shows an empty state, and no Load more when everything is loaded", () => {
    renderTable([]);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + empty-state row
  });
});
