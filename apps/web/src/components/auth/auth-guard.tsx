"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { usePreloadedAuthQuery } from "@convex-dev/better-auth/nextjs/client";
import type { Preloaded } from "convex/react";

import type { api } from "@repo/backend";
import { authClient } from "@repo/auth/client";

type AuthUser = {
  name?: string;
  email?: string;
};

const AuthUserContext = React.createContext<AuthUser | null>(null);

export function useAuthUser(): AuthUser | null {
  return React.useContext(AuthUserContext);
}

type AuthGuardProps = {
  preloadedUser: Preloaded<typeof api.auth.getCurrentUser>;
  children: React.ReactNode;
};

export function AuthGuard({ preloadedUser, children }: AuthGuardProps) {
  const router = useRouter();
  const user = usePreloadedAuthQuery(preloadedUser);
  const session = authClient.useSession();
  const [wasAuthenticated, setWasAuthenticated] = React.useState(false);

  // Track that we had a valid user at least once (avoids redirect during initial load).
  React.useEffect(() => {
    if (user != null) {
      setWasAuthenticated(true);
    }
  }, [user]);

  // Redirect to sign-in when the session is invalidated (e.g. signed out in another tab).
  // We rely on the Convex real-time subscription as the authoritative signal.
  // A debounce prevents false redirects during transient session refreshes
  // (e.g. password change, 2FA enable/disable) where the Convex query briefly
  // returns null while the new session token propagates.
  React.useEffect(() => {
    if (!(wasAuthenticated && user === null)) return;

    const timeout = setTimeout(() => {
      router.replace("/sign-in");
    }, 3000);

    return () => clearTimeout(timeout);
  }, [wasAuthenticated, user, router]);

  const authUser: AuthUser = {
    name: user?.name ?? session.data?.user?.name ?? undefined,
    email: user?.email ?? session.data?.user?.email ?? undefined,
  };

  return (
    <AuthUserContext.Provider value={authUser}>
      {children}
    </AuthUserContext.Provider>
  );
}
