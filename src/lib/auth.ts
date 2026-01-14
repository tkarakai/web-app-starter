import { betterAuth } from "better-auth";
import { convexAdapter } from "better-auth/adapters/convex";

// Centralized BetterAuth configuration.
// This keeps auth wiring in one place so it is easy to update or replace.
export const auth = betterAuth({
  appName: "Web App Starter",
  secret: process.env.BETTER_AUTH_SECRET ?? "",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: convexAdapter({
    deployment: process.env.CONVEX_DEPLOYMENT ?? "",
    apiUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? ""
  }),
  emailAndPassword: {
    enabled: true
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? ""
    }
  }
});
