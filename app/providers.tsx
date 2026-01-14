"use client";

import type { ReactNode } from "react";
import { ConvexProvider } from "convex/react";

import { convex } from "@/lib/convex";

interface ProvidersProps {
  children: ReactNode;
}

// Centralized provider registration keeps root layout clean and documented.
export function Providers({ children }: ProvidersProps) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
