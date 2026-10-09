/** Shared direct/native app-operator boundary. Security scope and reserved email are not identity authority. */
import { isAppOperatorIdentity } from "./appOperatorIdentity";
export { isAppOperatorIdentity, appOperatorIdentity, requireAppOperatorTarget } from "./appOperatorIdentity";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { readDelegation } from "./agentProof";
import { currentAgentContract } from "./agentContract";
import { evaluateSession, identitySession, readSession, type SessionProof } from "./sessionPolicy";

type AppOperatorCtx = QueryCtx & {
  user?: Doc<"user">;
  session?: SessionProof & Partial<Doc<"session">>;
  grantId?: Id<"agentGrants">;
};

/** Re-resolve browser sessions or captured delegation proof inside the executing transaction. */
export async function requireAppOperator(ctx: AppOperatorCtx, options: { write?: boolean } = {}) {
  let pair;
  if (ctx.user || ctx.session || ctx.grantId) {
    if (!ctx.user || !ctx.session) throw new Error("NOT_AUTHENTICATED");
    if (ctx.grantId) {
      const grant = await ctx.db.get(ctx.grantId);
      if (!grant || !currentAgentContract(grant) || grant.userId !== ctx.user._id || grant.revokedAt || grant.expiresAt <= Date.now()) {
        throw new Error("NOT_AUTHENTICATED");
      }
      pair = await readDelegation(ctx, grant.delegationId, grant.userId);
    } else if (ctx.session._id) {
      pair = await readSession(ctx, ctx.user._id, ctx.session._id);
      if (pair?.session.authPurpose === "mcp-authorization") throw new Error("NOT_AUTHENTICATED");
    } else {
      // Only a stored delegation or live browser session can supply native proof.
      throw new Error("NOT_AUTHENTICATED");
    }
  } else {
    pair = await identitySession(ctx);
    if (pair?.session.authPurpose === "mcp-authorization") throw new Error("NOT_AUTHENTICATED");
  }
  if (!pair) throw new Error("NOT_AUTHENTICATED");
  if (!await isAppOperatorIdentity(ctx, pair.user)) throw new Error("NOT_ADMIN");
  const assurance = await evaluateSession(ctx, pair);
  if (!assurance.allowed) throw new Error("NOT_AUTHENTICATED");
  if (options.write && !assurance.recent) throw new Error("RECENT_AUTHENTICATION_REQUIRED");
  return { ...pair, assurance, ownerId: (pair.user.userId ?? pair.user._id).toString() };
}
