import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@web-app-starter/i18n/messages/en.json";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionsList } from "../../src/settings/sessions-list";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listSessions: vi.fn(),
  audit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.audit,
}));

vi.mock("@web-app-starter/auth/client", () => ({
  authClient: {
    getSession: mocks.getSession,
    listSessions: mocks.listSessions,
    revokeSession: vi.fn(),
    revokeOtherSessions: vi.fn(),
  },
}));

const duplicateSession = {
  id: "duplicate-session",
  token: "other-session-token",
  userId: "user-1",
  ipAddress: "192.0.2.1",
  userAgent: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: new Date("2027-01-01T00:00:00Z"),
};

describe("SessionsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessions.mockResolvedValue({
      data: [duplicateSession, { ...duplicateSession }],
      error: null,
    });
    mocks.getSession.mockResolvedValue({
      data: { session: { token: "current-session-token" } },
      error: null,
    });
  });

  it("renders one card when Better Auth returns a duplicate session id", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SessionsList />
      </NextIntlClientProvider>,
    );

    expect(await screen.findAllByText(duplicateSession.ipAddress)).toHaveLength(1);
  });
});
