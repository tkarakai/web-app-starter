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
    if (!pair) throw new Error("NOT_AUTHENTICATED");
    const assurance = await evaluateSession(ctx, pair);
    if (assurance.reason !== "recovery") throw new Error("RECOVERY_REQUIRED");
    const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account", where: [{ field: "userId", value: pair.user._id }, { field: "providerId", value: "credential" }],
    });
    if (account?.password !== args.passwordHash) throw new Error("REAUTHENTICATION_REQUIRED");
    const factor = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "_id", value: args.factorId }] });
    if (factor?.userId !== pair.user._id || factor.secret !== args.factorSecret) throw new Error("RECOVERY_REQUIRED");
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: { model: "session", where: [{ field: "_id", value: pair.session._id }], update: { recoveryFactorId: factor._id } },
    });
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
    if (!pair) throw new Error("NOT_AUTHENTICATED");
    const { user, session } = pair;
    const now = Date.now();
    let update: Partial<typeof session>;
    if (args.kind === "password") {
      const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "account", where: [{ field: "userId", value: user._id }, { field: "providerId", value: "credential" }],
      });
      if (!args.passwordHash || account?.password !== args.passwordHash) throw new Error("REAUTHENTICATION_REQUIRED");
      update = { assuranceVersion: 1, authMethod: "password", primaryVerifiedAt: now, authenticatedAt: session.authenticatedAt ?? session.createdAt };
    } else if (args.kind === "recovery") {
      update = { recoveryOnly: true, recoveryFactorId: "", strongVerifiedAt: 0, strongFactorId: "", strongFactorType: "" };
    } else {
      if (session.assuranceVersion !== 1 || !session.primaryVerifiedAt) throw new Error("REAUTHENTICATION_REQUIRED");
      if (!args.factorId) throw new Error("MFA_REQUIRED");
      if (session.recoveryOnly && (args.kind !== "totp" || session.recoveryFactorId !== args.factorId)) throw new Error("RECOVERY_REQUIRED");
      if (args.kind === "totp") {
        const factor = await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "twoFactor", where: [{ field: "_id", value: args.factorId }],
        });
        if (factor?.userId !== user._id || factor.verified !== true || !user.twoFactorEnabled || !args.factorSecret || factor.secret !== args.factorSecret) throw new Error("MFA_REQUIRED");
      } else {
        const factor = await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "passkey", where: [{ field: "_id", value: args.factorId }],
        });
        if (factor?.userId !== user._id) throw new Error("MFA_REQUIRED");
      }
      update = { strongVerifiedAt: now, strongFactorId: args.factorId, strongFactorType: args.kind, recoveryOnly: false, recoveryFactorId: "" };
    }
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: { model: "session", where: [{ field: "_id", value: session._id }], update },
    });
  },
});
