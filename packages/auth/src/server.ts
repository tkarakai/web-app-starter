import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

// Next.js server helpers that proxy auth requests to the Convex deployment.
export const {
  handler,
  preloadAuthQuery,
  isAuthenticated,
  getToken,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthNextJs({
  convexUrl: process.env.CONVEX_URL!,
  convexSiteUrl: process.env.CONVEX_SITE_URL!,
});
