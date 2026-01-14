import { betterAuth } from "better-auth";

/**
 * BetterAuth configuration lives here so the rest of the app can import a single auth object.
 * Replace the placeholder provider configuration with your own and wire up Convex once you
 * create a deployment.
 */
export const auth = betterAuth({
  appName: "Web App Starter",
  secret: process.env.BETTER_AUTH_SECRET ?? "development-secret",
  baseURL: process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000",
  // TODO: Replace with a real Convex adapter when you initialize your deployment.
  database: {
    provider: "convex",
    url: process.env.CONVEX_URL ?? "",
  },
  emailAndPassword: {
    enabled: true,
  },
});
