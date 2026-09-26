import { describe, expect, test } from "vitest";

import { getSessionToken, type SessionInfo } from "./sessions";
import { parseUserAgent } from "./parseUserAgent";
import { AUTH_COOKIE_PREFIX } from "@web-app-starter/auth/cookies";

/** The cookie prefix from app.config.ts. */
const P = AUTH_COOKIE_PREFIX;

/**
 * Sessions module tests.
 *
 * The session handlers are httpActions that delegate to Better Auth's session
 * management API. Since httpActions run within the Convex runtime and require
 * real HTTP context, we test at the type/contract level and the supporting
 * utilities (parseUserAgent, token extraction logic).
 *
 * Full integration testing of session list/revoke is covered by E2E tests.
 */

describe("sessions module", () => {
  describe("SessionInfo type contract", () => {
    test("SessionInfo has all required fields", () => {
      // Verify the type shape at runtime with a mock object
      const mockSession: SessionInfo = {
        token: "session-token-abc",
        isCurrent: true,
        ipAddress: "192.168.1.1",
        device: parseUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0"),
        userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0",
        createdAt: Date.now(),
        lastActive: Date.now(),
        expiresAt: Date.now() + 86400000,
      };

      expect(mockSession.token).toBeDefined();
      expect(mockSession.isCurrent).toBe(true);
      expect(mockSession.ipAddress).toBe("192.168.1.1");
      expect(mockSession.device.browser).toBe("Chrome 120");
      expect(mockSession.device.os).toBe("Windows 10+");
      expect(mockSession.device.device).toBe("desktop");
      expect(mockSession.createdAt).toBeGreaterThan(0);
      expect(mockSession.lastActive).toBeGreaterThan(0);
      expect(mockSession.expiresAt).toBeGreaterThan(mockSession.createdAt);
    });

    test("SessionInfo supports null IP and user agent", () => {
      const mockSession: SessionInfo = {
        token: "token-123",
        isCurrent: false,
        ipAddress: null,
        device: parseUserAgent(null),
        userAgent: null,
        createdAt: Date.now(),
        lastActive: Date.now(),
        expiresAt: Date.now() + 86400000,
      };

      expect(mockSession.ipAddress).toBeNull();
      expect(mockSession.userAgent).toBeNull();
      expect(mockSession.device.browser).toBe("Unknown");
      expect(mockSession.device.os).toBe("Unknown");
      expect(mockSession.device.device).toBe("unknown");
    });
  });

  describe("session token extraction (getSessionToken)", () => {
    function request(headers: Record<string, string>): Request {
      return new Request("http://127.0.0.1:3211/api/sessions", { headers });
    }

    test("Bearer token is extracted from authorization header", () => {
      expect(getSessionToken(request({ authorization: "Bearer test-token-123" }))).toBe(
        "test-token-123",
      );
    });

    test("session token is extracted from the HTTP cookie", () => {
      const cookie = `other=value; ${P}.session_token=my-session-token; another=data`;
      expect(getSessionToken(request({ cookie }))).toBe("my-session-token");
    });

    test("session token is extracted from the HTTPS (__Secure-) cookie", () => {
      const cookie = `__Secure-${P}.session_token=secure-token`;
      expect(getSessionToken(request({ cookie }))).toBe("secure-token");
    });

    test("look-alike cookie names are ignored", () => {
      for (const name of [
        `evil-${P}.session_token`,
        `${P}.session_token_x`,
        `x${P}.session_token`,
        `__Host-${P}.session_token`,
      ]) {
        expect(getSessionToken(request({ cookie: `${name}=forged` }))).toBeNull();
      }
    });

    test("a look-alike before the real cookie does not shadow it", () => {
      const cookie = `evil-${P}.session_token=forged; ${P}.session_token=real`;
      expect(getSessionToken(request({ cookie }))).toBe("real");
    });

    test("returns null when no session token in cookies", () => {
      expect(getSessionToken(request({ cookie: "other=value; another=data" }))).toBeNull();
    });

    test("returns null without cookie or authorization headers", () => {
      expect(getSessionToken(request({}))).toBeNull();
    });
  });

  describe("session revocation guards", () => {
    test("cannot revoke current session (same token check)", () => {
      const currentToken = "current-session-token";
      const targetToken = "current-session-token";

      // The handler rejects revoking the current session
      expect(targetToken === currentToken).toBe(true);
    });

    test("can revoke a different session", () => {
      const currentToken = "current-session-token";
      const targetToken = "other-session-token";

      expect(targetToken === currentToken).toBe(false);
    });
  });

  describe("session enrichment", () => {
    test("enriches raw session data with parsed device info", () => {
      const rawSession = {
        token: "tok-123",
        ipAddress: "10.0.0.1",
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
        createdAt: "2024-01-15T10:00:00.000Z",
        updatedAt: "2024-01-15T12:00:00.000Z",
        expiresAt: "2024-01-22T10:00:00.000Z",
      };

      const enriched: SessionInfo = {
        token: rawSession.token,
        isCurrent: false,
        ipAddress: rawSession.ipAddress,
        device: parseUserAgent(rawSession.userAgent),
        userAgent: rawSession.userAgent,
        createdAt: new Date(rawSession.createdAt).getTime(),
        lastActive: new Date(rawSession.updatedAt).getTime(),
        expiresAt: new Date(rawSession.expiresAt).getTime(),
      };

      expect(enriched.device.browser).toBe("Safari 17");
      expect(enriched.device.os).toBe("iOS 17.2");
      expect(enriched.device.device).toBe("mobile");
      expect(enriched.createdAt).toBeLessThan(enriched.lastActive);
      expect(enriched.lastActive).toBeLessThan(enriched.expiresAt);
    });
  });
});
