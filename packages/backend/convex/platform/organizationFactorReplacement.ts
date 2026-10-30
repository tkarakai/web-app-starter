import { generateRandomString, symmetricDecrypt, symmetricEncrypt, verifyPassword } from "better-auth/crypto";
import { appConfig } from "@web-app-starter/app-config";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { components, internal } from "../_generated/api";
import type { Id } from "./betterAuth/_generated/dataModel";
import { organizationTotpUri, verifyOrganizationTotp } from "./organizationTotp";
import { decodeBackupCodes } from "./recoveryCodes";
import { sha256Hex } from "./tokenHash";

/** Identity security self-service. Never register these secret-bearing actions as agent tools. */
export const begin = action({
  args: { password: v.string() },
  handler: async (ctx, { password }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || typeof identity.sessionId !== "string") throw new Error("NOT_AUTHENTICATED");
    const bound = { userId: identity.subject, sessionId: identity.sessionId };
    const before = await ctx.runQuery(components.betterAuth.organizationSecurity.snapshot, bound);
    const limit = await ctx.runMutation(internal.platform.rateLimits.consumeAuthRateLimit, { name: "authStepUp", key: identity.subject });
    if (!limit.ok) throw new Error("RATE_LIMITED");
    if (!password || password.length > 128 || !await verifyPassword({ password, hash: before.passwordHash })) throw new Error("REAUTHENTICATION_REQUIRED");
    const key = process.env.BETTER_AUTH_SECRET;
    if (!key) throw new Error("AUTH_CONFIGURATION_REQUIRED");
    const secret = generateRandomString(32);
    const codes = Array.from({ length: 10 }, () => generateRandomString(10, "a-z", "0-9", "A-Z"))
      .map(code => `${code.slice(0, 5)}-${code.slice(5)}`);
    const encryptedSecret = await symmetricEncrypt({ key, data: secret });
    const backupCodes = await symmetricEncrypt({ key, data: JSON.stringify(codes) });
    const changeId = await ctx.runMutation(components.betterAuth.organizationSecurity.stageFactor, {
      ...bound, credentialProof: sha256Hex(before.passwordHash), factorSecretProof: before.factorSecretProof,
      secret: encryptedSecret, backupCodes,
    });
    return { changeId, totpURI: organizationTotpUri(secret, appConfig.identity.productName, before.email), backupCodes: codes };
  },
});

export const complete = action({
  args: { changeId: v.string(), code: v.string(), backupCodes: v.array(v.string()) },
  handler: async (ctx, { changeId, code, backupCodes }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || typeof identity.sessionId !== "string") throw new Error("NOT_AUTHENTICATED");
    const bound = { userId: identity.subject, sessionId: identity.sessionId, changeId: changeId as Id<"organizationSecurityChanges"> };
    const before = await ctx.runQuery(components.betterAuth.organizationSecurity.stagedFactor, bound);
    const limit = await ctx.runMutation(internal.platform.rateLimits.consumeAuthRateLimit, { name: "authStepUp", key: identity.subject });
    if (!limit.ok) throw new Error("RATE_LIMITED");
    const key = process.env.BETTER_AUTH_SECRET;
    if (!key) throw new Error("AUTH_CONFIGURATION_REQUIRED");
    const secret = await symmetricDecrypt({ key, data: before.secret });
    if (!await verifyOrganizationTotp(secret, code)) throw new Error("INVALID_TOTP");
    const codes = await decodeBackupCodes(before.backupCodes);
    if (backupCodes.length !== 2 || new Set(backupCodes).size !== 2 || !backupCodes.every(value => codes.includes(value))) throw new Error("INVALID_RECOVERY_CODES");
    await ctx.runMutation(components.betterAuth.organizationSecurity.replaceFactor, {
      ...bound, replacementProof: sha256Hex(JSON.stringify([before.secret, before.backupCodes])),
    });
  },
});
