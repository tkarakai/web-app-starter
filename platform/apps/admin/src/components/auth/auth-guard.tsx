"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { usePreloadedAuthQuery } from "@convex-dev/better-auth/nextjs/client";
import type { Preloaded } from "convex/react";

import type { api } from "@repo/backend";
import { authClient } from "@web-app-starter/auth/client";

type AuthUser = {
  id?: string;
  name?: string;
  email?: string;
};

const AuthUserContext = React.createContext<AuthUser | null>(null);

export function useAuthUser(): AuthUser | null {
  return React.useContext(AuthUserContext);
}

type AuthGuardProps = {
  preloadedUser: Preloaded<typeof api.platform.auth.getCurrentUser>;
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

  // Redirect to sign-in when the session is invalidated (e.g. signed out in another
  // tab). The Convex real-time subscription is the authoritative signal; a debounce
  // prevents false redirects during transient session refreshes (2FA enable/disable,
  // password change) where the query briefly returns null while the new session token
  // propagates.
  //
  // `authClient.useSession()` is deliberately NOT a trigger. It reports
  // `{ isPending: false, data: null }` for a beat after `verifyTotp` swaps the session
  // token, which bounced the admin to /sign-in — and `proxy.ts`, seeing a cookie that
  // is still valid, bounced them on to /dashboard. Enrolment therefore navigated away
  // from the settings page before the backup codes were ever rendered. This mirrors
  // apps/web/src/components/auth/auth-guard.tsx, which was already fixed this way.
  React.useEffect(() => {
    if (!(wasAuthenticated && user === null)) return;

    const timeout = setTimeout(() => {
      router.replace("/sign-in");
    }, 3000);

    return () => clearTimeout(timeout);
  }, [wasAuthenticated, user, router]);

  const authUser: AuthUser = {
    id: session.data?.user?.id ?? undefined,
    name: user?.name ?? session.data?.user?.name ?? undefined,
    email: user?.email ?? session.data?.user?.email ?? undefined,
  };

  return (
    <AuthUserContext.Provider value={authUser}>
      {children}
    </AuthUserContext.Provider>
  );
}
