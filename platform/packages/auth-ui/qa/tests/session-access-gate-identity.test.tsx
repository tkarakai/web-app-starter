import { useState } from "react";
import { createPortal } from "react-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import english from "@web-app-starter/i18n/messages/en.json";
import { SessionAccessGate } from "../../src/components/session-access-gate";

const mocks = vi.hoisted(() => ({
  session: { data: null as { user: { id: string } } | null, isPending: false },
  user: null as { _id: string; email: string } | null | undefined,
  status: null as Record<string, unknown> | null | undefined,
  signOut: vi.fn(),
}));
vi.mock("@repo/backend", () => ({ api: { platform: { sessionAssurance: { status: "status" }, auth: { getCurrentUser: "user" } } } }));
vi.mock("convex/react", () => ({ useQuery: (query: string) => query === "status" ? mocks.status : mocks.user }));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: {
  useSession: () => mocks.session, signOut: mocks.signOut,
} }));
vi.mock("../../src/settings/two-factor-section", () => ({ TwoFactorSection: () => null }));
vi.mock("../../src/settings/passkey-section", () => ({ PasskeySection: () => null }));
vi.mock("../../src/settings/organization-factor-replacement", () => ({ OrganizationFactorReplacement: () => null }));

function ready() {
  return { reason: "ready", allowed: true, scope: "admin", hasTotp: false, hasPasskey: false, strongForChanges: false,
    recent: true, recentUntil: Date.now() + 300000, primaryRecentUntil: Date.now() + 300000,
    expiresAt: Date.now() + 3600000, passkeyPolicy: "optional" };
}
function actor(id: string) {
  mocks.session = { data: { user: { id } }, isPending: false };
  mocks.user = { _id: id, email: `${id}@example.test` };
  mocks.status = ready();
}
function Ceremony() {
  const [codes, setCodes] = useState("");
  return <><input aria-label="Ceremony draft" value={codes} onChange={event => setCodes(event.target.value)} />
    {codes && createPortal(<div role="dialog" aria-label="Backup acknowledgement">{codes}</div>, document.body)}</>;
}
function view() {
  return <NextIntlClientProvider locale="en" messages={english}><SessionAccessGate requireRecent><Ceremony /></SessionAccessGate></NextIntlClientProvider>;
}
function start() {
  const result = render(view());
  const draft = screen.getByLabelText("Ceremony draft");
  fireEvent.change(draft, { target: { value: "synthetic-backup-material" } });
  const portal = screen.getByRole("dialog", { name: "Backup acknowledgement" });
  expect(portal).toBeVisible();
  return { result, draft, portal };
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); actor("alice"); mocks.signOut.mockImplementation(() => new Promise(() => {})); });
afterEach(() => vi.useRealTimers());

describe("identity observations during session rotation", () => {
  it.each([true, false])("retains a hidden ceremony during client null (pending=%s) while backend identity still agrees", pending => {
    const { result, draft, portal } = start();
    mocks.session = { data: null, isPending: pending };
    result.rerender(view());
    expect(draft).not.toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Backup acknowledgement" })).not.toBeInTheDocument();
    expect(portal).toBeInTheDocument();
    expect(portal).not.toBeVisible();
    mocks.status = null; result.rerender(view());
    expect(draft).not.toBeVisible();
    actor("alice"); result.rerender(view());
    expect(screen.getByLabelText("Ceremony draft")).toBe(draft);
    expect(draft).toHaveValue("synthetic-backup-material");
    expect(screen.getByRole("dialog", { name: "Backup acknowledgement" })).toBe(portal);
    expect(screen.getByRole("dialog", { name: "Backup acknowledgement" })).toHaveTextContent("synthetic-backup-material");
  });

  it("keeps pending both-null refresh hidden, but discards a settled both-null signout", () => {
    const { result, draft } = start();
    mocks.session = { data: null, isPending: true }; mocks.user = null; mocks.status = null;
    result.rerender(view()); expect(draft).not.toBeVisible();
    actor("alice"); result.rerender(view()); expect(screen.getByLabelText("Ceremony draft")).toBe(draft);
    mocks.session = { data: null, isPending: false }; mocks.user = null; mocks.status = null;
    result.rerender(view());
    expect(screen.queryByDisplayValue("synthetic-backup-material")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    actor("alice"); result.rerender(view());
    expect(screen.getByLabelText("Ceremony draft")).toHaveValue("");
  });

  it.each(["client", "backend", "both"])("discards the former actor on a %s-first account switch, including ABA", first => {
    const { result } = start();
    if (first !== "backend") mocks.session = { data: { user: { id: "bob" } }, isPending: false };
    if (first !== "client") mocks.user = { _id: "bob", email: "bob@example.test" };
    result.rerender(view());
    expect(screen.queryByDisplayValue("synthetic-backup-material")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    if (first !== "both") expect(screen.queryByLabelText("Ceremony draft")).not.toBeInTheDocument();
    actor("alice"); result.rerender(view());
    expect(screen.getByLabelText("Ceremony draft")).toHaveValue("");
  });

  it("does not turn a retained backend identity or status into initial authorization", () => {
    mocks.session = { data: null, isPending: false };
    const result = render(view());
    expect(screen.queryByLabelText("Ceremony draft")).not.toBeInTheDocument();
    actor("alice"); mocks.user = null; result.rerender(view());
    expect(screen.queryByLabelText("Ceremony draft")).not.toBeInTheDocument();
    mocks.user = { _id: "alice", email: "alice@example.test" }; mocks.status = undefined; result.rerender(view());
    expect(screen.queryByLabelText("Ceremony draft")).not.toBeInTheDocument();
  });

  it("discards the gate password when the backend observes a different actor first", () => {
    mocks.status = { ...ready(), recent: false, reason: "reauthenticate" };
    const result = render(view());
    fireEvent.change(screen.getByLabelText(english.accountSecurity.changePassword.currentPassword), { target: { value: "synthetic-gate-password" } });
    mocks.user = { _id: "bob", email: "bob@example.test" }; result.rerender(view());
    expect(screen.queryByDisplayValue("synthetic-gate-password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(english.accountSecurity.changePassword.currentPassword)).not.toBeInTheDocument();
    mocks.user = { _id: "alice", email: "alice@example.test" }; result.rerender(view());
    expect(screen.getByLabelText(english.accountSecurity.changePassword.currentPassword)).toHaveValue("");
  });

  it("discards retained draft, portal and gate credentials immediately on explicit signout", async () => {
    const { result } = start();
    mocks.status = { ...ready(), recent: false, reason: "reauthenticate" }; result.rerender(view());
    fireEvent.change(screen.getByLabelText(english.accountSecurity.changePassword.currentPassword), { target: { value: "synthetic-gate-password" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: english.common.signOut })); });
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByDisplayValue("synthetic-gate-password")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("synthetic-backup-material")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    mocks.status = ready(); result.rerender(view());
    expect(screen.queryByLabelText("Ceremony draft")).not.toBeInTheDocument();
  });
});
