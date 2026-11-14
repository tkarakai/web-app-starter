import { refuse } from "@web-app-starter/convex-platform/errors";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalMutation, query } from "../_generated/server";
import { evaluateSession, identitySession, readSession } from "./sessionPolicy";

/** Self-service status only. It grants no access to application or administrator data. */
export const status = query({
  args: {},
  handler: async ctx => {
    const pair = await identitySession(ctx);
    return pair ? { ...await evaluateSession(ctx, pair), authPurpose: pair.session.authPurpose ?? "application" } : null;
  },
});

export const bindRecoveryReplacement = internalMutation({
  args: { userId: v.string(), sessionId: v.string(), factorId: v.string(), factorSecret: v.string(), passwordHash: v.string() },
  handler: async (ctx, args) => {
    const pair = await readSession(ctx, args.userId, args.sessionId);
    if (!pair) refuse("NOT_AUTHENTICATED");
    const assurance = await evaluateSession(ctx, pair);
    if (assurance.reason !== "recovery") refuse("RECOVERY_REQUIRED");
    const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account", where: [{ field: "userId", value: pair.user._id }, { field: "providerId", value: "credential" }],
    });
    if (account?.password !== args.passwordHash) refuse("REAUTHENTICATION_REQUIRED");
    const factor = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "_id", value: args.factorId }] });
    if (factor?.userId !== pair.user._id || factor.secret !== args.factorSecret) refuse("RECOVERY_REQUIRED");
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: { model: "session", where: [{ field: "_id", value: pair.session._id }], update: { recoveryFactorId: factor._id } },
    });
  },
});

/**
 * Removes the TOTP factor an admitted `/two-factor/enable` is about to replace, after the hook has
 * checked the current password (authAssurance.ts). Only the factor the hook read: a factor that
 * changed since is left for the endpoint to refuse.
 */
export const releaseReplacedFactor = internalMutation({
  args: { userId: v.string(), factorId: v.string(), factorSecret: v.string() },
  handler: async (ctx, args) => {
    const factor = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "_id", value: args.factorId }] });
    if (factor?.userId !== args.userId || factor.secret !== args.factorSecret) return;
    await ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: "twoFactor", where: [{ field: "_id", value: factor._id }] } });
  },
});

/** Successful authentication hooks call this after proof verification, never browsers. */
export const recordProof = internalMutation({
  args: {
    userId: v.string(), sessionId: v.string(),
    kind: v.union(v.literal("password"), v.literal("totp"), v.literal("passkey"), v.literal("recovery")),
    factorId: v.optional(v.string()), factorSecret: v.optional(v.string()), passwordHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const pair = await readSession(ctx, args.userId, args.sessionId);
    if (!pair) refuse("NOT_AUTHENTICATED");
    const { user, session } = pair;
    const now = Date.now();
    let update: Partial<typeof session>;
    if (args.kind === "password") {
      const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "account", where: [{ field: "userId", value: user._id }, { field: "providerId", value: "credential" }],
      });
      if (!args.passwordHash || account?.password !== args.passwordHash) refuse("REAUTHENTICATION_REQUIRED");
      update = { assuranceVersion: 1, authMethod: "password", primaryVerifiedAt: now, authenticatedAt: session.authenticatedAt ?? session.createdAt };
    } else if (args.kind === "recovery") {
      update = { recoveryOnly: true, recoveryFactorId: "", strongVerifiedAt: 0, strongFactorId: "", strongFactorType: "" };
    } else {
      if (session.assuranceVersion !== 1 || !session.primaryVerifiedAt) refuse("REAUTHENTICATION_REQUIRED");
      if (!args.factorId) refuse("MFA_REQUIRED");
      if (session.recoveryOnly && (args.kind !== "totp" || session.recoveryFactorId !== args.factorId)) refuse("RECOVERY_REQUIRED");
      if (args.kind === "totp") {
        const factor = await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "twoFactor", where: [{ field: "_id", value: args.factorId }],
        });
        if (factor?.userId !== user._id || factor.verified !== true || !user.twoFactorEnabled || !args.factorSecret || factor.secret !== args.factorSecret) refuse("MFA_REQUIRED");
      } else {
        const factor = await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "passkey", where: [{ field: "_id", value: args.factorId }],
        });
        if (factor?.userId !== user._id) refuse("MFA_REQUIRED");
      }
      update = { strongVerifiedAt: now, strongFactorId: args.factorId, strongFactorType: args.kind, recoveryOnly: false, recoveryFactorId: "" };
    }
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: { model: "session", where: [{ field: "_id", value: session._id }], update },
    });
  },
});
