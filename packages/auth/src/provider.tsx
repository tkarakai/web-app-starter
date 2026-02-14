"use client";

import { useRef, type PropsWithChildren } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { authClient } from "./client";

export function ConvexClientProvider({
  children,
  initialToken,
  convexUrl,
}: PropsWithChildren<{ initialToken?: string | null; convexUrl: string }>) {
  const clientRef = useRef<ConvexReactClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new ConvexReactClient(convexUrl);
  }

  return (
    <ConvexBetterAuthProvider
      client={clientRef.current}
      authClient={authClient}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
  );
}
