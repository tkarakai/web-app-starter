import { defineRateLimits } from "convex-helpers/server/rateLimit";
import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

const MINUTE = 60_000;
const SECOND = 1_000;
const DAY = 24 * 60 * MINUTE;

export const AUTH_RECIPIENT_LIMITS: Readonly<Record<string, string>> = {
  "/sign-in/email": "authSignIn",
  "/sign-up/email": "authSignUp",
  "/request-password-reset": "authPasswordResetRequest",
  "/send-verification-email": "authVerificationEmail",
  "/sign-in/magic-link": "authMagicLink",
  "/email-otp/send-verification-otp": "authEmailOtp",
  "/email-otp/request-password-reset": "authPasswordResetRequest",
  "/forget-password/email-otp": "authPasswordResetRequest",
  "/email-otp/check-verification-otp": "authSignIn",
  "/email-otp/verify-email": "authSignIn",
  "/sign-in/email-otp": "authSignIn",
  "/email-otp/reset-password": "authPasswordReset",
};

/** Parse an env var as a positive integer, falling back to a safe default. */
function positiveInt(envVar: string | undefined, defaultValue: number): number {
  const parsed = parseInt(envVar ?? "", 10);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

/**
 * Centralized rate limit definitions for Convex functions.
 *
 * Token bucket: smooth rate over time, allows burst up to capacity.
 * Selected deployment budgets are configurable via Convex environment variables.
 */
const rateLimitDefs = {
  /** All non-polling auth routes, including newly installed plugin endpoints. */
  authRequestGlobal: { kind: "token bucket", rate: 1000, period: MINUTE, capacity: 250 },
  /** Additional protection when an operator has verified an ingress-overwritten IP header. */
  authRequestIp: { kind: "token bucket", rate: 100, period: MINUTE, capacity: 100 },
  authEmailRecipient: { kind: "token bucket", rate: 3, period: MINUTE, capacity: 3 },
  authEmailGlobal: {
    kind: "token bucket",
    rate: positiveInt(process.env.AUTH_EMAIL_RATE_PER_MINUTE, 60), period: MINUTE,
    capacity: positiveInt(process.env.AUTH_EMAIL_BURST, 20),
  },
  authEmailDaily: {
    kind: "token bucket",
    rate: positiveInt(process.env.AUTH_EMAIL_RATE_PER_DAY, 1000), period: DAY,
    capacity: positiveInt(process.env.AUTH_EMAIL_RATE_PER_DAY, 1000),
  },
  /** Log at most one exhaustion signal per five minutes, regardless of attacker retries. */
  authEmailAlert: { kind: "token bucket", rate: 1, period: 5 * MINUTE, capacity: 1 },
  /** Global per-user mutation rate limit applied to all authedMutation calls. */
  agentRequest: { kind: "token bucket", rate: 100, period: MINUTE, capacity: 50 },
  mutationGlobal: {
    kind: "token bucket",
    rate: positiveInt(process.env.MUTATION_RATE_LIMIT_RATE, 30),
    period: positiveInt(process.env.MUTATION_RATE_LIMIT_PERIOD, MINUTE),
    capacity: positiveInt(process.env.MUTATION_RATE_LIMIT_CAPACITY, 10),
  },

  /** Public waitlist join endpoint — keyed by IP address. */
  waitlistJoin: {
    kind: "token bucket",
    rate: positiveInt(process.env.WAITLIST_RATE_LIMIT_RATE, 5),
    period: positiveInt(process.env.WAITLIST_RATE_LIMIT_PERIOD, MINUTE),
    capacity: positiveInt(process.env.WAITLIST_RATE_LIMIT_CAPACITY, 3),
  },

  /** Invitation token claim — keyed by token string to prevent brute-force. */
  tokenClaim: {
    kind: "token bucket",
    rate: 3,
    period: MINUTE,
    capacity: 3,
  },

  // ---------------------------------------------------------------------------
  // Auth endpoint rate limits (replaces Better Auth's built-in rate limiting
  // which causes OCC conflicts on Convex's database storage).
  // Keyed by a hash of the normalized recipient; request/IP budgets are separate.
  // ---------------------------------------------------------------------------

  /** Sign-in — keyed by email to prevent brute-force password guessing. */
  authSignIn: {
    kind: "token bucket",
    rate: 3,
    period: 10 * SECOND,
    capacity: 3,
  },

  /** Sign-up — keyed by normalized recipient; ingress/global budgets also apply. */
  authSignUp: {
    kind: "token bucket",
    rate: 5,
    period: MINUTE,
    capacity: 5,
  },

  /** Password reset request — keyed by normalized recipient. */
  authPasswordResetRequest: {
    kind: "token bucket",
    rate: 3,
    period: MINUTE,
    capacity: 3,
  },

  /** Email-OTP password reset — keyed by normalized recipient. */
  authPasswordReset: {
    kind: "token bucket",
    rate: 5,
    period: MINUTE,
    capacity: 5,
  },

  /** Recovery-secret reauthentication — shared across transports, keyed by user ID. */
  authRecoverySecrets: {
    kind: "token bucket",
    rate: 5,
    period: MINUTE,
    capacity: 5,
  },
  /** Password/factor step-up attempts, including already-authenticated sessions. */
  authStepUp: { kind: "token bucket", rate: 5, period: MINUTE, capacity: 5 },

  /** Verification email — keyed by normalized recipient. */
  authVerificationEmail: {
    kind: "token bucket",
    rate: 3,
    period: MINUTE,
    capacity: 3,
  },

  /** Email OTP send — keyed by normalized recipient. */
  authEmailOtp: {
    kind: "token bucket",
    rate: 3,
    period: MINUTE,
    capacity: 3,
  },

  /** Magic link send — keyed by normalized recipient. */
  authMagicLink: {
    kind: "token bucket",
    rate: 3,
    period: MINUTE,
    capacity: 3,
  },
} as const;

export const { checkRateLimit, rateLimit, resetRateLimit } =
  defineRateLimits(rateLimitDefs);

/** Union of all rate limit names defined above. */
type DefinedRateLimitName = keyof typeof rateLimitDefs;

/**
 * Internal mutation callable from HTTP actions (e.g. Better Auth plugins).
 * Consumes a token and returns { ok, retryAt } without throwing so the
 * caller can build the appropriate HTTP 429 response.
 */
export const consumeAuthRateLimit = internalMutation({
  args: {
    name: v.string(),
    key: v.string(),
  },
  handler: async (ctx, { name, key }) => {
    return await rateLimit(ctx, {
      name: name as DefinedRateLimitName,
      key,
      throws: false,
    });
  },
});


/** Durable request budget, committed before any auth handler or outbound callback. */
export const consumeAuthRequestBudget = internalMutation({
  args: { path: v.string(), recipientKey: v.optional(v.string()), ipKey: v.optional(v.string()) },
  handler: async (ctx, { path, recipientKey, ipKey }) => {
    const global = await rateLimit(ctx, { name: "authRequestGlobal", throws: false });
    if (!global.ok) return global;
    if (ipKey) {
      const ip = await rateLimit(ctx, { name: "authRequestIp", key: ipKey, throws: false });
      if (!ip.ok) return ip;
    }
    const name = AUTH_RECIPIENT_LIMITS[path];
    if (name && recipientKey) return await rateLimit(ctx, {
      name: name as DefinedRateLimitName, key: recipientKey, throws: false,
    });
    return { ok: true, retryAt: undefined };
  },
});

/** Atomically reserve one delivery against every budget; failures never refund attempts. */
export const reserveAuthEmail = internalMutation({
  args: { recipientKey: v.string() },
  handler: async (ctx, { recipientKey }) => {
    const budgets = [
      { name: "authEmailRecipient" as const, key: recipientKey },
      { name: "authEmailGlobal" as const },
      { name: "authEmailDaily" as const },
    ];
    let blocked: { budget: string; retryAt: number } | undefined;
    for (const budget of budgets) {
      const result = await checkRateLimit(ctx, { ...budget, throws: false });
      if (!result.ok && (!blocked || result.retryAt! > blocked.retryAt)) {
        blocked = { budget: budget.name, retryAt: result.retryAt ?? Date.now() + 1000 };
      }
    }
    if (blocked) {
      const signal = await rateLimit(ctx, { name: "authEmailAlert", throws: false });
      return { ok: false, ...blocked, alert: signal.ok };
    }
    for (const budget of budgets) await rateLimit(ctx, { ...budget, throws: false });
    return { ok: true, retryAt: undefined, budget: undefined, alert: false };
  },
});
