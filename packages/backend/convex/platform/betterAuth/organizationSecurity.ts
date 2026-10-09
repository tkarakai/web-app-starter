import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import schema from "./schema";
import { assertEffectiveAdministrator } from "./organizationSecurityGuard";
import { sha256Hex } from "../tokenHash";
import { ADMIN_SESSION_MS, RECENT_AUTH_MS } from "../sessionFields";
import { isAppOperatorRole, organizationAdminSecurity } from "./organizationModel";
import { requireIdentityMappingWritable } from "./organizationMigrationBarrier";
import { MEMBERSHIP_MANAGEMENT_EXPERIENCE } from "./organizationVocabulary";

async function verifyPolicyStrengthening(ctx: QueryCtx) {
  // Personal and disabled organizations do not derive eligibility from this
  // policy. Index the exact protected population instead of counting all users.
  const organizations = await ctx.db.query("organization").withIndex("lifecycle_experience", q =>
    q.eq("lifecycle", "active").eq("experience", MEMBERSHIP_MANAGEMENT_EXPERIENCE)).take(1001);
  if (organizations.length > 1000) throw new Error("SECURITY_POLICY_ORGANIZATION_LIMIT");
  for (const org of organizations) await assertEffectiveAdministrator(ctx, org._id);
}

/** Canonical policy and eligibility candidates live in this same transaction. */
export const setPolicy = mutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, { key, value }) => {
    await requireIdentityMappingWritable(ctx);
    if (key !== "adminPasskeyPolicy") throw new Error("INVALID_SECURITY_POLICY");
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* Raw platform policy values are also supported. */ }
    const passkeyPolicy = parsed === "disabled" || parsed === "optional" ? parsed : "required";
    const current = await ctx.db.query("organizationSecurityPolicy").withIndex("key", q => q.eq("key", "admin")).unique();
    if (current?.passkeyPolicy === passkeyPolicy) return;
    if (current) await ctx.db.patch(current._id, { passkeyPolicy });
    else await ctx.db.insert("organizationSecurityPolicy", { key: "admin", passkeyPolicy });
    // A policy transition reads every protected organization and its effective
    // candidates. Concurrent factor/member writes therefore conflict and retry.
    if (passkeyPolicy === "required") await verifyPolicyStrengthening(ctx);
  },
});

export const policy = query({
  args: {},
  handler: async ctx => (await ctx.db.query("organizationSecurityPolicy").withIndex("key", q => q.eq("key", "admin")).unique())?.passkeyPolicy ?? null,
});

export const initializePolicy = mutation({
  args: { value: v.union(v.literal("disabled"), v.literal("optional"), v.literal("required")) },
  handler: async (ctx, { value }) => {
    const existing = await ctx.db.query("organizationSecurityPolicy").withIndex("key", q => q.eq("key", "admin")).unique();
    if (existing) return existing.passkeyPolicy;
    await ctx.db.insert("organizationSecurityPolicy", { key: "admin", passkeyPolicy: value });
    if (value === "required") await verifyPolicyStrengthening(ctx);
    return value;
  },
});

async function requireMigrationBarrier(ctx: QueryCtx, deploymentVersion: string) {
  const barrier = await ctx.db.query("organizationMigrationBarrier").withIndex("key", q => q.eq("key", "organization-v1")).unique();
  if (!barrier?.blocked || barrier.deploymentVersion !== deploymentVersion) throw new Error("ORGANIZATION_MAINTENANCE_REQUIRED");
}

/** Only the sealed migration may initialize policy without an all-org transaction.
 * Its paginated eligibility stage must finish before the root releases the fence. */
export const initializeMigrationPolicy = mutation({
  args: { deploymentVersion: v.string(), value: v.union(v.literal("disabled"), v.literal("optional"), v.literal("required")) },
  handler: async (ctx, args) => {
    await requireMigrationBarrier(ctx, args.deploymentVersion);
    const existing = await ctx.db.query("organizationSecurityPolicy").withIndex("key", q => q.eq("key", "admin")).unique();
    if (!existing) await ctx.db.insert("organizationSecurityPolicy", { key: "admin", passkeyPolicy: args.value });
    return existing?.passkeyPolicy ?? args.value;
  },
});

export const verifyMigrationPolicyPage = query({
  args: { deploymentVersion: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireMigrationBarrier(ctx, args.deploymentVersion);
    if (!await ctx.db.query("organizationSecurityPolicy").withIndex("key", q => q.eq("key", "admin")).unique()) throw new Error("ORGANIZATION_SECURITY_POLICY_MISSING");
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100) throw new Error("ORGANIZATION_INVALID_BATCH_SIZE");
    const page = await paginator(ctx.db, schema).query("organization").paginate(args.paginationOpts);
    for (const org of page.page) {
      try { await assertEffectiveAdministrator(ctx, org._id); }
      catch { throw new Error(`ORGANIZATION_SECURITY_INVALID:${org._id}`); }
    }
    return { cursor: page.continueCursor, done: page.isDone, count: page.page.length };
  },
});

export const hasEnrollment = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => (await ctx.db.query("organizationEnrollments").withIndex("userId", q => q.eq("userId", userId)).collect()).some(row => row.completedAt),
});

/** Native backup-code verification proved exactly one code was consumed. Keep
 * acknowledgment current without allowing arbitrary regeneration to inherit it. */
export const consumeRecoveryCode = mutation({
  args: { userId: v.string(), factorId: v.string(), currentCodes: v.string(), nextCodes: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("twoFactor", args.factorId);
    const factor = id ? await ctx.db.get(id) : null;
    if (!factor || factor.userId !== args.userId || factor.backupCodes !== args.currentCodes) throw new Error("RECOVERY_CODES_CHANGED");
    await ctx.db.patch(factor._id, { backupCodes: args.nextCodes });
    const enrollments = await ctx.db.query("organizationEnrollments").withIndex("userId", q => q.eq("userId", args.userId)).collect();
    for (const enrollment of enrollments) {
      if (enrollment.completedAt && enrollment.backupFactorId === factor._id && enrollment.backupCodesProof === sha256Hex(args.currentCodes)) {
        await ctx.db.patch(enrollment._id, { backupCodesProof: sha256Hex(args.nextCodes) });
      }
      await assertEffectiveAdministrator(ctx, enrollment.organizationId);
    }
  },
});

async function revokeProof(ctx: MutationCtx, userId: string) {
  for (const session of await ctx.db.query("session").withIndex("userId", q => q.eq("userId", userId)).collect()) {
    await ctx.db.patch(session._id, { primaryVerifiedAt: 0, strongVerifiedAt: 0, strongFactorId: "", strongFactorType: "" });
  }
}

/** Trusted auth callback only, after password/change or reset capability validation.
 * The plaintext strength check happens before hashing; the exact old hash binds this commit. */
export const replaceCredential = mutation({
  args: { userId: v.string(), currentHash: v.string(), newHash: v.string(), adminPasswordValidated: v.boolean(), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Read memberships/lifecycle in this write transaction: a concurrent
    // activation cannot turn an ordinary password change into an admin bypass.
    const authority = await organizationAdminSecurity(ctx, args.userId);
    if (authority.required && !args.adminPasswordValidated) throw new Error("PASSWORD_TOO_WEAK");
    if (authority.required && args.sessionId) {
      const proof = await replacementSnapshot(ctx, args.userId, args.sessionId);
      if (proof.session.recoveryOnly) throw new Error("RECOVERY_REQUIRED");
      const policy = await ctx.db.query("organizationSecurityPolicy").withIndex("key", q => q.eq("key", "admin")).unique();
      if (policy?.passkeyPolicy === "required" && proof.session.strongFactorType !== "passkey") throw new Error("PASSKEY_REQUIRED");
    }
    const account = await ctx.db.query("account").withIndex("providerId_userId", q => q.eq("providerId", "credential").eq("userId", args.userId)).unique();
    if (!account?.password || account.password !== args.currentHash || !args.newHash) throw new Error("CREDENTIAL_CHANGED");
    const enrollments = await ctx.db.query("organizationEnrollments").withIndex("userId", q => q.eq("userId", args.userId)).collect();
    await ctx.db.patch(account._id, { password: args.newHash, updatedAt: Date.now() });
    for (const enrollment of enrollments) {
      if (args.adminPasswordValidated && enrollment.completedAt && enrollment.passwordProof === sha256Hex(args.currentHash)) {
        await ctx.db.patch(enrollment._id, { passwordProof: sha256Hex(args.newHash), passwordVerifiedAt: Date.now() });
      }
      await assertEffectiveAdministrator(ctx, enrollment.organizationId);
    }
    await revokeProof(ctx, args.userId);
  },
});

async function replacementSnapshot(ctx: QueryCtx, userId: string, sessionId: string) {
  const sid = ctx.db.normalizeId("session", sessionId);
  const session = sid ? await ctx.db.get(sid) : null;
  const uid = ctx.db.normalizeId("user", userId);
  const user = uid ? await ctx.db.get(uid) : null;
  const now = Date.now();
  if (!user || user.banned || isAppOperatorRole(user.role) || !user.emailVerified || !session
    || session.userId !== userId || session.expiresAt <= now || session.impersonatedBy
    || session.authPurpose === "mcp-authorization" || session.assuranceVersion !== 1
    || !session.primaryVerifiedAt || session.primaryVerifiedAt > now || session.authMethod === "magic-link"
    || (session.authenticatedAt ?? session.createdAt) + ADMIN_SESSION_MS <= now) throw new Error("REAUTHENTICATION_REQUIRED");
  const account = await ctx.db.query("account").withIndex("providerId_userId", q => q.eq("providerId", "credential").eq("userId", userId)).unique();
  const factor = await ctx.db.query("twoFactor").withIndex("userId", q => q.eq("userId", userId)).unique();
  if (!account?.password || !factor?.verified || !user.twoFactorEnabled) throw new Error("MFA_REQUIRED");
  if (session.recoveryOnly && (session.recoverySourceFactorId !== factor._id
    || session.recoverySourceFactorProof !== sha256Hex(factor.secret))) throw new Error("RECOVERY_REQUIRED");
  if (!session.recoveryOnly) {
    const policy = await ctx.db.query("organizationSecurityPolicy").withIndex("key", q => q.eq("key", "admin")).unique();
    // Every stage rechecks live policy in its own transaction. The explicitly
    // factor-bound recovery session is the only replacement exception.
    if (policy?.passkeyPolicy === "required" && session.strongFactorType !== "passkey") throw new Error("PASSKEY_REQUIRED");
    let strong = session.strongFactorType === "totp" && session.strongFactorId === factor._id;
    if (session.strongFactorType === "passkey" && session.strongFactorId) {
      const pid = ctx.db.normalizeId("passkey", session.strongFactorId);
      const passkey = pid ? await ctx.db.get(pid) : null;
      strong = passkey?.userId === userId && policy?.passkeyPolicy !== "disabled";
    }
    if (!strong || !session.strongVerifiedAt || session.strongVerifiedAt > now
      || session.strongVerifiedAt + RECENT_AUTH_MS <= now) throw new Error("RECENT_AUTHENTICATION_REQUIRED");
  }
  return { user, session, account, factor };
}

export const snapshot = query({
  args: { userId: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const { user, account, factor } = await replacementSnapshot(ctx, args.userId, args.sessionId);
    return { email: user.email, passwordHash: account.password!, factorId: factor._id, factorSecretProof: sha256Hex(factor.secret) };
  },
});

export const stageFactor = mutation({
  args: { userId: v.string(), sessionId: v.string(), credentialProof: v.string(), factorSecretProof: v.string(), secret: v.string(), backupCodes: v.string() },
  handler: async (ctx, args) => {
    const { account, factor } = await replacementSnapshot(ctx, args.userId, args.sessionId);
    if (sha256Hex(account.password!) !== args.credentialProof || sha256Hex(factor.secret) !== args.factorSecretProof) throw new Error("SECURITY_STATE_CHANGED");
    const old = await ctx.db.query("organizationSecurityChanges").withIndex("userId", q => q.eq("userId", args.userId)).collect();
    for (const row of old) await ctx.db.delete(row._id);
    return ctx.db.insert("organizationSecurityChanges", { ...args, factorId: factor._id, expiresAt: Date.now() + RECENT_AUTH_MS });
  },
});

export const stagedFactor = query({
  args: { userId: v.string(), sessionId: v.string(), changeId: v.id("organizationSecurityChanges") },
  handler: async (ctx, args) => {
    const { account, factor } = await replacementSnapshot(ctx, args.userId, args.sessionId);
    const change = await ctx.db.get(args.changeId);
    if (!change || change.userId !== args.userId || change.sessionId !== args.sessionId || change.expiresAt <= Date.now()
      || change.credentialProof !== sha256Hex(account.password!) || change.factorId !== factor._id
      || change.factorSecretProof !== sha256Hex(factor.secret)) throw new Error("SECURITY_STATE_CHANGED");
    return change;
  },
});

/** Parent verified new TOTP plus two distinct new backup codes against this exact stage. */
export const replaceFactor = mutation({
  args: { userId: v.string(), sessionId: v.string(), changeId: v.id("organizationSecurityChanges"), replacementProof: v.string() },
  handler: async (ctx, args) => {
    const { account, factor, session } = await replacementSnapshot(ctx, args.userId, args.sessionId);
    const change = await ctx.db.get(args.changeId);
    if (!change || change.userId !== args.userId || change.sessionId !== args.sessionId || change.expiresAt <= Date.now()
      || change.credentialProof !== sha256Hex(account.password!) || change.factorId !== factor._id
      || change.factorSecretProof !== sha256Hex(factor.secret)
      || sha256Hex(JSON.stringify([change.secret, change.backupCodes])) !== args.replacementProof) throw new Error("SECURITY_STATE_CHANGED");
    // Preserve the canonical factor ID; there is no interval with an unverified/deleted factor.
    await ctx.db.patch(factor._id, { secret: change.secret, backupCodes: change.backupCodes, verified: true });
    const enrollments = await ctx.db.query("organizationEnrollments").withIndex("userId", q => q.eq("userId", args.userId)).collect();
    for (const enrollment of enrollments) {
      if (enrollment.completedAt && enrollment.backupFactorId === factor._id
        && enrollment.factorSecretProof === change.factorSecretProof) {
        await ctx.db.patch(enrollment._id, { factorSecretProof: sha256Hex(change.secret),
          backupCodesProof: sha256Hex(change.backupCodes), backupAcknowledgedAt: Date.now() });
      }
      await assertEffectiveAdministrator(ctx, enrollment.organizationId);
    }
    await revokeProof(ctx, args.userId);
    await ctx.db.patch(session._id, { primaryVerifiedAt: Date.now(), strongVerifiedAt: Date.now(),
      strongFactorId: factor._id, strongFactorType: "totp", recoveryOnly: false, recoveryFactorId: "" });
    await ctx.db.delete(change._id);
  },
});
