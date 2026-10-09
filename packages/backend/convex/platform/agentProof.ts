/** Immutable server-captured proof for a delegation, never a browser login or client-supplied identity. */
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { evaluateSession, type AuthSession } from "./sessionPolicy";
import { AGENT_CONTRACT_EPOCH, currentAgentContract } from "./agentContract";
import { isOperatorIdentity } from "./operatorIdentity";

const optionalNumber = v.optional(v.union(v.number(), v.null()));
const optionalString = v.optional(v.union(v.string(), v.null()));
export const delegationProof = v.object({
  createdAt: v.number(), expiresAt: v.number(), assuranceVersion: optionalNumber, authMethod: optionalString,
  authenticatedAt: optionalNumber, primaryVerifiedAt: optionalNumber, strongVerifiedAt: optionalNumber,
  strongFactorId: optionalString, strongFactorType: optionalString, recoveryOnly: v.optional(v.union(v.boolean(), v.null())),
});
export async function credentialFingerprint(ctx: Pick<QueryCtx, "runQuery">, userId: string, proof: Pick<AuthSession["session"], "strongFactorId" | "strongFactorType">) {
  const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "account", where: [{ field: "userId", value: userId }, { field: "providerId", value: "credential" }],
  });
  let factorCredential = "";
  if (proof.strongFactorId && proof.strongFactorType === "totp") {
    const factor = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "_id", value: proof.strongFactorId }] });
    factorCredential = factor?.secret ?? "missing-factor";
  } else if (proof.strongFactorId && proof.strongFactorType === "passkey") {
    const factor = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "passkey", where: [{ field: "_id", value: proof.strongFactorId }] });
    factorCredential = factor?.publicKey ?? "missing-factor";
  }
  const bytes = await crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(JSON.stringify([account?.password ?? "", factorCredential])));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function captureDelegation(ctx: MutationCtx, pair: AuthSession) {
  const assurance = await evaluateSession(ctx, pair);
  if (!await isOperatorIdentity(ctx, pair.user) || !assurance.allowed || !assurance.recent) throw new Error("NOT_ADMIN");
  const expiresAt = Math.min(Date.now() + 16 * 60_000, assurance.expiresAt);
  const { createdAt, assuranceVersion, authMethod, authenticatedAt, primaryVerifiedAt, strongVerifiedAt,
    strongFactorId, strongFactorType, recoveryOnly } = pair.session;
  const proof = { createdAt, expiresAt, assuranceVersion, authMethod, authenticatedAt, primaryVerifiedAt,
    strongVerifiedAt: assurance.strong ? strongVerifiedAt : undefined,
    strongFactorId: assurance.strong ? strongFactorId : undefined,
    strongFactorType: assurance.strong ? strongFactorType : undefined, recoveryOnly };
  const id = await ctx.db.insert("agentDelegations", { contractEpoch: AGENT_CONTRACT_EPOCH, userId: pair.user._id, expiresAt,
    credentialFingerprint: await credentialFingerprint(ctx, pair.user._id, proof),
    proof,
  });
  await ctx.scheduler.runAfter(Math.max(0, expiresAt - Date.now()), internal.platform.agentAccess.expireDelegation, { delegationId: id });
  return id;
}
export async function readDelegation(ctx: QueryCtx, id: Id<"agentDelegations"> | undefined, userId: string) {
  if (!id) return null;
  const delegation = await ctx.db.get(id);
  if (!delegation || !currentAgentContract(delegation) || delegation.userId !== userId || delegation.expiresAt <= Date.now()) return null;
  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: userId }] }) as Doc<"user"> | null;
  if (!user || !await isOperatorIdentity(ctx, user) || user.banned || delegation.credentialFingerprint !== await credentialFingerprint(ctx, userId, delegation.proof)) return null;
  return { user, session: delegation.proof };
}
export async function deleteAuthorizationSession(ctx: MutationCtx, sessionId: string) {
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: "session", where: [{ field: "_id", value: sessionId }] } });
}
