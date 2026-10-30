import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  actor: "operator-a" as string | null,
  pages: {} as Record<string, unknown>, detail: undefined as unknown, queryFailure: null as Error | null,
  calls: [] as Array<{ reference: string; args: unknown }>, mutate: vi.fn(), signOut: vi.fn(),
}));
vi.mock("@repo/backend", () => ({ api: { platform: { organizations: { list: "organizations:list", get: "organizations:get", setLifecycle: "organizations:setLifecycle" } } } }));
vi.mock("convex/react", () => ({
  useQuery: (reference: string, args: { paginationOpts?: { cursor: string | null }; organizationId?: string }) => {
    mocks.calls.push({ reference, args });
    if (mocks.queryFailure) throw mocks.queryFailure;
    return reference === "organizations:list" ? mocks.pages[args.paginationOpts?.cursor ?? "first"] : mocks.detail;
  },
  useMutation: () => mocks.mutate,
}));
vi.mock("@/components/auth/auth-guard", () => ({ useAuthUser: () => mocks.actor ? { id: mocks.actor } : null }));
vi.mock("@web-app-starter/auth-ui", () => ({ useSignOut: () => mocks.signOut }));

import { OrganizationsDirectory } from "../../src/components/organizations/organizations-directory";
import { OrganizationDetails } from "../../src/components/organizations/organization-detail";

const secrets = ["ordinary-member-secret@example.test", "private-credential-hash", "recovery-code-secret", "private-project-secret", "private-file-token"];
const extraSecrets = { members: [{ email: secrets[0] }], password: secrets[1], backupCodes: secrets[2], projects: [{ name: secrets[3] }], token: secrets[4], memberCount: 98765 };
const summary = (organizationId = "org-a", name = "Northwind") => ({ organizationId, name, lifecycle: "active", experience: "collaborative", createdAt: 1_700_000_000_000, ...extraSecrets });
const detail = (organizationId = "org-a", name = "Northwind") => ({ ...summary(organizationId, name), contacts: [{ name: "Current Contact", email: "current-contact@example.test", ...extraSecrets }] });
function assertPrivateDom() {
  for (const secret of secrets) expect(document.body.innerHTML).not.toContain(secret);
  expect(document.body.innerHTML).not.toContain("98765");
  for (const label of ["Members", "Users", "Credentials", "Sessions", "Projects", "Files"]) expect(screen.queryByRole("button", { name: label, exact: true })).not.toBeInTheDocument();
}
async function openAvailability() {
  fireEvent.click(screen.getByRole("button", { name: "Disable organization" }));
  return await screen.findByRole("alertdialog");
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor = "operator-a"; mocks.queryFailure = null; mocks.calls = [];
  mocks.pages = { first: { page: [summary()], isDone: true, continueCursor: "" } };
  mocks.detail = detail(); mocks.mutate.mockResolvedValue(undefined);
});

describe("app-operator organization directory", () => {
  test("renders only organization metadata, never customer directory or extra response fields", () => {
    render(<OrganizationsDirectory />);
    expect(screen.getByRole("heading", { name: "Organizations" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Northwind" })).toHaveAttribute("href", "/manage/organizations/org-a");
    expect(screen.getByRole("columnheader", { name: "Availability" })).toBeInTheDocument();
    expect(screen.queryByText("current-contact@example.test")).not.toBeInTheDocument();
    assertPrivateDom();
  });
  test("captures opaque page cursors and resets cached pages when the operator identity changes", () => {
    mocks.pages.first = { page: [summary()], isDone: false, continueCursor: "cursor-for-a" };
    mocks.pages["cursor-for-a"] = { page: [summary("org-b", "Southwind")], isDone: true, continueCursor: "" };
    const view = render(<OrganizationsDirectory />);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("link", { name: "Southwind" })).toHaveAttribute("href", "/manage/organizations/org-b");
    expect(screen.queryByRole("link", { name: "Northwind" })).not.toBeInTheDocument();
    expect(mocks.calls.at(-1)).toEqual({ reference: "organizations:list", args: { paginationOpts: { cursor: "cursor-for-a", numItems: 20 } } });
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByRole("link", { name: "Northwind" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    mocks.actor = "operator-b"; view.rerender(<OrganizationsDirectory />);
    expect(mocks.calls.at(-1)).toEqual({ reference: "organizations:list", args: { paginationOpts: { cursor: null, numItems: 20 } } });
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });
  test("handles loading, empty and null authority without showing stale rows", () => {
    mocks.pages.first = undefined;
    const view = render(<OrganizationsDirectory />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading organizations");
    mocks.pages.first = { page: [], isDone: true, continueCursor: "" }; view.rerender(<OrganizationsDirectory />);
    expect(screen.getByText("No organizations yet.")).toBeInTheDocument();
    mocks.pages.first = null; view.rerender(<OrganizationsDirectory />);
    expect(screen.getByRole("alert")).toHaveTextContent("Organization access is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" })); expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  test("refuses a repeated cursor rather than repeatedly appending the same page", () => {
    mocks.pages.first = { page: [summary()], isDone: false, continueCursor: "cursor-a" };
    mocks.pages["cursor-a"] = { page: [summary("org-b", "Southwind")], isDone: false, continueCursor: "cursor-a" };
    render(<OrganizationsDirectory />);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(mocks.calls.at(-1)).toEqual({ reference: "organizations:list", args: { paginationOpts: { cursor: "cursor-a", numItems: 20 } } });
  });
  test("query permission loss clears rows and never renders a raw backend error", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = render(<OrganizationsDirectory />);
    mocks.queryFailure = new Error(`NOT_ADMIN:${secrets[1]}`); view.rerender(<OrganizationsDirectory />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument(); expect(screen.getByRole("alert")).toBeInTheDocument();
    assertPrivateDom(); consoleError.mockRestore();
  });
});

describe("organization current contact and availability", () => {
  test("detail and real alert-dialog portal render only approved fields", async () => {
    render(<OrganizationDetails organizationId="org-a" />);
    expect(screen.getByRole("heading", { name: "Northwind" })).toBeInTheDocument();
    expect(screen.getByText("Current Contact")).toBeInTheDocument(); expect(screen.getByText("current-contact@example.test")).toBeInTheDocument();
    assertPrivateDom();
    const dialog = await openAvailability();
    expect(within(dialog).getByRole("heading", { name: "Disable this organization?" })).toBeInTheDocument();
    expect(within(dialog).getByText(/Their accounts and access to other organizations remain available/)).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-describedby"); assertPrivateDom();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  test("confirmation submits only the captured immutable organization and chosen availability", async () => {
    render(<OrganizationDetails organizationId="org-a" />); const dialog = await openAvailability();
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable organization" }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({ organizationId: "org-a", lifecycle: "disabled" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Organization availability updated.");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
  test("a changed route unmounts captured confirmation and refuses a mismatched query DTO", async () => {
    const view = render(<OrganizationDetails organizationId="org-a" />); await openAvailability();
    view.rerender(<OrganizationDetails organizationId="org-b" />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Current Contact")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("This organization is unavailable");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  test("concurrent availability changes disable the stale confirmation", async () => {
    const view = render(<OrganizationDetails organizationId="org-a" />); await openAvailability();
    mocks.detail = { ...detail(), lifecycle: "disabled" }; view.rerender(<OrganizationDetails organizationId="org-a" />);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Organization availability changed");
    expect(within(dialog).getByRole("button", { name: "Disable organization" })).toBeDisabled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  test("lost authority removes contact data and any open portal immediately", async () => {
    const view = render(<OrganizationDetails organizationId="org-a" />); await openAvailability();
    mocks.detail = null; view.rerender(<OrganizationDetails organizationId="org-a" />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("current-contact@example.test");
    expect(screen.getByRole("alert")).toBeInTheDocument(); assertPrivateDom();
  });
  test("failed recent proof offers fresh sign-in, never displays server payloads or automatically retries", async () => {
    mocks.mutate.mockRejectedValue(new Error(`RECENT_AUTHENTICATION_REQUIRED:${secrets[1]}`));
    render(<OrganizationDetails organizationId="org-a" />); const dialog = await openAvailability();
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable organization" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Confirm your identity with a fresh sign-in");
    expect(within(dialog).getByRole("button", { name: "Disable organization" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign in again" }));
    expect(mocks.signOut).toHaveBeenCalledOnce(); expect(mocks.mutate).toHaveBeenCalledOnce(); assertPrivateDom();
  });
  test("write-time permission loss removes retained details rather than leaving a stale admin control", async () => {
    mocks.mutate.mockRejectedValue(new Error(`NOT_ADMIN:${secrets[0]}`));
    render(<OrganizationDetails organizationId="org-a" />); const dialog = await openAvailability();
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable organization" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Current Contact")).not.toBeInTheDocument(); expect(screen.getByRole("alert")).toBeInTheDocument(); assertPrivateDom();
  });
  test("disabled organization remains inspectable; only one current contact is accepted", () => {
    mocks.detail = { ...detail(), lifecycle: "disabled", contacts: [] };
    const view = render(<OrganizationDetails organizationId="org-a" />);
    expect(screen.getByText("No current designated contact is available.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivate organization" })).toBeEnabled();
    mocks.detail = { ...detail(), contacts: [{ name: "A", email: secrets[0] }, { name: "B", email: "b@example.test" }] };
    view.rerender(<OrganizationDetails organizationId="org-a" />);
    expect(screen.getByText("No current designated contact is available.")).toBeInTheDocument(); assertPrivateDom();
  });
  test("replaces a former designated contact immediately when the live projection changes", () => {
    const view = render(<OrganizationDetails organizationId="org-a" />);
    expect(screen.getByText("current-contact@example.test")).toBeInTheDocument();
    mocks.detail = { ...detail(), contacts: [{ name: "New Contact", email: "new-contact@example.test" }] };
    view.rerender(<OrganizationDetails organizationId="org-a" />);
    expect(screen.getByText("new-contact@example.test")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("current-contact@example.test");
    mocks.detail = { ...detail(), contacts: [] };
    view.rerender(<OrganizationDetails organizationId="org-a" />);
    expect(document.body.innerHTML).not.toContain("new-contact@example.test");
    expect(screen.getByText("No current designated contact is available.")).toBeInTheDocument();
  });
  test("provisioning cannot be changed and sign-out clears contact data", () => {
    mocks.detail = { ...detail(), lifecycle: "provisioning" };
    const view = render(<OrganizationDetails organizationId="org-a" />);
    expect(screen.getByRole("button", { name: "Disable organization" })).toBeDisabled();
    mocks.actor = null; view.rerender(<OrganizationDetails organizationId="org-a" />);
    expect(screen.queryByText("current-contact@example.test")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable organization" })).not.toBeInTheDocument();
  });
});

test("availability dialog initially focuses its safe cancel action and pending writes cannot be duplicated", async () => {
  let resolveMutation: () => void = () => {};
  mocks.mutate.mockImplementation(() => new Promise<void>(resolve => { resolveMutation = resolve; }));
  render(<OrganizationDetails organizationId="org-a" />); const dialog = await openAvailability();
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  await waitFor(() => expect(cancel).toHaveFocus());
  fireEvent.click(within(dialog).getByRole("button", { name: "Disable organization" }));
  const pending = within(dialog).getByRole("button", { name: "Updating availability…" });
  expect(pending).toBeDisabled(); expect(cancel).toBeDisabled();
  fireEvent.click(pending); expect(mocks.mutate).toHaveBeenCalledOnce();
  resolveMutation(); await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
});

test("generic mutation failures retain an explicit retry without exposing server-provided details", async () => {
  mocks.mutate.mockRejectedValue(new Error(secrets[4]));
  render(<OrganizationDetails organizationId="org-a" />); const dialog = await openAvailability();
  fireEvent.click(within(dialog).getByRole("button", { name: "Disable organization" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Availability could not be updated");
  expect(within(dialog).getByRole("button", { name: "Disable organization" })).toBeEnabled();
  assertPrivateDom(); expect(mocks.mutate).toHaveBeenCalledOnce();
});
