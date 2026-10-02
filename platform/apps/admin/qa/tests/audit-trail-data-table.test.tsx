import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/** User-visible behaviour of the audit-trail table: columns, rows, empty state and "Load more". */
const mocks = vi.hoisted(() => ({
  page: { results: [] as unknown[], status: "Exhausted" as string, loadMore: vi.fn() },
}));

// Keep the real constants (the filter menus list them) and replace only the function references.
vi.mock("@repo/backend", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: new Proxy({}, { get: () => new Proxy({}, { get: () => new Proxy({}, { get: (_target, key) => String(key) }) }) }),
}));
vi.mock("convex-helpers/react", () => ({ usePaginatedQuery: () => mocks.page }));

import { AuditTrailDataTable } from "../../src/components/audit-trail/audit-trail-data-table";

const event = (id: string, action: string, actor: string, status: string, happenedAt: number) => ({
  _id: id, _creationTime: happenedAt, happenedAt, action, actor, source: "web", sourceDetail: undefined, resource: `user:${id}`,
  status, authenticatedUserId: undefined, oldValue: undefined, newValue: undefined,
});

function renderTable(results: unknown[], status = "Exhausted") {
  mocks.page.results = results;
  mocks.page.status = status;
  return render(<AuditTrailDataTable />);
}

describe("audit trail table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("shows a column for each part of an event", () => {
    renderTable([event("a", "user.signed_in", "ada@example.test", "succeeded", Date.now())]);
    for (const header of ["Time", "Action", "Actor", "Source", "Resource", "Status"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
  });

  test("lists the events in the order they arrive", () => {
    renderTable([
      event("a", "user.signed_in", "ada@example.test", "succeeded", 3000),
      event("b", "user.password_changed", "grace@example.test", "failed.wrong_password", 2000),
    ]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("user.signed_in");
    expect(rows[0].textContent).toContain("ada@example.test");
    expect(rows[0].textContent).toContain("succeeded");
    expect(rows[1].textContent).toContain("user.password_changed");
    expect(rows[1].textContent).toContain("failed.wrong_password");
  });

  test("shows an empty state", () => {
    renderTable([]);
    expect(screen.getByText("No audit events found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  test("loads more events on request", () => {
    renderTable([event("a", "user.signed_in", "ada@example.test", "succeeded", 3000)], "CanLoadMore");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(mocks.page.loadMore).toHaveBeenCalledTimes(1);
  });
});
