import { useState } from "react";
import { createPortal } from "react-dom";
import { fireEvent, render, screen } from "@testing-library/react";
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

describe("session identity transition boundaries", () => {
  it("hides cached client data during pending refresh without discarding same-actor draft", () => {
    const { result, draft, portal } = start();
    mocks.session = { data: { user: { id: "alice" } }, isPending: true };
    result.rerender(view());
    expect(draft).not.toBeVisible(); expect(portal).not.toBeVisible();
    actor("alice"); result.rerender(view());
    expect(screen.getByLabelText("Ceremony draft")).toBe(draft);
    expect(draft).toHaveValue("synthetic-backup-material");
  });
  it("hides a backend-only loss despite settled cached client and assurance", () => {
    const { result, draft, portal } = start();
    mocks.user = null; result.rerender(view());
    expect(draft).not.toBeVisible(); expect(portal).not.toBeVisible();
    actor("alice"); result.rerender(view());
    expect(screen.getByLabelText("Ceremony draft")).toBe(draft);
  });
  it("cannot revive an old draft after conflicting observations followed by unknown pending state", () => {
    const { result } = start();
    mocks.user = { _id: "bob", email: "bob@example.test" }; result.rerender(view());
    mocks.session = { data: null, isPending: true }; mocks.user = undefined;
    result.rerender(view());
    expect(screen.queryByDisplayValue("synthetic-backup-material")).not.toBeInTheDocument();
    actor("alice"); result.rerender(view());
    expect(screen.getByLabelText("Ceremony draft")).toHaveValue("");
  });
  it("same-actor recovery cannot restore a draft after explicit settled identity loss without an assurance update", () => {
    const { result } = start();
    mocks.session = { data: null, isPending: false }; mocks.user = null;
    result.rerender(view());
    expect(screen.queryByDisplayValue("synthetic-backup-material")).not.toBeInTheDocument();
    actor("alice"); result.rerender(view());
    expect(screen.getByLabelText("Ceremony draft")).toHaveValue("");
  });
});
