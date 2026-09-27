import { act, renderHook, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePasswordStrength } from "@web-app-starter/auth-ui";
import { PasswordStrengthMeter, type PasswordStrengthResult } from "@web-app-starter/design-system/password-strength";
import { translatePasswordStrength as t } from "@web-app-starter/i18n/password-strength";

const state = vi.hoisted(() => ({ loading: false, query: vi.fn() }));
const strong: PasswordStrengthResult = { valid: true, score: 4, warningKey: null, suggestionKeys: [], crackTimeSeconds: 1000, tooShort: false, minLength: 40 };
vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => {
    state.query(args);
    return args === "skip" || state.loading ? undefined : strong;
  },
}));

beforeEach(() => { vi.useFakeTimers(); state.loading = false; state.query.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

function advance(ms = 750) { act(() => { vi.advanceTimersByTime(ms); }); }

describe("shared password strength lifecycle", () => {
  it("disables submission and fades the bar as soon as the password changes", () => {
    const { result, rerender } = renderHook(({ password }) => usePasswordStrength(password, { email: "admin@example.com", role: "admin" }), { initialProps: { password: "first password" } });
    expect(result.current.valid).toBe(true);
    rerender({ password: "second password" });
    expect(result.current.valid).toBe(false);
    expect(result.current.result).toBeUndefined();
    advance();
    expect(result.current.valid).toBe(true);
    expect(state.query).toHaveBeenLastCalledWith({ password: "second password", email: "admin@example.com", role: "admin" });
  });

  it("keeps the latest keystrokes queued until the pending evaluation resolves", () => {
    state.loading = true;
    const { result, rerender } = renderHook(({ password }) => usePasswordStrength(password, { email: "", role: "user", resetToken: "token" }), { initialProps: { password: "first" } });
    rerender({ password: "second" });
    rerender({ password: "latest" });
    advance(1000);
    expect(state.query).toHaveBeenLastCalledWith(expect.objectContaining({ password: "first" }));
    expect(result.current.valid).toBe(false);
    state.loading = false;
    rerender({ password: "latest" });
    expect(state.query).toHaveBeenLastCalledWith(expect.objectContaining({ password: "latest", resetToken: "token" }));
    expect(result.current.valid).toBe(true);
  });

  it("does not stall after typing and undoing back to the evaluated value", () => {
    const { result, rerender } = renderHook(({ password }) => usePasswordStrength(password, { email: "", role: "user" }), { initialProps: { password: "original" } });
    rerender({ password: "temporary" });
    rerender({ password: "original" });
    advance();
    rerender({ password: "final" });
    advance();
    expect(result.current.valid).toBe(true);
    expect(state.query).toHaveBeenLastCalledWith(expect.objectContaining({ password: "final" }));
    rerender({ password: "" });
    expect(result.current.valid).toBe(false);
  });

  it("does not evaluate login passwords or a signup before its context is ready", () => {
    const { result, rerender } = renderHook(({ enabled }) => usePasswordStrength("password", enabled ? { email: "invite@example.com", role: "user" } : "skip"), { initialProps: { enabled: false } });
    advance();
    expect(state.query.mock.calls.every(([args]) => args === "skip")).toBe(true);
    expect(result.current.valid).toBe(false);
    rerender({ enabled: true });
    expect(result.current.valid).toBe(true);
  });
});

describe("one shared meter", () => {
  it("uses catalogue feedback, fades stale results and clears on empty input", () => {
    const { container, rerender } = render(<PasswordStrengthMeter password="password" result={{ ...strong, valid: false, score: 2, tooShort: true }} t={t} />);
    expect(screen.getByText(t("minLength", { count: 40 }))).toBeInTheDocument();
    expect(screen.getByText(t("labels.fair"))).toBeInTheDocument();
    rerender(<PasswordStrengthMeter password="changed" result={undefined} t={t} />);
    expect(container.firstChild).toHaveClass("opacity-50");
    rerender(<PasswordStrengthMeter password="" result={undefined} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });
});
