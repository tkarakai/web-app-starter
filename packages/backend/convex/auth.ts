import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { convex } from "@convex-dev/better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { admin, emailOTP, haveIBeenPwned, magicLink, twoFactor } from "better-auth/plugins";

import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { runAuditEvent } from "./auditTrailHelpers";
import type { AuditStatus } from "./auditTrailConstants";
import authSchema from "./betterAuth/schema";
import { sendAuthEmail } from "./sendAuthEmail";
import type { EmailTemplate } from "./emailTemplates";
import { renderVerificationEmailTemplate, formatDurationHuman } from "./emailTemplates";
import { isSignupOnboarding, parseOnboardingType } from "./onboardingType";
import { USER_EMAIL_VERIFICATION_REQUIRED_KEY } from "./securityPolicies";

/** Truncate a string to at most `max` characters. */
function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length <= max ? value : value.slice(0, max);
}

/** Parse an env var as a positive integer, falling back to a safe default. */
function positiveInt(envVar: string | undefined, defaultValue: number): number {
  const parsed = parseInt(envVar ?? "", 10);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

// Better Auth runs inside Convex, so env vars are set via `convex env set`.
// SITE_URL can be a single URL or comma-separated list of URLs for multi-app development.
// Falls back to http://localhost:3001 if not yet set during Convex startup.
const siteUrlRaw = process.env.SITE_URL || "http://localhost:3001";
const siteUrls = siteUrlRaw.split(",").map((url) => url.trim()).filter(Boolean);
const siteUrl = siteUrls[0]; // Primary URL for baseURL
// Optional override for passkey RP ID. Use a shared parent domain (hostname only)
// when web/admin should both register and use the same passkeys.
const passkeyRpId = (() => {
  const raw = process.env.PASSKEY_RP_ID?.trim();
  if (!raw) return undefined;
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
})();

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

/** Build a TOTP issuer name that includes environment context.
 *  - Production: "Web App Starter"
 *  - Staging:    "Web App Starter (STAGING)"
 *  - Dev:        "Web App Starter (DEV: branch-name)" */
function getTotpIssuer(): string {
  const base = "Web App Starter";
  const isDev = process.env.DEV_SEED_ENABLED === "true";
  const isLocalhost = siteUrl.includes("localhost") || siteUrl.includes("127.0.0.1");

  if (isDev || isLocalhost) {
    const branch = process.env.GIT_BRANCH;
    return branch ? `${base} (DEV: ${branch})` : `${base} (DEV)`;
  }

  const appEnv = process.env.APP_ENVIRONMENT;
  if (appEnv && appEnv.toLowerCase() === "staging") {
    return `${base} (STAGING)`;
  }

  return base;
}

type AuthEndpointAction =
  | "auth.sign_in.requested"
  | "auth.sign_up.requested"
  | "auth.password_reset.requested"
  | "auth.password_reset.completed"
  | "auth.email_verification.requested"
  | "auth.two_factor.setup_started"
  | "auth.two_factor.disabled"
  | "auth.two_factor.verify_totp"
  | "auth.two_factor.verify_backup_code"
  | "auth.two_factor.backup_codes_regenerated";

type AuthEndpointAuditConfig = {
  action: AuthEndpointAction;
  resource: (actor: string) => string;
};

const AUTH_ENDPOINT_AUDIT_CONFIG: Record<string, AuthEndpointAuditConfig> = {
  "/sign-in/email": {
    action: "auth.sign_in.requested",
    resource: (actor) => `user:${actor}`,
  },
  "/sign-up/email": {
    action: "auth.sign_up.requested",
    resource: (actor) => `user:${actor}`,
  },
  "/request-password-reset": {
    action: "auth.password_reset.requested",
    resource: (actor) => `user:${actor}`,
  },
  "/reset-password": {
    action: "auth.password_reset.completed",
    resource: () => "password-reset:self",
  },
  "/send-verification-email": {
    action: "auth.email_verification.requested",
    resource: (actor) => `user:${actor}`,
  },
  "/two-factor/enable": {
    action: "auth.two_factor.setup_started",
    resource: () => "user:self",
  },
  "/two-factor/disable": {
    action: "auth.two_factor.disabled",
    resource: () => "user:self",
  },
  "/two-factor/verify-totp": {
    action: "auth.two_factor.verify_totp",
    resource: () => "session:pending-2fa",
  },
  "/two-factor/verify-backup-code": {
    action: "auth.two_factor.verify_backup_code",
    resource: () => "session:pending-2fa",
  },
  "/two-factor/generate-backup-codes": {
    action: "auth.two_factor.backup_codes_regenerated",
    resource: () => "user:self",
  },
};

type ApiErrorLike = {
  statusCode: number;
  message?: string;
};

function normalizeAuthPath(path: string): string {
  return path.replace(/^\/api\/auth/, "");
}

function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function getApiErrorLike(value: unknown): ApiErrorLike | null {
  if (!value || typeof value !== "object") return null;
  const maybeError = value as {
    statusCode?: unknown;
    body?: { message?: unknown };
  };
  if (typeof maybeError.statusCode !== "number") return null;
  return {
    statusCode: maybeError.statusCode,
    message:
      typeof maybeError.body?.message === "string"
        ? maybeError.body.message
        : undefined,
  };
}

function mapEndpointErrorToStatus(
  path: string,
  error: ApiErrorLike | null,
): AuditStatus {
  if (!error) return "succeeded";

  const message = (error.message ?? "").toLowerCase();

  if (error.statusCode === 401) {
    if (
      path === "/two-factor/verify-totp" ||
      path === "/two-factor/verify-backup-code"
    ) {
      return "failed.invalid_code";
    }
    if (path === "/sign-in/email") return "failed.wrong_password";
    return "failed.unauthorized";
  }

  if (error.statusCode === 403) return "failed.blocked";
  if (error.statusCode === 404) return "failed.not_found";
  if (error.statusCode === 429) return "failed.rate_limited";

  if (error.statusCode === 400 || error.statusCode === 422) {
    if (message.includes("invalid_password")) {
      return "failed.wrong_password";
    }
    if (message.includes("invalid_token") || message.includes("expired")) {
      return "failed.expired";
    }
    if (
      (path === "/two-factor/verify-totp" ||
        path === "/two-factor/verify-backup-code") &&
      (message.includes("invalid") || message.includes("code"))
    ) {
      return "failed.invalid_code";
    }
    return "failed.validation_error";
  }

  if (error.statusCode >= 500) return "failed.internal_error";
  return "failed.unknown";
}

/** Email verification token lifetime in seconds (BetterAuth default: 3600 = 1 hour). */
const EMAIL_VERIFICATION_EXPIRY_SECONDS = positiveInt(
  process.env.AUTH_EMAIL_VERIFICATION_EXPIRY,
  3600,
);

export const createAuthOptions = (
  ctx: GenericCtx<DataModel>,
) => {
  return {
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    session: {
      // Spec §8.3: user sessions = 7 days / refresh every 1 hour.
      // Admin sessions (4 hours) are enforced at the middleware level.
      expiresIn: 60 * 60 * 24 * 7,  // 7 days
      updateAge: 60 * 60,            // 1 hour
    },
    emailAndPassword: {
      enabled: true,
      // requireEmailVerification is kept false here so Better Auth does not
      // block sign-ins at the protocol level. Enforcement is done at the
      // app level (dashboard layout + AuthGuard) so the admin toggle works
      // without requiring an async createAuth factory.
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
        await sendAuthEmail({
          to: user.email,
          type: "reset-password",
          urlOrCode: url,
        });
      },
    },
    emailVerification: {
      // Always trigger the callback on sign-up; the callback decides whether
      // to actually send based on the current admin setting.
      sendOnSignUp: true,
      // Verifying an email should update the user record only; it must not
      // create or refresh an authenticated session from the verification link.
      autoSignInAfterVerification: false,
      expiresIn: EMAIL_VERIFICATION_EXPIRY_SECONDS,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        // Read settings per-request — callbacks are async and have ctx.
        const actionCtx = requireActionCtx(ctx);
        const emailVerifRequired = await actionCtx.runQuery(
          internal.appSettings.getInternal,
          { key: USER_EMAIL_VERIFICATION_REQUIRED_KEY }
        );
        // If the admin has disabled email verification, skip sending.
        if (emailVerifRequired === false) return;

        const verificationTemplateSetting = await actionCtx.runQuery(
          internal.appSettings.getInternal,
          { key: "emailVerificationTemplate" }
        );
        const verificationTemplate: EmailTemplate | null =
          typeof verificationTemplateSetting === "string"
            ? (JSON.parse(verificationTemplateSetting) as EmailTemplate)
            : verificationTemplateSetting != null
            ? (verificationTemplateSetting as EmailTemplate)
            : null;

        const linkExpiry = formatDurationHuman(EMAIL_VERIFICATION_EXPIRY_SECONDS);

        if (verificationTemplate) {
          const rendered = renderVerificationEmailTemplate(verificationTemplate, {
            verification_link: url,
            link_expiry: linkExpiry,
          });
          await sendAuthEmail({
            to: user.email,
            type: "custom",
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          });
        } else {
          await sendAuthEmail({
            to: user.email,
            type: "verification",
            urlOrCode: url,
            linkExpiry,
          });
        }
      },
    },
    hooks: {
      after: async (endpointCtx) => {
        const middlewareCtx = endpointCtx as unknown as {
          path?: string;
          body?: unknown;
          context?: {
            returned?: unknown;
            session?: { user?: { email?: unknown } };
          };
        };

        const rawPath =
          typeof middlewareCtx.path === "string" ? middlewareCtx.path : "";
        const path = normalizeAuthPath(rawPath);
        const config = AUTH_ENDPOINT_AUDIT_CONFIG[path];
        if (!config) return {};

        const body =
          middlewareCtx.body && typeof middlewareCtx.body === "object"
            ? (middlewareCtx.body as Record<string, unknown>)
            : {};
        const sessionUser = middlewareCtx.context?.session?.user;
        const actor =
          normalizeEmail(body.email) ??
          normalizeEmail(sessionUser?.email) ??
          "unknown";
        const error = getApiErrorLike(middlewareCtx.context?.returned);
        const status = mapEndpointErrorToStatus(path, error);

        const actionCtx = requireActionCtx(ctx);
        await runAuditEvent(actionCtx, {
          happenedAt: Date.now(),
          actor,
          sourceDetail: "auth-endpoint-hook",
          action: config.action,
          resource: config.resource(actor),
          status,
          reason: error?.message,
          meta: JSON.stringify({ endpoint: path }),
        });
        return {};
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            const actionCtx = requireActionCtx(ctx);
            const s = session as Record<string, unknown>;
            const userId = s.userId as string;
            const sessionId = (s.id ?? s._id ?? "") as string;

            // Look up user email via the Better Auth component
            const user = await authComponent.getAnyUserById(ctx, userId);

            const email = (user?.email as string) ?? "unknown";
            const ip = truncate(s.ipAddress as string | undefined, 200);
            const userAgent = truncate(s.userAgent as string | undefined, 500);
            const meta: Record<string, string> = {};
            if (ip) meta.ip = ip;
            if (userAgent) meta.userAgent = userAgent;

            await runAuditEvent(actionCtx, {
              happenedAt: Date.now(),
              actor: email,
              authenticatedUserId: userId,
              sourceDetail: "auth-hook",
              action: "auth.sign_in",
              resource: `session:${sessionId}`,
              status: "succeeded",
              meta: Object.keys(meta).length > 0 ? JSON.stringify(meta) : undefined,
            });
          },
        },
        delete: {
          before: async (session) => {
            const actionCtx = requireActionCtx(ctx);
            const s = session as Record<string, unknown>;
            const userId = s.userId as string;
            const sessionId = (s.id ?? s._id ?? "") as string;

            const user = await authComponent.getAnyUserById(ctx, userId);

            const email = (user?.email as string) ?? "unknown";
            const ip = truncate(s.ipAddress as string | undefined, 200);
            const userAgent = truncate(s.userAgent as string | undefined, 500);
            const meta: Record<string, string> = {};
            if (ip) meta.ip = ip;
            if (userAgent) meta.userAgent = userAgent;

            await runAuditEvent(actionCtx, {
              happenedAt: Date.now(),
              actor: email,
              authenticatedUserId: userId,
              sourceDetail: "auth-hook",
              action: "auth.sign_out",
              resource: `session:${sessionId}`,
              status: "succeeded",
              meta: Object.keys(meta).length > 0 ? JSON.stringify(meta) : undefined,
            });
          },
        },
      },
      user: {
        create: {
          before: async (user) => {
            const actionCtx = requireActionCtx(ctx);

            // Public signup is allowed only in signup onboarding mode.
            // Invitation-based signups remain allowed regardless of mode.
            const onboardingTypeRaw = await actionCtx.runQuery(
              internal.appSettings.getInternal,
              { key: "onboardingType" },
            );
            const onboardingType = parseOnboardingType(onboardingTypeRaw);
            const hasInvitation = await actionCtx.runQuery(
              internal.waitlistTokens.hasValidInvitation,
              { email: user.email },
            );
            if (!isSignupOnboarding(onboardingType) && !hasInvitation) {
              throw new Error("SIGNUP_DISABLED");
            }

            // Auto-assign "admin" role to users whose email is in the adminEmails table.
            const adminEmails = await actionCtx.runQuery(
              internal.adminEmails.list,
            );
            if (adminEmails.some((row: { email: string }) => row.email === user.email)) {
              return { data: { ...user, role: "admin" } };
            }
            return { data: user };
          },
          after: async (user) => {
            const actionCtx = requireActionCtx(ctx);
            const userId = (user as Record<string, unknown>).id as string ?? "";

            await runAuditEvent(actionCtx, {
              happenedAt: Date.now(),
              actor: user.email,
              authenticatedUserId: userId || undefined,
              sourceDetail: "auth-hook",
              action: "auth.sign_up",
              resource: `user:${userId}`,
              status: "succeeded",
            });
          },
        },
      },
    },
    plugins: [
      multiOriginPlugin(),
      protectedAdminPlugin(ctx),
      admin(),
      twoFactor({
        issuer: getTotpIssuer(),
        totpOptions: {
          period: 30,
          digits: 6,
        },
        otpOptions: {
          async sendOTP({ user, otp }) {
            await sendAuthEmail({
              to: user.email,
              type: "email-otp",
              urlOrCode: otp,
            });
          },
        },
      }),
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          await sendAuthEmail({
            to: email,
            type: "email-otp",
            urlOrCode: otp,
          });
        },
      }),
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendAuthEmail({
            to: email,
            type: "magic-link",
            urlOrCode: url,
          });
        },
      }),
      passkey(passkeyRpId ? { rpID: passkeyRpId } : undefined),
      haveIBeenPwned(),
      convex({ authConfig }),
    ],
    rateLimit: {
      enabled: true,
      window: positiveInt(process.env.AUTH_RATE_LIMIT_WINDOW, 60),
      max: positiveInt(process.env.AUTH_RATE_LIMIT_MAX, 100),
      storage: "database",
      customRules: {
        "/sign-in/email": {
          window: positiveInt(process.env.AUTH_RATE_LIMIT_SIGNIN_WINDOW, 10),
          max: positiveInt(process.env.AUTH_RATE_LIMIT_SIGNIN_MAX, 3),
        },
        "/sign-up/email": {
          window: positiveInt(process.env.AUTH_RATE_LIMIT_SIGNUP_WINDOW, 60),
          max: positiveInt(process.env.AUTH_RATE_LIMIT_SIGNUP_MAX, 5),
        },
        "/request-password-reset": {
          window: positiveInt(process.env.AUTH_RATE_LIMIT_RESET_WINDOW, 60),
          max: positiveInt(process.env.AUTH_RATE_LIMIT_RESET_MAX, 3),
        },
        "/reset-password": {
          window: positiveInt(process.env.AUTH_RATE_LIMIT_RESET_WINDOW, 60),
          max: positiveInt(process.env.AUTH_RATE_LIMIT_RESET_MAX, 5),
        },
        "/send-verification-email": {
          window: positiveInt(process.env.AUTH_RATE_LIMIT_VERIFY_WINDOW, 60),
          max: positiveInt(process.env.AUTH_RATE_LIMIT_VERIFY_MAX, 3),
        },
        "/email-otp/send-verification-otp": {
          window: 60,
          max: 3,
        },
        "/magic-link/send-magic-link": {
          window: 60,
          max: 3,
        },
        // Session checks must not be rate limited — real-time polling depends on them.
        "/get-session": false,
      },
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
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
