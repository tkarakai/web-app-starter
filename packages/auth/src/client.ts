import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [convexClient()],
  fetchOptions: {
    onError: async (context) => {
      if (context.response.status === 429) {
        const retryAfter = context.response.headers.get("X-Retry-After");
        console.warn(
          `[auth] Rate limited. Retry after ${retryAfter ?? "unknown"} seconds.`,
        );
      }
    },
  },
});
