import { act, fireEvent, isInaccessible, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import english from "@web-app-starter/i18n/messages/en.json";
import { AuthGuard } from "../../src/components/auth-guard";
import { AuthGuard as AdminAuthGuard } from "../../../../apps/admin/src/components/auth/auth-guard";
import { SecuritySection } from "../../src/settings/security-section";

const mocks = vi.hoisted(() => ({ status: undefined as Record<string, unknown> | undefined, enable: vi.fn(), totp: vi.fn(), verify: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery: () => mocks.status, useAction: () => vi.fn() }));
vi.mock("@convex-dev/better-auth/nextjs/client", () => ({ usePreloadedAuthQuery: () => ({ name: "Test", email: "test@example.test" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams("tab=2fa") }));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: {
  useSession: () => ({ data: { user: {} } }), getSession: async () => ({ data: { user: { twoFactorEnabled: false } } }),
  $fetch: mocks.verify, twoFactor: { enable: mocks.enable, verifyTotp: mocks.totp }, signOut: vi.fn(),
} }));
vi.mock("../../src/components/localized-controls", () => ({
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  OtpInput: ({ value, onChange, "aria-label": label }: { value: string; onChange: (value: string) => void; "aria-label": string }) => <input aria-label={label} value={value} onChange={event => onChange(event.target.value)} />,
  CopyableField: ({ value }: { value: string }) => <textarea aria-label="Issued backup codes" readOnly value={value} />,
  StyledQrCode: () => <div />,
}));
function ready() { return { allowed: true, reason: "ready", hasTotp: false, hasPasskey: false, strongForChanges: false, recent: true, recentUntil: Date.now() + 300000, primaryRecentUntil: Date.now() + 300000, expiresAt: Date.now() + 3600000, passkeyPolicy: "optional" }; }
beforeEach(() => {
  vi.useFakeTimers(); mocks.status = ready();
  mocks.enable.mockResolvedValue({ data: { totpURI: "otpauth://totp/Test?secret=AAAA", backupCodes: ["same-first-code", "same-second-code"] } });
  mocks.totp.mockResolvedValue({ data: {} }); mocks.verify.mockResolvedValue({ data: { status: true } });
});
afterEach(() => vi.useRealTimers());
it.each([false, true])("continues with the same backup codes through nested timeout and rotation (admin=%s)", async admin => {
  const Guard = admin ? AdminAuthGuard : AuthGuard;
  const view = () => <NextIntlClientProvider locale="en" messages={english}><Guard preloadedUser={{} as never}><SecuritySection /></Guard></NextIntlClientProvider>;
  const result = render(view());
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: english.accountSecurity.twoFactor.enable }));
  fireEvent.change(screen.getByLabelText(english.accountSecurity.changePassword.currentPassword), { target: { value: "secret" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: english.accountSecurity.twoFactor.enable })));
  fireEvent.change(screen.getByLabelText(english.accountSecurity.twoFactor.enterCode), { target: { value: "123456" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: english.accountSecurity.twoFactor.verify })));
  const codes = screen.getByLabelText("Issued backup codes");
  expect(codes).toHaveValue("same-first-code\nsame-second-code");
  await act(async () => vi.advanceTimersByTime(300001));
  expect(codes).not.toBeVisible();
  const password = screen.getAllByLabelText(english.accountSecurity.changePassword.currentPassword).find(field => !isInaccessible(field))!;
  fireEvent.change(password, { target: { value: "secret" } });
  await act(async () => fireEvent.submit(password.closest("form")!));
  mocks.status = undefined; result.rerender(view());
  await act(async () => vi.advanceTimersByTime(4000));
  expect(codes).not.toBeVisible();
  mocks.status = ready(); result.rerender(view());
  expect(screen.getByLabelText("Issued backup codes")).toBe(codes);
  expect(codes).toBeVisible(); expect(codes).toHaveValue("same-first-code\nsame-second-code");
  fireEvent.click(screen.getByRole("button", { name: english.common.save }));
  expect(screen.queryByLabelText("Issued backup codes")).not.toBeInTheDocument();
});
