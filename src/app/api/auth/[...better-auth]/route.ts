import { auth } from "@/lib/auth";

// BetterAuth exposes request handlers that map to App Router routes.
export const { GET, POST } = auth.handlers;
