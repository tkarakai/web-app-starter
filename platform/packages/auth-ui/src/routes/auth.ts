import { handler } from "@web-app-starter/auth/server";

/**
 * The Better Auth API, proxied to Convex. Re-export it from
 * `app/api/auth/[...all]/route.ts`:
 *
 *   export { GET, POST } from "@web-app-starter/auth-ui/routes/auth";
 */
export const { GET, POST } = handler;
