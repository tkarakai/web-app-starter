"use client";

import { useState, type PropsWithChildren } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import type { AuthClient } from "@convex-dev/better-auth/react";
import { authClient } from "./client";

export function ConvexClientProvider({
  children,
  initialToken,
  convexUrl,
}: PropsWithChildren<{ initialToken?: string | null; convexUrl: string }>) {
  // Created lazily from a prop rather than from NEXT_PUBLIC_CONVEX_URL at module
  // scope: a NEXT_PUBLIC_* read is inlined into the client bundle at build time,
  // which pins the artifact to one environment. The root layout reads CONVEX_URL
  // at request time and passes it down instead.
  // See docs/claude/build-once-promote-plan.md
  const [convex] = useState(() => new ConvexReactClient(convexUrl));

  return (
    <ConvexBetterAuthProvider
      client={convex}
      // `AuthClient` is declared as
      //   ReturnType<typeof createAuthClient<BetterAuthClientPlugin & { plugins }>>
      // and that instantiation collapses `useSession().data` to `never`, so no
      // client built with real plugin inference can satisfy it — ours included.
      // The shape is correct at runtime (the auth E2E suite exercises session,
      // 2FA and passkey flows through this provider); only the declaration is
      // too narrow. Revisit when the adapter's types are widened.
      authClient={authClient as unknown as AuthClient}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
  );
}
