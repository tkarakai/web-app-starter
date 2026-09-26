import type { AuthContext, BetterAuthPlugin } from "better-auth";
import { describe, expect, test, vi } from "vitest";
import { createAuthOptions } from "./auth";

type AuthCtx = Parameters<typeof createAuthOptions>[0];

function resetPlugin() {
  const convexCtx = {
    runAction: vi.fn(),
    runQuery: vi.fn().mockResolvedValue([{ email: "admin@example.com" }]),
  } as unknown as AuthCtx;
  const plugin: BetterAuthPlugin = createAuthOptions(convexCtx).plugins.find((p) => p.id === "password-strength")!;
  const authCtx = {
    internalAdapter: {
      findVerificationValue: vi.fn().mockResolvedValue({ value: "admin-id" }),
      findUserById: vi.fn().mockResolvedValue({ email: "admin@example.com" }),
    },
  } as unknown as AuthContext;
  return { plugin, authCtx };
}

function request(newPassword: string): Request {
  return new Request("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "reset-token", newPassword }),
  });
}

describe("admin reset password policy", () => {
  test("resolves the token owner and returns a client-readable password error", async () => {
    const { plugin, authCtx } = resetPlugin();
    const result = await plugin.onRequest!(request("orchid-quartz-river-lantern"), authCtx);
    const response = result && "response" in result ? result.response : undefined;
    expect(authCtx.internalAdapter.findVerificationValue).toHaveBeenCalledWith("reset-password:reset-token");
    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({
      code: "PASSWORD_TOO_WEAK",
      message: "Password must be at least 40 characters",
    });
  });

  test("allows a strong password meeting the admin minimum", async () => {
    const { plugin, authCtx } = resetPlugin();
    const result = await plugin.onRequest!(request("orchid quartz lantern telescope meadow violin glacier"), authCtx);
    expect(result).toBeUndefined();
  });
});
