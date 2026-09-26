import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminForgotPasswordForm } from "@/components/auth/admin-forgot-password-form";
import { AdminResetPasswordForm } from "@/components/auth/admin-reset-password-form";

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  useQuery: vi.fn(),
  notifyResolved: vi.fn(),
}));
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

describe("admin password reset", () => {
  it("returns the email link to this admin origin", async () => {
    render(<AdminForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await screen.findByText("Check your email");
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith({
      email: "admin@example.com",
      redirectTo: `${window.location.origin}/reset-password`,
    });
  });

  it("shows an invalid link when token-based evaluation rejects it", async () => {
    mocks.useQuery.mockReturnValue(null);
    render(<AdminResetPasswordForm token="expired" />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "test password" } });
    await screen.findByText("Invalid reset link");
    expect(mocks.resetPassword).not.toHaveBeenCalled();
  });

  it.each(["pending", "successful"])("preserves reset state when token invalidates while %s", async (state) => {
    let resolveReset!: (result: object) => void;
    mocks.resetPassword.mockReturnValue(new Promise((resolve) => { resolveReset = resolve; }));
    const { rerender } = render(<AdminResetPasswordForm token="reset-token" />);
    const password = "a sufficiently long test passphrase for the administrator";
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(mocks.resetPassword).toHaveBeenCalledWith({ token: "reset-token", newPassword: password });

    if (state === "successful") {
      await act(async () => { resolveReset({}); });
      expect(screen.getByText("Password reset")).toBeInTheDocument();
    }

    mocks.useQuery.mockReturnValue(null);
    rerender(<AdminResetPasswordForm token="reset-token" />);
    expect(screen.queryByText("Invalid reset link")).not.toBeInTheDocument();

    if (state === "pending") {
      expect(screen.getByRole("button", { name: "Resetting..." })).toBeDisabled();
      expect(screen.getByLabelText("New password")).toHaveValue(password);
      await act(async () => { resolveReset({}); });
    }

    expect(screen.getByText("Password reset")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in now" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByText("Invalid reset link")).not.toBeInTheDocument();
    expect(mocks.resetPassword).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ status: 400, code: "PASSWORD_TOO_WEAK", message: "Password must be at least 40 characters" }, "Password must be at least 40 characters"],
    [{ status: 400, code: "INVALID_TOKEN", message: "Invalid token" }, "This reset link has expired or is invalid. Please request a new one."],
    [{ status: 500, message: "Internal details" }, "Something went wrong. Please try again."],
  ])("shows an actionable reset error: %s", async (error, expected) => {
    mocks.resetPassword.mockResolvedValue({ error });
    render(<AdminResetPasswordForm token="reset-token" />);
    const password = "a sufficiently long test passphrase for the administrator";
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
    expect(mocks.resetPassword).toHaveBeenCalledWith({ token: "reset-token", newPassword: password });
    expect(mocks.useQuery).toHaveBeenCalledWith(expect.anything(), { password, email: "", role: "admin", resetToken: "reset-token" });
  });
});
