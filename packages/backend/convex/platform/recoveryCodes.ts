import { symmetricDecrypt, verifyPassword } from "better-auth/crypto";
import { v } from "convex/values";

import { components, internal } from "../_generated/api";
import { internalQuery, type ActionCtx } from "../_generated/server";

// One query snapshot binds the credential and recovery material to a live session.
// Internal only: clients never receive the password hash or encrypted factor row.
export const snapshot = internalQuery({
  args: { userId: v.string(), sessionId: v.string() },
  handler: async (ctx, { userId, sessionId }) => {
    const session = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "session", where: [{ field: "_id", value: sessionId }],
    });
    if (!session || session.userId !== userId || session.expiresAt <= Date.now()) {
      throw new Error("NOT_AUTHENTICATED");
    }
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user", where: [{ field: "_id", value: userId }],
    });
    if (!user || user.banned) throw new Error("NOT_AUTHENTICATED");
    const credential = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account", where: [
        { field: "userId", value: userId }, { field: "providerId", value: "credential" },
      ],
    });
    if (!credential?.password) throw new Error("REAUTHENTICATION_REQUIRED");
    const factor = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "twoFactor", where: [{ field: "userId", value: userId }],
    });
    return { passwordHash: credential.password, backupCodes: factor?.backupCodes ?? null };
  },
});

/** Shared by Convex and HTTP. Proof is supplied per operation, never cached in the browser. */
export async function readBackupCodes(
  ctx: ActionCtx, userId: string, sessionId: string, password?: string,
): Promise<string[]> {
  const before = await ctx.runQuery(internal.platform.recoveryCodes.snapshot, { userId, sessionId });
  if (!password || password.length > 128) throw new Error("REAUTHENTICATION_REQUIRED");
  // Separate committed mutation: rejected password attempts must still consume their budget.
  const limit = await ctx.runMutation(internal.platform.rateLimits.consumeAuthRateLimit, {
    name: "authRecoverySecrets", key: userId,
  });
  if (!limit.ok) throw new Error("RATE_LIMITED");
  if (!await verifyPassword({ password, hash: before.passwordHash })) {
    throw new Error("REAUTHENTICATION_REQUIRED");
  }
  // Password reset/revocation racing the expensive password check must invalidate disclosure.
  const after = await ctx.runQuery(internal.platform.recoveryCodes.snapshot, { userId, sessionId });
  if (before.passwordHash !== after.passwordHash) throw new Error("REAUTHENTICATION_REQUIRED");
  if (!after.backupCodes) return [];
  let codes: unknown;
  try {
    codes = JSON.parse(after.backupCodes);
  } catch {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error("BETTER_AUTH_SECRET not configured");
    codes = JSON.parse(await symmetricDecrypt({ key: secret, data: after.backupCodes }));
  }
  if (!Array.isArray(codes) || !codes.every((code): code is string => typeof code === "string")) {
    throw new Error("INVALID_RECOVERY_CODES");
  }
  return codes;
}
