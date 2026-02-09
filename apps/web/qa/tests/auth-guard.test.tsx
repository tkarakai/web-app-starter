import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// --- Mocks ---

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

let mockUser: { name: string; email: string } | null = { name: "Test User", email: "test@example.com" };
vi.mock("@convex-dev/better-auth/nextjs/client", () => ({
  usePreloadedAuthQuery: () => mockUser,
}));

let mockSession: { isPending: boolean; data: { user: { name: string; email: string }; session: object } | null } = {
  isPending: false,
  data: { user: { name: "Test User", email: "test@example.com" }, session: {} },
};
vi.mock("@repo/auth/client", () => ({
  authClient: {
    useSession: () => mockSession,
  },
}));

// Mock i18n hook
vi.mock("next-intl", () => ({
  useLocale: () => "en",
}));

// --- Import after mocks ---

import { AuthGuard, useAuthUser } from "@/components/auth/auth-guard";

// Helper component to read context
function UserDisplay() {
  const user = useAuthUser();
  return (
    <div>
      <span data-testid="name">{user?.name ?? "none"}</span>
      <span data-testid="email">{user?.email ?? "none"}</span>
    </div>
  );
}

describe("AuthGuard", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockUser = { name: "Test User", email: "test@example.com" };
    mockSession = {
      isPending: false,
      data: { user: { name: "Test User", email: "test@example.com" }, session: {} },
    };
  });

  it("renders children when authenticated", () => {
    render(
      <AuthGuard preloadedUser={{} as never}>
        <div>Dashboard content</div>
      </AuthGuard>
    );

    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("provides user data via useAuthUser context", () => {
    render(
      <AuthGuard preloadedUser={{} as never}>
        <UserDisplay />
      </AuthGuard>
    );

    expect(screen.getByTestId("name")).toHaveTextContent("Test User");
    expect(screen.getByTestId("email")).toHaveTextContent("test@example.com");
  });

  it("redirects when Convex user becomes null (signed out in another tab)", async () => {
    const { rerender } = render(
      <AuthGuard preloadedUser={{} as never}>
        <div>Content</div>
      </AuthGuard>
    );

    // First render with user → wasAuthenticated becomes true
    await act(async () => {});

    // Simulate Convex pushing null user
    mockUser = null;
    rerender(
      <AuthGuard preloadedUser={{} as never}>
        <div>Content</div>
      </AuthGuard>
    );

    await act(async () => {});

    expect(mockReplace).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects when Better Auth session becomes null", async () => {
    const { rerender } = render(
      <AuthGuard preloadedUser={{} as never}>
        <div>Content</div>
      </AuthGuard>
    );

    await act(async () => {});

    // Simulate session invalidation
    mockSession = { isPending: false, data: null };
    rerender(
      <AuthGuard preloadedUser={{} as never}>
        <div>Content</div>
      </AuthGuard>
    );

    await act(async () => {});

    expect(mockReplace).toHaveBeenCalledWith("/sign-in");
  });

  it("does NOT redirect during initial load when session is pending", async () => {
    mockSession = { isPending: true, data: null };
    mockUser = null;

    render(
      <AuthGuard preloadedUser={{} as never}>
        <div>Content</div>
      </AuthGuard>
    );

    await act(async () => {});

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("falls back to session data when Convex user is null but session exists", () => {
    mockUser = null;
    mockSession = {
      isPending: false,
      data: { user: { name: "Session User", email: "session@example.com" }, session: {} },
    };

    render(
      <AuthGuard preloadedUser={{} as never}>
        <UserDisplay />
      </AuthGuard>
    );

    expect(screen.getByTestId("name")).toHaveTextContent("Session User");
    expect(screen.getByTestId("email")).toHaveTextContent("session@example.com");
  });
});
