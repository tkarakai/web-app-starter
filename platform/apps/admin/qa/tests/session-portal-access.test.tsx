import * as React from "react";
import { createPortal } from "react-dom";
import { act, fireEvent, isInaccessible, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import english from "@web-app-starter/i18n/messages/en.json";
import { AuthGuard as WebAuthGuard, SessionAccessGate } from "@web-app-starter/auth-ui";
import { AuthGuard as AdminAuthGuard } from "../../src/components/auth/auth-guard";
import { UserSessionsDialog } from "../../src/components/users/user-sessions-dialog";
import { EventDetails } from "../../src/components/audit-trail/event-details";
import type { AppOperatorUser } from "../../src/lib/admin-api";
import type { AuditTrailEvent } from "@repo/backend";

const mocks = vi.hoisted(() => ({ client: {}, status: undefined as Record<string, unknown> | undefined, verify: vi.fn(), sessions: vi.fn(), getSession: vi.fn() }));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client, useQuery: () => mocks.status, useMutation: () => vi.fn(), useAction: () => vi.fn() }));
vi.mock("@convex-dev/better-auth/nextjs/client", () => ({ usePreloadedAuthQuery: () => ({ name: "Operator", email: "operator@example.test" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: { useSession: () => ({ data: { user: {} } }), $fetch: mocks.verify, getSession: mocks.getSession, signOut: vi.fn() } }));
vi.mock("@/lib/admin-api", () => ({ listAppOperatorSessions: mocks.sessions, revokeAppOperatorSession: vi.fn(), revokeAllAppOperatorSessions: vi.fn() }));
const user: AppOperatorUser = { id: "fixture-user", name: "Protected user", email: "protected@example.test", role: "admin", banned: false, banReason: null, banExpires: null, image: null, createdAt: new Date(0), updatedAt: new Date(0), emailVerified: true, twoFactorEnabled: false };
const event = { _id: "fixture-event", _creationTime: 1, happenedAt: 1, source: "server", action: "fixture", resource: "fixture", reason: "Protected audit reason", meta: '{"detail":"Protected audit metadata"}' } as AuditTrailEvent;
function ready() { return { allowed: true, reason: "ready", hasTotp: false, hasPasskey: false, strongForChanges: false, recent: true, recentUntil: Date.now() + 300000, primaryRecentUntil: Date.now() + 300000, expiresAt: Date.now() + 3600000, passkeyPolicy: "optional" }; }
function visiblePassword() { return screen.getAllByLabelText(english.accountSecurity.changePassword.currentPassword).find(field => !isInaccessible(field))!; }
function Workspace() {
  const [open, setOpen] = React.useState(false);
  return <><input aria-label="Protected draft" defaultValue="Original draft" /><button onClick={() => setOpen(true)}>Open sessions</button><UserSessionsDialog open={open} onOpenChange={setOpen} user={user} /><EventDetails event={event} />{createPortal(<p>Protected direct portal</p>, document.body)}</>;
}
beforeEach(() => {
  vi.useFakeTimers(); mocks.status = ready(); mocks.getSession.mockResolvedValue({ data: { user: { twoFactorEnabled: true } } }); mocks.verify.mockReset().mockResolvedValue({ data: { status: true } });
  mocks.sessions.mockResolvedValue([{ id: "fixture-session", userId: user.id, ipAddress: "192.0.2.17", userAgent: "Fixture browser", createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000) }]);
});
afterEach(() => vi.useRealTimers());

it.each(["web", "admin"] as const)("suspends the real open session dialog and its modal locks across nested %s gates", async surface => {
  const Guard = surface === "web" ? WebAuthGuard : AdminAuthGuard;
  const view = () => <NextIntlClientProvider locale="en" messages={english}><Guard preloadedUser={{} as never}><SessionAccessGate requireRecent><Workspace /></SessionAccessGate></Guard>{createPortal(<p>Unrelated public portal</p>, document.body)}</NextIntlClientProvider>;
  const result = render(view());
  const draft = screen.getByLabelText("Protected draft");
  const directPortal = screen.getByText("Protected direct portal");
  expect(directPortal).toBeVisible();
  fireEvent.change(draft, { target: { value: "Keep this draft" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open sessions" })));
  await act(async () => vi.advanceTimersByTimeAsync(20));
  const dialog = screen.getByRole("dialog", { name: "Sessions" });
  expect(screen.getByText("Protected user · protected@example.test")).toBeVisible();
  expect(screen.getByText("192.0.2.17")).toBeVisible();
  expect(document.body.style.pointerEvents).toBe("none");
  expect(document.body.hasAttribute("data-scroll-locked")).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(300001));
  expect(dialog).not.toBeVisible();
  expect(directPortal).not.toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.body.style.pointerEvents).not.toBe("none");
  expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
  expect(screen.getByText("Unrelated public portal")).toBeVisible();
  const password = visiblePassword();
  password.focus(); expect(password).toHaveFocus();
  fireEvent.change(password, { target: { value: "fixture-password" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: english.accountSecurity.session.verify })));
  expect(mocks.verify).toHaveBeenCalledWith("/verify-password", { method: "POST", body: { password: "fixture-password" } });
  mocks.status = ready(); await act(async () => result.rerender(view()));
  expect(screen.getByRole("dialog", { name: "Sessions" })).toBeVisible();
  expect(directPortal).toBeVisible();
  expect(screen.getByLabelText("Protected draft")).toBe(draft); expect(draft).toHaveValue("Keep this draft");
  mocks.status = undefined; await act(async () => result.rerender(view()));
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.body.style.pointerEvents).not.toBe("none");
  expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
  mocks.status = ready(); await act(async () => result.rerender(view()));
  expect(screen.getByRole("dialog", { name: "Sessions" })).toBeVisible();
  expect(draft).toHaveValue("Keep this draft");
});

it("suspends the real audit popover while preserving its open state", async () => {
  const view = () => <NextIntlClientProvider locale="en" messages={english}><AdminAuthGuard preloadedUser={{} as never}><SessionAccessGate requireRecent><EventDetails event={event} /></SessionAccessGate></AdminAuthGuard></NextIntlClientProvider>;
  const result = render(view());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "View details" })));
  const metadata = screen.getByText(/Protected audit metadata/);
  expect(metadata).toBeVisible();
  await act(async () => vi.advanceTimersByTimeAsync(300001));
  expect(metadata).not.toBeVisible();
  const password = visiblePassword();
  password.focus(); expect(password).toHaveFocus();
  mocks.status = ready(); await act(async () => result.rerender(view()));
  expect(screen.getByText(/Protected audit metadata/)).toBeVisible();
});

it("suspends a real modal in the retained setup panel without admitting protected children", async () => {
  mocks.status = { ...ready(), allowed: false, reason: "mfa_enrollment" };
  const mounted = vi.fn();
  function ProtectedConsumer() { mounted(); return <p>Privileged content</p>; }
  const view = () => <NextIntlClientProvider locale="en" messages={english}><SessionAccessGate><ProtectedConsumer /></SessionAccessGate></NextIntlClientProvider>;
  const result = render(view());
  expect(mounted).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: english.accountSecurity.twoFactor.enable })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: english.accountSecurity.twoFactor.disable })));
  await act(async () => vi.advanceTimersByTimeAsync(20));
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toBeVisible();
  expect(document.body.style.pointerEvents).toBe("none");
  await act(async () => vi.advanceTimersByTimeAsync(300001));
  expect(dialog).not.toBeVisible();
  expect(document.body.style.pointerEvents).not.toBe("none");
  expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
  const password = visiblePassword();
  password.focus(); expect(password).toHaveFocus();
  expect(mounted).not.toHaveBeenCalled();
  mocks.status = { ...ready(), allowed: false, reason: "mfa_enrollment" };
  await act(async () => result.rerender(view()));
  expect(screen.getByRole("alertdialog")).toBeVisible();
  expect(mounted).not.toHaveBeenCalled();
});
