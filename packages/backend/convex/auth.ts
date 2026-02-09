import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { admin } from "better-auth/plugins";

import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";

// Better Auth runs inside Convex, so env vars are set via `convex env set`.
// SITE_URL can be a single URL or comma-separated list of URLs for multi-app development.
// Falls back to http://localhost:3001 if not yet set during Convex startup.
const siteUrlRaw = process.env.SITE_URL || "http://localhost:3001";
const siteUrls = siteUrlRaw.split(",").map((url) => url.trim()).filter(Boolean);
const siteUrl = siteUrls[0]; // Primary URL for baseURL

// Custom plugin to set trusted origins for all app URLs
const multiOriginPlugin = (): BetterAuthPlugin => ({
  id: "multi-origin",
  init() {
    return {
      options: {
        trustedOrigins: siteUrls,
      },
    };
  },
});

// Admin mutation paths that should be guarded for protected admins
const PROTECTED_ADMIN_PATHS = [
  "/admin/ban-user",
  "/admin/remove-user",
  "/admin/set-role",
];

// Plugin that prevents banning, deleting, or demoting users whose emails
// appear in the adminEmails table.
const protectedAdminPlugin = (
  convexCtx: GenericCtx<DataModel>,
): BetterAuthPlugin => ({
  id: "protected-admin",
  async onRequest(request, ctx) {
    const url = new URL(request.url);
    // Strip the base path prefix (e.g. /api/auth) to get the route path
    const path = url.pathname.replace(/^\/api\/auth/, "");

    if (!PROTECTED_ADMIN_PATHS.some((p) => path.endsWith(p))) return;

    let body: Record<string, unknown>;
    try {
      body = (await request.clone().json()) as Record<string, unknown>;
    } catch {
      return;
    }

    const userId = body.userId as string | undefined;
    if (!userId) return;

    const targetUser = await ctx.internalAdapter.findUserById(userId);
    if (!targetUser) return;

    const actionCtx = requireActionCtx(convexCtx);
    const adminEmailRows = await actionCtx.runQuery(internal.adminEmails.list);
    if (
      adminEmailRows.some(
        (row: { email: string }) => row.email === targetUser.email,
      )
    ) {
      return {
        response: new Response(
          JSON.stringify({
            error: { message: "Cannot modify a protected admin" },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      };
    }
  },
});

export const authComponent = createClient<DataModel, typeof authSchema>(
  components.betterAuth,
  {
    local: {
      schema: authSchema,
    },
  },
);

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  return {
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // Auto-assign "admin" role to users whose email is in the adminEmails table.
            // ctx is the Convex action context captured via closure from createAuthOptions().
            const actionCtx = requireActionCtx(ctx);
            const adminEmails = await actionCtx.runQuery(
              internal.adminEmails.list,
            );
            if (adminEmails.some((row: { email: string }) => row.email === user.email)) {
              return { data: { ...user, role: "admin" } };
            }
            return { data: user };
          },
        },
      },
    },
    plugins: [
      multiOriginPlugin(),
      protectedAdminPlugin(ctx),
      admin(),
      convex({ authConfig }),
    ],
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
  } satisfies BetterAuthOptions;
};

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth(createAuthOptions(ctx));
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
