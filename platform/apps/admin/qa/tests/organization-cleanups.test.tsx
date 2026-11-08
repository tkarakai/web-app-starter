import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/** The Organizations page's data-cleanup panel: failed cleanups can be retried; nothing shows when all is well. */
const mocks = vi.hoisted(() => ({ cleanups: undefined as unknown, mutation: vi.fn() }));

vi.mock("@repo/backend", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: new Proxy({}, { get: () => new Proxy({}, { get: () => new Proxy({}, { get: (_target, key) => String(key) }) }) }),
}));
vi.mock("convex/react", () => ({
  useQuery: () => mocks.cleanups,
  useMutation: (ref: string) => (args: unknown) => mocks.mutation(ref, args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { OrganizationCleanups } from "../../src/components/organizations/organization-cleanups";

describe("organization cleanups", () => {
  beforeEach(() => { mocks.mutation.mockReset(); vi.mocked(toast.success).mockReset(); });

  test("shows nothing when no cleanup needs attention", () => {
    mocks.cleanups = [];
    const { container } = render(<OrganizationCleanups />);
    expect(container).toBeEmptyDOMElement();
  });

  test("a failed cleanup can be retried; a running one can't", async () => {
    mocks.cleanups = [
      { organizationId: "org-failed", state: "failed", attempts: 5, batches: 3, lastError: "boom", startedAt: 1, updatedAt: 2, stale: false },
      { organizationId: "org-running", state: "running", attempts: 1, batches: 1, lastError: null, startedAt: 1, updatedAt: 2, stale: false },
    ];
    mocks.mutation.mockResolvedValue(null);
    render(<OrganizationCleanups />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    const retry = screen.getAllByRole("button", { name: "Retry" });
    expect(retry).toHaveLength(1);
    fireEvent.click(retry[0]!);
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith("retryCleanup", { organizationId: "org-failed" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cleanup restarted"));
  });

  test("a stalled cleanup (its run stopped without reporting) can be retried", async () => {
    mocks.cleanups = [
      { organizationId: "org-stalled", state: "running", attempts: 0, batches: 2, lastError: null, startedAt: 1, updatedAt: 2, stale: true },
    ];
    mocks.mutation.mockResolvedValue(null);
    render(<OrganizationCleanups />);
    expect(screen.getByText("Stalled")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith("retryCleanup", { organizationId: "org-stalled" }));
  });
});
