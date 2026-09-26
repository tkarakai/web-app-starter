import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@repo/i18n/messages/en.json";
import hu from "@repo/i18n/messages/hu.json";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  notifyResolved: vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@repo/auth/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@repo/auth/client")>(),
  authClient: mocks,
}));
vi.mock("convex/react", () => ({ useQuery: mocks.useQuery }));
vi.mock("@repo/design-system/password-strength", async (importOriginal) => ({
  ...await importOriginal<typeof import("@repo/design-system/password-strength")>(),
  PasswordStrengthMeter: () => null,
  useThrottledPasswordCheck: (password: string) => [password, mocks.notifyResolved],
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useQuery.mockReturnValue({ valid: true });
  mocks.requestPasswordReset.mockResolvedValue({});
  window.sessionStorage.clear();
});

describe("web password reset", () => {
  it.each(["en", "hu"])("preserves the requesting origin and %s locale", async (locale) => {
    render(<NextIntlClientProvider locale={locale} messages={en}>
      <ForgotPasswordForm />
    </NextIntlClientProvider>);
    fireEvent.change(screen.getByLabelText(en.auth.fields.email), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: en.auth.forgotPassword.cta }));
    await screen.findByText(en.auth.forgotPassword.emailSent);
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith({
      email: "user@example.com",
      redirectTo: `${window.location.origin}/${locale}/reset-password`,
    });
  });

  it("shows an invalid link when token-based evaluation rejects it", async () => {
    mocks.useQuery.mockReturnValue(null);
    render(<NextIntlClientProvider locale="en" messages={en}><ResetPasswordForm token="expired" /></NextIntlClientProvider>);
    fireEvent.change(screen.getByLabelText(en.auth.resetPassword.newPassword), { target: { value: "test password" } });
    await screen.findByText(en.auth.resetPassword.invalidTitle);
    expect(mocks.resetPassword).not.toHaveBeenCalled();
  });

  it("localizes server password-policy failures instead of showing a generic error", async () => {
    mocks.resetPassword.mockResolvedValue({ error: {
      status: 400, code: "PASSWORD_TOO_WEAK", message: "Password must be at least 40 characters",
    } });
    render(<NextIntlClientProvider locale="hu" messages={hu}>
      <ResetPasswordForm token="reset-token" />
    </NextIntlClientProvider>);
    const password = "a test passphrase that the mocked client accepts";
    fireEvent.change(screen.getByLabelText(hu.auth.resetPassword.newPassword), { target: { value: password } });
    fireEvent.change(screen.getByLabelText(hu.auth.fields.confirmPassword), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: hu.auth.resetPassword.cta }));
    await screen.findByText(hu.passwordStrength.strengthRequirement);
  });
});
