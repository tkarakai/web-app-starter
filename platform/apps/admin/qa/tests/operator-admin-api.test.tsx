import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { banUser, fetchUsers, listUserSessions, revokeAllSessions, revokeSession, unbanUser, type AdminUser, type OperatorClient } from "../../src/lib/admin-api";
import { useUsers } from "../../src/hooks/use-users";
import { UserSessionsDialog } from "../../src/components/users/user-sessions-dialog";

const mocks = vi.hoisted(() => ({ client: { query: vi.fn(), mutation: vi.fn() } }));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const client = mocks.client as unknown as OperatorClient;

const row = (id: string, createdAt = 1) => ({
  id, name: id, email: `${id}@example.test`, role: "admin", banned: false, emailVerified: true,
  twoFactorEnabled: false, createdAt, updatedAt: createdAt,
});
const operator = (id: string): AdminUser => ({ ...row(id), role: "admin", createdAt: new Date(1), updatedAt: new Date(1), image: null, banReason: null, banExpires: null });
const page = (ids: string[], isDone = true, continueCursor = "") => ({ page: ids.map((id, i) => row(id, 20 - i)), isDone, continueCursor });
const sessionRow = (userId: string, id: string, ipAddress = "192.0.2.23") => ({
  id, userId, ipAddress, userAgent: "Fixture browser", createdAt: 1, expiresAt: Date.now() + 60_000,
  token: "never-return-this-login-token", updatedAt: 999,
});
beforeEach(() => { mocks.client.query.mockReset(); mocks.client.mutation.mockReset().mockResolvedValue(undefined); });

describe("authenticated Convex operator adapters", () => {
  test("directory forwards safe cursor/search/status options and returns allowlisted operator DTOs", async () => {
    mocks.client.query.mockResolvedValue({ ...page(["operator"]), page: [{ ...row("operator"), credentials: "secret", metadata: "private" }] });
    const result = await fetchUsers(client, { cursor: "operator-cursor", limit: 20, searchValue: "Op", searchField: "email", status: "banned", sortDirection: "asc" });
    const [ref, args] = mocks.client.query.mock.calls[0];
    expect(getFunctionName(ref)).toBe("platform/agentUsers:list");
    expect(args).toEqual({ paginationOpts: { numItems: 20, cursor: "operator-cursor" }, role: "admin", sortBy: "createdAt", sortDirection: "asc", search: "Op", searchField: "email", status: "banned" });
    expect(result.users).toEqual([operator("operator")]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("private");
  });

  test("an unauthenticated response or a customer row is denied rather than rendered as an operator", async () => {
    mocks.client.query.mockResolvedValueOnce(null);
    await expect(fetchUsers(client, {})).rejects.toThrow("NOT_AUTHENTICATED");
    mocks.client.query.mockResolvedValueOnce({ ...page([]), page: [{ ...row("customer"), role: "user" }] });
    await expect(fetchUsers(client, {})).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
  });

  test("ban/unban and session mutations use native operator fields and opaque IDs", async () => {
    await banUser(client, "operator", "Containment", 3600);
    await unbanUser(client, "operator");
    await revokeSession(client, "operator", "opaque-session-id");
    await revokeAllSessions(client, "operator");
    expect(mocks.client.mutation.mock.calls.map(([ref, args]) => [getFunctionName(ref), args])).toEqual([
      ["platform/agentUsers:ban", { userId: "operator", reason: "Containment", expiresInSeconds: 3600 }],
      ["platform/agentUsers:unban", { userId: "operator" }],
      ["platform/agentUsers:revokeSession", { userId: "operator", sessionId: "opaque-session-id" }],
      ["platform/agentUsers:revokeSessions", { userId: "operator" }],
    ]);
  });

  test("session listing completes every cursor page, binds the target and strips tokens/unsupported fields", async () => {
    mocks.client.query.mockResolvedValueOnce({ page: [sessionRow("operator", "session-one")], isDone: false, continueCursor: "next-session-page" })
      .mockResolvedValueOnce({ page: [sessionRow("operator", "session-two")], isDone: true, continueCursor: "" });
    const result = await listUserSessions(client, "operator");
    expect(result.map(session => session.id)).toEqual(["session-one", "session-two"]);
    expect(mocks.client.query.mock.calls.map(([ref, args]) => [getFunctionName(ref), args])).toEqual([
      ["platform/agentUsers:sessions", { userId: "operator", paginationOpts: { numItems: 100, cursor: null } }],
      ["platform/agentUsers:sessions", { userId: "operator", paginationOpts: { numItems: 100, cursor: "next-session-page" } }],
    ]);
    expect(JSON.stringify(result)).not.toContain("token");
    expect(result[0]).not.toHaveProperty("updatedAt");
    mocks.client.query.mockResolvedValueOnce({ page: [sessionRow("customer", "wrong-target")], isDone: true, continueCursor: "" });
    await expect(listUserSessions(client, "operator")).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
  });
});

describe("operator cursor paging and request isolation", () => {
  test("name/email searches keep independent cursors, dedupe across pages and finish both streams", async () => {
    mocks.client.query.mockImplementation(async (_ref, args) => {
      if (args.searchField === "name") return args.paginationOpts.cursor === null ? page(["one", "shared"], false, "name-one") : page(["shared", "two"]);
      if (args.paginationOpts.cursor === null) return page(["shared", "three"], false, "email-one");
      if (args.paginationOpts.cursor === "email-one") return page(["two", "four"], false, "email-two");
      return page(["shared", "five"]);
    });
    const hook = renderHook(() => useUsers({ searchValue: "op", status: "active" }));
    await waitFor(() => expect(hook.result.current.users).toHaveLength(3));
    expect(hook.result.current.hasMore).toBe(true);
    act(() => hook.result.current.loadMore());
    await waitFor(() => expect(hook.result.current.users).toHaveLength(5));
    act(() => hook.result.current.loadMore());
    await waitFor(() => expect(hook.result.current.users).toHaveLength(6));
    expect(hook.result.current.hasMore).toBe(false);
    expect(new Set(hook.result.current.users.map(user => user.id)).size).toBe(6);
    expect(mocks.client.query.mock.calls.map(([, args]) => [args.searchField, args.paginationOpts.cursor])).toEqual([
      ["name", null], ["email", null], ["name", "name-one"], ["email", "email-one"], ["email", "email-two"],
    ]);
    expect(mocks.client.query.mock.calls.every(([, args]) => args.role === "admin" && args.status === "active")).toBe(true);
  });

  test("a filter change discards late pages and resets cursor/loaded rows", async () => {
    const oldRequests: Array<(value: ReturnType<typeof page>) => void> = [];
    mocks.client.query.mockImplementation(async (_ref, args) => args.search === "old"
      ? new Promise(resolve => oldRequests.push(resolve)) : page(["new-operator"]));
    const hook = renderHook(({ search }) => useUsers({ searchValue: search }), { initialProps: { search: "old" } });
    await waitFor(() => expect(oldRequests).toHaveLength(2));
    hook.rerender({ search: "new" });
    await waitFor(() => expect(hook.result.current.users.map(user => user.id)).toEqual(["new-operator"]));
    await act(async () => oldRequests.forEach(resolve => resolve(page(["stale-operator"]))));
    expect(hook.result.current.users.map(user => user.id)).toEqual(["new-operator"]);
    expect(hook.result.current.loading).toBe(false);
  });

  test("duplicate Load more requests do not skip pages and retry resets a failed initial request", async () => {
    mocks.client.query.mockRejectedValueOnce(new Error("NOT_AUTHENTICATED"));
    const hook = renderHook(() => useUsers({}));
    await waitFor(() => expect(hook.result.current.error).not.toBeNull());
    expect(hook.result.current.users).toEqual([]);
    mocks.client.query.mockResolvedValueOnce(page(["one"], false, "next"));
    act(() => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.users).toHaveLength(1));
    let complete!: (value: ReturnType<typeof page>) => void;
    mocks.client.query.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    act(() => { hook.result.current.loadMore(); hook.result.current.loadMore(); });
    expect(hook.result.current.loadingMore).toBe(true);
    expect(mocks.client.query).toHaveBeenCalledTimes(3);
    await act(async () => complete(page(["two"])));
    expect(hook.result.current.users.map(user => user.id).sort()).toEqual(["one", "two"]);
    expect(hook.result.current.hasMore).toBe(false);
  });
});

describe("real operator session dialog", () => {
  test("revoke submits the operator and opaque session ID, refreshes state, and never renders a token", async () => {
    let sessions = [sessionRow("operator", "opaque-session")];
    mocks.client.query.mockImplementation(async () => ({ page: sessions, isDone: true, continueCursor: "" }));
    mocks.client.mutation.mockImplementation(async () => { sessions = []; });
    render(<UserSessionsDialog open onOpenChange={vi.fn()} user={operator("operator")} />);
    await screen.findByText("192.0.2.23");
    expect(document.body.textContent).not.toContain("never-return-this-login-token");
    expect(screen.queryByRole("columnheader", { name: "Last Active" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Revoke session" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(mocks.client.mutation).toHaveBeenCalledTimes(1));
    const [ref, args] = mocks.client.mutation.mock.calls[0];
    expect(getFunctionName(ref)).toBe("platform/agentUsers:revokeSession");
    expect(args).toEqual({ userId: "operator", sessionId: "opaque-session" });
    await screen.findByText("No active sessions found.");
  });

  test("changing the target while its page is pending cannot render the old operator's sessions", async () => {
    let completeOld!: (value: unknown) => void;
    mocks.client.query.mockImplementation(async (_ref, args) => args.userId === "old-operator"
      ? new Promise(resolve => { completeOld = resolve; })
      : { page: [sessionRow("new-operator", "new-session", "192.0.2.42")], isDone: true, continueCursor: "" });
    const old = operator("old-operator");
    const next = operator("new-operator");
    const view = render(<UserSessionsDialog open onOpenChange={vi.fn()} user={old} />);
    await waitFor(() => expect(completeOld).toBeTypeOf("function"));
    view.rerender(<UserSessionsDialog open onOpenChange={vi.fn()} user={next} />);
    await screen.findByText("192.0.2.42");
    await act(async () => completeOld({ page: [sessionRow("old-operator", "old-session")], isDone: true, continueCursor: "" }));
    expect(screen.queryByText("192.0.2.23")).not.toBeInTheDocument();
    expect(screen.getByText("192.0.2.42")).toBeInTheDocument();
  });
});
