"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

// This singleton keeps the Convex client stable across renders.
const convex = new ConvexReactClient(convexUrl);

export function Providers({ children }: { children: ReactNode }) {
  if (!convexUrl) {
    console.warn(
      "NEXT_PUBLIC_CONVEX_URL is not set. The starter UI will render, but Convex queries will be disabled.",
    );
  }

  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
