import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AdminSignInForm } from "../../src/components/auth/admin-sign-in-form";

const mocks = vi.hoisted(() => ({ push: vi.fn(), email: vi.fn(), passkey: vi.fn(), totp: vi.fn(), backup: vi.fn(), session: vi.fn(), listPasskeys: vi.fn(), broadcast: vi.fn(), policies: {} as Record<string, unknown> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("convex/react", () => ({ useQuery: (_query: unknown, args: { key: string }) => mocks.policies[args.key] }));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: {
  signIn: { email: mocks.email, passkey: mocks.passkey }, twoFactor: { verifyTotp: mocks.totp, verifyBackupCode: mocks.backup },
  getSession: mocks.session, passkey: { listUserPasskeys: mocks.listPasskeys }, signOut: vi.fn(),
}, formatAuthError: () => "Failed", isConvexRateLimited: () => false, AUTH_RATE_LIMIT_MESSAGE: "Rate limited" }));
vi.mock("@web-app-starter/auth-ui", () => ({ broadcastAuth: mocks.broadcast }));
vi.mock("@/lib/agentic/return-path", () => ({ postSignInPath: () => "/settings/agent-access?request=fixture" }));
vi.mock("@web-app-starter/design-system", async importOriginal => ({
  ...await importOriginal<typeof import("@web-app-starter/design-system")>(),
  usePasskeySupport: () => ({ supported: true }),
  SlideTransition: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  vi.clearAllMocks(); window.localStorage.clear(); window.sessionStorage.clear();
  mocks.policies = { adminMfaRequired: false, adminPasskeyPolicy: "optional" };
  mocks.email.mockResolvedValue({ data: {} }); mocks.passkey.mockResolvedValue({});
  mocks.totp.mockResolvedValue({ data: {} }); mocks.backup.mockResolvedValue({ data: {} });
  mocks.session.mockResolvedValue({ data: { user: { role: "admin", twoFactorEnabled: true } } });
  mocks.listPasskeys.mockResolvedValue({ data: [] });
});
async function passwordStep(authorizationOnly: boolean, preferred: "password" | "passkey") {
  window.localStorage.setItem("adminSignInPreferredMethod", JSON.stringify({ "admin@example.test": preferred }));
  render(<AdminSignInForm authorizationOnly={authorizationOnly} />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.test" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue" })));
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "fixture-password" } });
}
async function submitPassword(preferred: "password" | "passkey") {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: preferred === "passkey" ? "Sign in with password" : "Sign in", exact: true })));
}

it.each(["password", "passkey"] as const)("authorization-only %s layout omits recovery navigation and supports password sign-in", async preferred => {
  await passwordStep(true, preferred);
  expect(screen.queryByRole("button", { name: "Forgot password?" })).not.toBeInTheDocument();
  expect(screen.getByText(/For account recovery or security setup, use the normal admin app/)).toBeVisible();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(window.sessionStorage.getItem("forgot-password-email")).toBeNull();
  await submitPassword(preferred);
  expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ email: "admin@example.test", password: "fixture-password" }));
  expect(mocks.push).toHaveBeenCalledWith("/settings/agent-access?request=fixture");
});
it.each(["password", "passkey"] as const)("normal %s layout retains password recovery", async preferred => {
  await passwordStep(false, preferred);
  fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
  expect(mocks.push).toHaveBeenCalledWith("/forgot-password");
  expect(window.sessionStorage.getItem("forgot-password-email")).toBe("admin@example.test");
});
it.each([false, true])("TOTP challenge preserves verification and restricts backup-code controls (authorizationOnly=%s)", async authorizationOnly => {
  mocks.email.mockResolvedValue({ data: { twoFactorRedirect: true } });
  await passwordStep(authorizationOnly, "password");
  await submitPassword("password");
  if (authorizationOnly) expect(screen.queryByRole("button", { name: "Use a backup code instead" })).not.toBeInTheDocument();
  else expect(screen.getByRole("button", { name: "Use a backup code instead" })).toBeVisible();
  await act(async () => fireEvent.paste(screen.getAllByRole("textbox")[0], { clipboardData: { getData: () => "123456" } }));
  expect(mocks.totp).toHaveBeenCalledWith({ code: "123456" });
  expect(mocks.backup).not.toHaveBeenCalled();
  expect(mocks.push).toHaveBeenCalledWith("/settings/agent-access?request=fixture");
});
it("normal sign-in retains executable backup-code verification", async () => {
  mocks.email.mockResolvedValue({ data: { twoFactorRedirect: true } });
  await passwordStep(false, "password"); await submitPassword("password");
  fireEvent.click(screen.getByRole("button", { name: "Use a backup code instead" }));
  fireEvent.change(screen.getByLabelText("Backup code"), { target: { value: "fixture-backup" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Verify" })));
  expect(mocks.backup).toHaveBeenCalledWith({ code: "fixture-backup" });
});
it.each(["adminMfaRequired", "adminPasskeyPolicy"])("authorization-only sign-in directs required %s setup to the admin app without navigation", async key => {
  mocks.policies[key] = key === "adminMfaRequired" ? true : "required";
  mocks.session.mockResolvedValue({ data: { user: { role: "admin", twoFactorEnabled: false } } });
  await passwordStep(true, "password"); await submitPassword("password");
  expect(screen.getByText(/Complete account security setup in the admin app/)).toBeVisible();
  expect(mocks.push).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
});
it("authorization-only sign-in supports passkey verification", async () => {
  await passwordStep(true, "passkey");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign in with passkey" })));
  expect(mocks.passkey).toHaveBeenCalledWith(expect.objectContaining({ email: "admin@example.test" }));
  expect(mocks.push).toHaveBeenCalledWith("/settings/agent-access?request=fixture");
});
