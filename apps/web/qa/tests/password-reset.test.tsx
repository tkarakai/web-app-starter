import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@web-app-starter/i18n/messages/en.json";
import hu from "@web-app-starter/i18n/messages/hu.json";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm, ResetPasswordForm } from "@web-app-starter/auth-ui";

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  notifyResolved: vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@web-app-starter/auth/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@web-app-starter/auth/client")>(),
  authClient: mocks,
}));
vi.mock("convex/react", () => ({ useQuery: mocks.useQuery }));
vi.mock("@web-app-starter/design-system/password-strength", async (importOriginal) => ({
  ...await importOriginal<typeof import("@web-app-starter/design-system/password-strength")>(),
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

  it("rejects mismatched passwords after strength evaluation succeeds", async () => {
    render(<NextIntlClientProvider locale="en" messages={en}>
      <ResetPasswordForm token="reset-token" />
    </NextIntlClientProvider>);
    fireEvent.change(screen.getByLabelText(en.auth.resetPassword.newPassword), {
      target: { value: "Xq7!vTn3Mk9wRp2Z" },
    });
    fireEvent.change(screen.getByLabelText(en.auth.fields.confirmPassword), {
      target: { value: "Bd4#hLm8Yt6kQs1W" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.auth.resetPassword.cta }));

    expect(await screen.findByText(en.auth.errors.passwordMismatch)).toBeInTheDocument();
    expect(mocks.resetPassword).not.toHaveBeenCalled();
  });

  it("shows rate-limit feedback when reset returns HTTP 429", async () => {
    mocks.resetPassword.mockResolvedValue({ error: { status: 429, message: "Rate limit exceeded" } });
    render(<NextIntlClientProvider locale="en" messages={en}>
      <ResetPasswordForm token="reset-token" />
    </NextIntlClientProvider>);
    const password = "Xq7!vTn3Mk9wRp2Z";
    fireEvent.change(screen.getByLabelText(en.auth.resetPassword.newPassword), { target: { value: password } });
    fireEvent.change(screen.getByLabelText(en.auth.fields.confirmPassword), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: en.auth.resetPassword.cta }));

    expect(await screen.findByText(en.auth.errors.rateLimited)).toBeInTheDocument();
    expect(mocks.resetPassword).toHaveBeenCalledWith({ token: "reset-token", newPassword: password });
    expect(screen.getByRole("button", { name: en.auth.resetPassword.cta })).toBeEnabled();
  });

  it.each(["pending", "successful"])("preserves reset state when token invalidates while %s", async (state) => {
    let resolveReset!: (result: object) => void;
    mocks.resetPassword.mockReturnValue(new Promise((resolve) => { resolveReset = resolve; }));
    const form = <NextIntlClientProvider locale="en" messages={en}><ResetPasswordForm token="reset-token" /></NextIntlClientProvider>;
    const { rerender } = render(form);
    const password = "a test passphrase that the mocked client accepts";
    fireEvent.change(screen.getByLabelText(en.auth.resetPassword.newPassword), { target: { value: password } });
    fireEvent.change(screen.getByLabelText(en.auth.fields.confirmPassword), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: en.auth.resetPassword.cta }));
    expect(mocks.resetPassword).toHaveBeenCalledWith({ token: "reset-token", newPassword: password });

    if (state === "successful") {
      await act(async () => { resolveReset({}); });
      expect(screen.getByText(en.auth.resetPassword.successTitle)).toBeInTheDocument();
    }

    mocks.useQuery.mockReturnValue(null);
    rerender(<NextIntlClientProvider locale="en" messages={en}><ResetPasswordForm token="reset-token" /></NextIntlClientProvider>);
    expect(screen.queryByText(en.auth.resetPassword.invalidTitle)).not.toBeInTheDocument();

    if (state === "pending") {
      expect(screen.getByRole("button", { name: en.auth.working })).toBeDisabled();
      expect(screen.getByLabelText(en.auth.resetPassword.newPassword)).toHaveValue(password);
      await act(async () => { resolveReset({}); });
    }

    expect(screen.getByText(en.auth.resetPassword.successTitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.auth.resetPassword.signInNow })).toBeEnabled();
    expect(screen.queryByText(en.auth.resetPassword.invalidTitle)).not.toBeInTheDocument();
    expect(mocks.resetPassword).toHaveBeenCalledTimes(1);
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
