import type { GenericCtx } from "@convex-dev/better-auth";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import type { Doc } from "./betterAuth/_generated/dataModel";
import {
  getPolicyScopeFromRole, getEmailVerificationRequiredKey, getMfaRequiredKey,
  getPasskeyPolicyKey, LEGACY_EMAIL_VERIFICATION_REQUIRED_KEY, LEGACY_MFA_REQUIRED_KEY,
  USER_MAGIC_LINK_ENABLED_KEY, type PasskeyPolicy,
} from "./securityPolicies";
import { ADMIN_SESSION_MS, RECENT_AUTH_MS } from "./sessionFields";

type Reader = Pick<GenericCtx<DataModel>, "runQuery">;
export type AuthSession = { user: Doc<"user">; session: Doc<"session"> };
export type SessionProof = Pick<Doc<"session">, "createdAt" | "expiresAt" | "assuranceVersion" | "authMethod" | "authenticatedAt" | "primaryVerifiedAt" | "strongVerifiedAt" | "strongFactorId" | "strongFactorType" | "recoveryOnly">;
export type AssuranceSubject = { user: Doc<"user">; session: SessionProof };

async function setting(ctx: Reader, key: string): Promise<unknown> {
  const row = await ctx.runQuery(components.platform.appSettings.getRaw, { key });
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

async function booleanPolicy(ctx: Reader, key: string, fallback: string | null, defaultValue: boolean): Promise<boolean> {
  let value = await setting(ctx, key);
  if (value === undefined && fallback) value = await setting(ctx, fallback);
  if (value === undefined) return defaultValue;
  // Invalid requirement values fail closed.
  return value !== false;
}

export async function emailLoginEnabled(ctx: Reader): Promise<boolean> {
  return await setting(ctx, USER_MAGIC_LINK_ENABLED_KEY) === true;
}

export async function readPolicies(ctx: Reader, user: Doc<"user">) {
  const bound = await ctx.runQuery(components.platform.adminInvitations.boundOnboarding, {
    email: user.email, userId: user._id,
  });
  const roleScope = getPolicyScopeFromRole(user.role);
  const onboarding = bound ?? (roleScope === "admin"
    ? await ctx.runQuery(components.platform.adminInvitations.getMyOnboardingStatus, { email: user.email })
    : null);
  const enrollment = Boolean(onboarding && !onboarding.completed);
  const scope = enrollment ? "admin" : roleScope;
  const rawPasskey = await setting(ctx, getPasskeyPolicyKey(scope));
  const passkeyPolicy: PasskeyPolicy = rawPasskey === undefined ? "optional"
    : rawPasskey === "disabled" || rawPasskey === "optional" ? rawPasskey : "required";
  return {
    scope, enrollment, passkeyPolicy,
    emailRequired: await booleanPolicy(ctx, getEmailVerificationRequiredKey(scope), LEGACY_EMAIL_VERIFICATION_REQUIRED_KEY, true),
    mfaRequired: enrollment || await booleanPolicy(ctx, getMfaRequiredKey(scope), LEGACY_MFA_REQUIRED_KEY, false),
  };
}

/** Read the live session and bind it to the exact user, never just the JWT subject. */
export async function readSession(ctx: Reader, userId: string, sessionId: string): Promise<AuthSession | null> {
  const session = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "session", where: [{ field: "_id", value: sessionId }],
  }) as Doc<"session"> | null;
  if (!session || session.userId !== userId || session.expiresAt <= Date.now()) return null;
  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user", where: [{ field: "_id", value: userId }],
  }) as Doc<"user"> | null;
  if (!user || user.banned || session.impersonatedBy) return null;
  const authenticatedAt = session.authenticatedAt ?? session.createdAt;
  if (!Number.isFinite(authenticatedAt) || authenticatedAt > Date.now()) return null;
  if (authenticatedAt + ADMIN_SESSION_MS <= Date.now()) {
    if (getPolicyScopeFromRole(user.role) === "admin") return null;
    const bound = await ctx.runQuery(components.platform.adminInvitations.boundOnboarding, { email: user.email, userId: user._id });
    if (bound && !bound.completed) return null;
  }
  return { user, session };
}

export async function identitySession(ctx: GenericCtx<DataModel>): Promise<AuthSession | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || typeof identity.sessionId !== "string") return null;
  return await readSession(ctx, identity.subject, identity.sessionId);
}

export type AssuranceReason = "ready" | "reauthenticate" | "email_verification" | "enrollment"
  | "method_disabled" | "recovery" | "mfa_enrollment" | "mfa_verification" | "passkey_enrollment" | "passkey_verification";

/** Shared by Convex and Better Auth. Account flags are requirements, never session proof. */
export async function evaluateSession(ctx: Reader, pair: AssuranceSubject) {
  const { user, session } = pair;
  const policy = await readPolicies(ctx, user);
  const factor = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "twoFactor", where: [{ field: "userId", value: user._id }],
  });
  const passkey = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "passkey", where: [{ field: "userId", value: user._id }],
  });
  const hasTotp = user.twoFactorEnabled === true && factor?.verified === true;
  const hasPasskey = Boolean(passkey);
  let strong = false;
  const now = Date.now();
  if (session.assuranceVersion === 1 && session.strongVerifiedAt && session.strongVerifiedAt <= now) {
    if (session.strongFactorType === "totp") {
      strong = hasTotp && factor?._id === session.strongFactorId;
    } else if (session.strongFactorType === "passkey" && policy.passkeyPolicy !== "disabled" && session.strongFactorId) {
      const used = await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "passkey", where: [{ field: "_id", value: session.strongFactorId }],
      });
      strong = used?.userId === user._id;
    }
  }
  const mfaNeeded = policy.mfaRequired || user.twoFactorEnabled === true;
  const strongForChanges = mfaNeeded || (hasPasskey && policy.passkeyPolicy !== "disabled");
  const primary = session.assuranceVersion === 1 && Boolean(session.primaryVerifiedAt && session.primaryVerifiedAt <= now)
    && ["password", "magic-link", "passkey"].includes(session.authMethod ?? "");
  let reason: AssuranceReason = "ready";
  if (!primary) reason = "reauthenticate";
  else if (session.authMethod === "magic-link" && (policy.scope === "admin" || !await emailLoginEnabled(ctx))) reason = "method_disabled";
  else if (session.authMethod === "passkey" && !strong) reason = "reauthenticate";
  else if (policy.emailRequired && !user.emailVerified) reason = "email_verification";
  else if (session.recoveryOnly) reason = "recovery";
  else if (policy.enrollment) reason = "enrollment";
  else if (mfaNeeded && !strong) reason = hasTotp || (hasPasskey && policy.passkeyPolicy !== "disabled") ? "mfa_verification" : "mfa_enrollment";
  else if (policy.passkeyPolicy === "required") {
    if (!hasPasskey) reason = "passkey_enrollment";
    else if (!strong || session.strongFactorType !== "passkey") reason = "passkey_verification";
  }
  const recentUntil = (strongForChanges ? strong ? session.strongVerifiedAt ?? 0 : 0 : primary ? session.primaryVerifiedAt ?? 0 : 0) + RECENT_AUTH_MS;
  return {
    ...policy, hasTotp, hasPasskey, strong, strongForChanges, reason,
    primaryRecentUntil: (session.primaryVerifiedAt ?? 0) + RECENT_AUTH_MS,
    allowed: reason === "ready", recent: recentUntil > now, recentUntil,
    expiresAt: Math.min(session.expiresAt, policy.scope === "admin" ? (session.authenticatedAt ?? session.createdAt) + ADMIN_SESSION_MS : session.expiresAt),
  };
}

export async function authorizedSession(ctx: GenericCtx<DataModel>, recent = false, forAgentAuthorization = false) {
  const pair = await identitySession(ctx);
  if (!pair) return null;
  if (!forAgentAuthorization && pair.session.authPurpose === "mcp-authorization") return null;
  const assurance = await evaluateSession(ctx, pair);
  if (!assurance.allowed || (recent && !assurance.recent)) return null;
  return { ...pair, assurance, ownerId: (pair.user.userId ?? pair.user._id).toString() };
}
