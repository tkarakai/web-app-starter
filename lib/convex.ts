import { ConvexReactClient } from "convex/react";

// Convex client is isolated here to document initialization conventions.
export const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL ?? ""
);
