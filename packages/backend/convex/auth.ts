import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";

import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

// Better Auth runs inside Convex, so SITE_URL is set via `convex env set`.
const siteUrl = process.env.SITE_URL!;

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [convex({ authConfig })],
    rateLimit: {
      enabled: true,
      window: Number(process.env.AUTH_RATE_LIMIT_WINDOW ?? "60"),
      max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? "100"),
      storage: "database",
      customRules: {
        "/sign-in/email": {
          window: Number(process.env.AUTH_RATE_LIMIT_SIGNIN_WINDOW ?? "10"),
          max: Number(process.env.AUTH_RATE_LIMIT_SIGNIN_MAX ?? "3"),
        },
        "/sign-up/email": {
          window: Number(process.env.AUTH_RATE_LIMIT_SIGNUP_WINDOW ?? "60"),
          max: Number(process.env.AUTH_RATE_LIMIT_SIGNUP_MAX ?? "5"),
        },
        // Session checks must not be rate limited — real-time polling depends on them.
        "/get-session": false,
      },
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
      },
    },
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    try {
      return await authComponent.getAuthUser(ctx);
    } catch {
      return null;
    }
  },
});
