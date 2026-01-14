import { ConvexReactClient } from "convex/react";

// Convex client uses NEXT_PUBLIC_CONVEX_URL for browser connectivity.
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export const convex = new ConvexReactClient(convexUrl);
