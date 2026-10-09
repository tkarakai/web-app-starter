import { verifyPassword } from "better-auth/crypto";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "../_generated/server";
import { authorizedSession, evaluateOrganizationEnrollment, identitySession, readSession } from "./sessionPolicy";
import { decodeBackupCodes } from "./recoveryCodes";
import { sha256Hex } from "./tokenHash";
import { validatePasswordStrength } from "./passwordStrength";

const contextArgs = { organizationId: v.string() };
const boundArgs = { ...contextArgs, userId: v.string(), sessionId: v.string() };

/** Setup only. No organization membership enablement/completion or member-management API is exposed before cutover. */
export const begin = mutation({
  args: { ...contextArgs, name: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    const pair = await authorizedSession(ctx, true);
    if (!pair) throw new Error("NOT_AUTHENTICATED");
    if (pair.assurance.scope !== "user") throw new Error("NOT_CUSTOMER");
    return ctx.runMutation(components.betterAuth.organizations.beginMembershipManagement, { ...args, userId: pair.user._id });
  },
});

/** Self-service setup projection. Current membership and active organization are always required. */
export const status = query({
  args: contextArgs,
  handler: async (ctx, { organizationId }) => {
    const pair = await identitySession(ctx);
    if (!pair || pair.session.authPurpose === "mcp-authorization") throw new Error("NOT_AUTHENTICATED");
    return evaluateOrganizationEnrollment(ctx, pair, organizationId);
  },
});

async function enrollmentSnapshot(ctx: QueryCtx, args: { organizationId: string; userId: string; sessionId: string }, recovery: boolean) {
  const pair = await readSession(ctx, args.userId, args.sessionId);
  if (!pair || pair.session.authPurpose === "mcp-authorization") throw new Error("NOT_AUTHENTICATED");
  const assurance = await evaluateOrganizationEnrollment(ctx, pair, args.organizationId);
  if (["reauthenticate", "email_verification", "method_disabled", "recovery"].includes(assurance.reason)) throw new Error("REAUTHENTICATION_REQUIRED");
  const strongNeeded = recovery || assurance.hasTotp || (assurance.hasPasskey && assurance.passkeyPolicy !== "disabled");
  if (strongNeeded ? !assurance.strong || !assurance.recent : assurance.primaryRecentUntil <= Date.now()) throw new Error("RECENT_AUTHENTICATION_REQUIRED");
  if (recovery && !assurance.hasTotp) throw new Error("MFA_REQUIRED");
  const account = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "userId", value: pair.user._id }, { field: "providerId", value: "credential" }] });
  if (!account?.password) throw new Error("REAUTHENTICATION_REQUIRED");
  const factor = recovery ? await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "userId", value: pair.user._id }] }) : null;
  return { email: pair.user.email, passwordHash: account.password, factorId: factor?._id ?? null, backupCodes: factor?.backupCodes ?? null };
}

/** Internal snapshots only: encrypted material and credential hashes never cross the client boundary. */
export const snapshot = internalQuery({
  args: { ...boundArgs, recovery: v.boolean() },
  handler: (ctx, args) => enrollmentSnapshot(ctx, args, args.recovery),
});

export const verifyCredential = action({
  args: { ...contextArgs, password: v.string() },
  handler: async (ctx, { organizationId, password }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || typeof identity.sessionId !== "string") throw new Error("NOT_AUTHENTICATED");
    const bound = { organizationId, userId: identity.subject, sessionId: identity.sessionId };
    const before = await ctx.runQuery(internal.platform.organizationEnrollment.snapshot, { ...bound, recovery: false });
    const limit = await ctx.runMutation(internal.platform.rateLimits.consumeAuthRateLimit, { name: "authStepUp", key: identity.subject });
    if (!limit.ok) throw new Error("RATE_LIMITED");
    if (password.length > 128 || !validatePasswordStrength(password, before.email, "admin").valid
      || !await verifyPassword({ password, hash: before.passwordHash })) throw new Error("REAUTHENTICATION_REQUIRED");
    await ctx.runMutation(internal.platform.organizationEnrollment.recordCredential, { ...bound, credentialProof: sha256Hex(before.passwordHash) });
  },
});

/** Rechecks session, policy, membership and exact credential atomically with recording. */
export const recordCredential = internalMutation({
  args: { ...boundArgs, credentialProof: v.string() },
  handler: async (ctx, args) => {
    const current = await enrollmentSnapshot(ctx, args, false);
    if (sha256Hex(current.passwordHash) !== args.credentialProof) throw new Error("CREDENTIAL_CHANGED");
    await ctx.runMutation(components.betterAuth.organizations.recordPasswordProof, { organizationId: args.organizationId, userId: args.userId, credentialProof: args.credentialProof });
  },
});

export const acknowledgeRecovery = action({
  args: { ...contextArgs, password: v.string(), codes: v.array(v.string()) },
  handler: async (ctx, { organizationId, password, codes }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || typeof identity.sessionId !== "string") throw new Error("NOT_AUTHENTICATED");
    const bound = { organizationId, userId: identity.subject, sessionId: identity.sessionId };
    const before = await ctx.runQuery(internal.platform.organizationEnrollment.snapshot, { ...bound, recovery: true });
    const limit = await ctx.runMutation(internal.platform.rateLimits.consumeAuthRateLimit, { name: "authRecoverySecrets", key: identity.subject });
    if (!limit.ok) throw new Error("RATE_LIMITED");
    if (!password || password.length > 128 || !await verifyPassword({ password, hash: before.passwordHash })) throw new Error("REAUTHENTICATION_REQUIRED");
    if (!before.factorId || !before.backupCodes) throw new Error("MFA_REQUIRED");
    const currentCodes = await decodeBackupCodes(before.backupCodes);
    if (codes.length !== 2 || new Set(codes).size !== 2 || !codes.every(code => currentCodes.includes(code))) throw new Error("INVALID_RECOVERY_CODES");
    await ctx.runMutation(internal.platform.organizationEnrollment.recordRecovery, { ...bound,
      credentialProof: sha256Hex(before.passwordHash), factorId: before.factorId, backupCodesProof: sha256Hex(before.backupCodes) });
  },
});

/** The parent's proof fingerprints the validated encrypted set, never a later snapshot. */
export const recordRecovery = internalMutation({
  args: { ...boundArgs, credentialProof: v.string(), factorId: v.string(), backupCodesProof: v.string() },
  handler: async (ctx, args) => {
    const current = await enrollmentSnapshot(ctx, args, true);
    if (sha256Hex(current.passwordHash) !== args.credentialProof) throw new Error("CREDENTIAL_CHANGED");
    if (current.factorId !== args.factorId || !current.backupCodes
      || sha256Hex(current.backupCodes) !== args.backupCodesProof) throw new Error("RECOVERY_CODES_CHANGED");
    await ctx.runMutation(components.betterAuth.organizations.acknowledgeRecovery, { organizationId: args.organizationId,
      userId: args.userId, factorId: args.factorId, backupCodesProof: args.backupCodesProof });
  },
});
