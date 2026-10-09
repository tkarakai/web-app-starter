import { LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS } from "./appOperatorAuditCompatibility";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { rememberNative } from "./nativeCapabilities";
/** One-use browser authorization and scoped delegations. Raw credentials are never stored. */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { query, mutation, internalMutation, type QueryCtx } from "../_generated/server";
import { customMutation, customCtx } from "convex-helpers/server/customFunctions";
import { appOperatorMutation } from "./functions";
import { authorizedSession, evaluateSession } from "./sessionPolicy";
import { components } from "../_generated/api";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { captureDelegation, readDelegation, deleteAuthorizationSession } from "./agentProof";
import { surfaceConfiguration, surfaceForResource } from "./agentSurfaces";
import { rateLimit } from "./rateLimits";
import { AGENT_CONTRACT_EPOCH, currentAgentContract } from "./agentContract";
import { isAppOperatorIdentity, requireAppOperator } from "./appOperatorAccess";

export const AGENT_CLIENT_ID = "pi-announcements";
/** Deprecated scope wire identifier for app-operator grants; preserve consent/exchange compatibility. */
export const AGENT_SCOPE = "admin:manage";

export async function credentialHash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(value))))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function secret(): string { return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""); }
function resourceEnabled(resource: string): boolean {
  return surfaceForResource(resource) !== null;
}
export function validRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && Boolean(url.port)
      && url.pathname === "/callback" && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

const consentMutation = customMutation(mutation, customCtx(async ctx => {
  const auth = await authorizedSession(ctx, false, true);
  if (!auth) throw new Error("NOT_AUTHENTICATED");
  if (!auth.assurance.recent) throw new Error("RECENT_AUTHENTICATION_REQUIRED");
  if (!await isAppOperatorIdentity(ctx, auth.user)) throw new Error("NOT_ADMIN");
  if (auth.session.authPurpose !== "mcp-authorization" || !process.env.AGENT_MCP_AUTH_ORIGIN) throw new Error("MCP_AUTHORIZATION_ONLY");
  await rateLimit(ctx, { name: "mutationGlobal", key: auth.ownerId, throws: true });
  return auth;
}));
export const authorize = consentMutation({
  args: { clientId: v.string(), redirectUri: v.string(), resource: v.string(), challenge: v.string(), scope: v.string() },
  handler: async (ctx, args) => {
    if (args.clientId !== AGENT_CLIENT_ID || args.scope !== AGENT_SCOPE || !resourceEnabled(args.resource)
      || !validRedirect(args.redirectUri) || !/^[A-Za-z0-9_-]{43}$/.test(args.challenge)) throw new Error("INVALID_AUTHORIZATION_REQUEST");
    const config = await surfaceConfiguration(ctx, surfaceForResource(args.resource) ?? "mcp");
    if (!config.enabled) throw new Error("MCP_DISABLED");
    const delegationId = await captureDelegation(ctx, { user: ctx.user, session: ctx.session });
    const code = secret();
    const codeId = await ctx.db.insert("agentAuthorizationCodes", {
      contractEpoch: AGENT_CONTRACT_EPOCH, generation: config.generation, codeHash: await credentialHash(code), userId: ctx.user._id, delegationId,
      ...args, expiresAt: Date.now() + 60_000,
    });
    await ctx.scheduler.runAfter(60_000, internal.platform.agentAccess.expireCode, { codeId });
    // Consuming the browser login is atomic with the approval/code issuance.
    await deleteAuthorizationSession(ctx, ctx.session._id);
    return { code };
  },
});

/** Denial must work even when current policy or recent proof no longer allows approval. */
export const deny = mutation({
  args: {}, handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || typeof identity.sessionId !== "string") throw new Error("NOT_AUTHENTICATED");
    const session = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "_id", value: identity.sessionId }] }) as Doc<"session"> | null;
    if (!session) return;
    if (session.userId !== identity.subject || session.authPurpose !== "mcp-authorization") throw new Error("FORBIDDEN");
    await deleteAuthorizationSession(ctx, session._id);
  },
});

export async function requireGrant(ctx: QueryCtx, token: string, resource: string, recent = false) {
  if (!/^[a-f0-9]{64}$/.test(token) || !resourceEnabled(resource)) throw new Error("INVALID_AGENT_TOKEN");
  const config = await surfaceConfiguration(ctx, surfaceForResource(resource) ?? "mcp");
  if (!config.enabled) throw new Error("INVALID_AGENT_TOKEN");
  const tokenHash = await credentialHash(token);
  const grant = await ctx.db.query("agentGrants").withIndex("by_token_hash", q => q.eq("tokenHash", tokenHash)).unique();
  if (!grant || !currentAgentContract(grant) || grant.generation !== config.generation || grant.revokedAt || grant.expiresAt <= Date.now() || grant.resource !== resource || grant.scope !== AGENT_SCOPE)
    throw new Error("INVALID_AGENT_TOKEN");
  return validateGrant(ctx, grant, recent);
}

async function validateGrant(ctx: QueryCtx, grant: import("../_generated/dataModel").Doc<"agentGrants">, recent: boolean) {
  const pair = await readDelegation(ctx, grant.delegationId, grant.userId);
  if (!currentAgentContract(grant) || !pair || !await isAppOperatorIdentity(ctx, pair.user)) throw new Error("INVALID_AGENT_TOKEN");
  const assurance = await evaluateSession(ctx, pair);
  if (!assurance.allowed) throw new Error("INVALID_AGENT_TOKEN");
  if (recent && !assurance.recent) throw new Error("RECENT_AUTHENTICATION_REQUIRED");
  return { ...pair, assurance, grantId: grant._id, resource: grant.resource, contractEpoch: AGENT_CONTRACT_EPOCH, generation: grant.generation, ownerId: (pair.user.userId ?? pair.user._id).toString() };
}

/** Only server-owned durable tasks use a stored grant ID; it is never a public credential. */
export async function requireGrantById(ctx: QueryCtx, grantId: import("../_generated/dataModel").Id<"agentGrants">, resource: string, recent = false) {
  const grant = await ctx.db.get(grantId);
  const surface = surfaceForResource(resource);
  const config = surface ? await surfaceConfiguration(ctx, surface) : null;
  if (!grant || !currentAgentContract(grant) || !config?.enabled || grant.generation !== config.generation || grant.revokedAt || grant.expiresAt <= Date.now() || grant.resource !== resource || grant.scope !== AGENT_SCOPE) throw new Error("INVALID_AGENT_TOKEN");
  return validateGrant(ctx, grant, recent);
}

export const exchange = mutation({
  args: { code: v.string(), verifier: v.string(), clientId: v.string(), redirectUri: v.string(), resource: v.string() },
  handler: async (ctx, args) => {
    await rateLimit(ctx, { name: "mutationGlobal", key: `agent-exchange:${await credentialHash(args.code)}`, throws: true });
    const config = await surfaceConfiguration(ctx, surfaceForResource(args.resource) ?? "mcp");
    const hash = await credentialHash(args.code);
    const row = await ctx.db.query("agentAuthorizationCodes").withIndex("by_code_hash", q => q.eq("codeHash", hash)).unique();
    if (!config.enabled || !row || !currentAgentContract(row) || row.generation !== config.generation || row.expiresAt <= Date.now() || !resourceEnabled(args.resource) || row.resource !== args.resource
      || row.clientId !== args.clientId || row.redirectUri !== args.redirectUri || !/^[A-Za-z0-9._~-]{43,128}$/.test(args.verifier)) throw new Error("INVALID_GRANT");
    const challengeBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(args.verifier)));
    const challenge = btoa(String.fromCharCode(...challengeBytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    if (challenge !== row.challenge) throw new Error("INVALID_GRANT");
    const pair = await readDelegation(ctx, row.delegationId, row.userId);
    if (!pair || !await isAppOperatorIdentity(ctx, pair.user)) throw new Error("INVALID_GRANT");
    const assurance = await evaluateSession(ctx, pair);
    if (!assurance.allowed || !assurance.recent) throw new Error("INVALID_GRANT");
    // A mutation atomically consumes the code. Racing or repeated exchanges cannot mint two tokens.
    await ctx.db.delete(row._id);
    const token = secret();
    const expiresAt = Math.min(Date.now() + 15 * 60_000, assurance.expiresAt);
    const grantId = await ctx.db.insert("agentGrants", { contractEpoch: AGENT_CONTRACT_EPOCH, generation: config.generation, tokenHash: await credentialHash(token), userId: row.userId, delegationId: row.delegationId,
      resource: row.resource, scope: row.scope, clientId: row.clientId, expiresAt, createdAt: Date.now() });
    await ctx.scheduler.runAfter(expiresAt - Date.now(), internal.platform.agentAccess.expireGrant, { grantId });
    return { access_token: token, token_type: "Bearer", expires_in: Math.floor((expiresAt - Date.now()) / 1000), scope: row.scope };
  },
});
export const inspect = query({
  args: { token: v.string(), resource: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireGrant(ctx, args.token, args.resource);
    return { scope: AGENT_SCOPE, recent: auth.assurance.recent };
  },
});
async function listGrants(ctx: QueryCtx, userId: string) {
  const grants = await ctx.db.query("agentGrants").withIndex("by_user", q => q.eq("userId", userId)).collect();
  return await Promise.all(grants.map(async ({ _id, createdAt, expiresAt, revokedAt, clientId, generation, resource, scope, contractEpoch }) => {
    const surface = surfaceForResource(resource);
    const config = surface ? await surfaceConfiguration(ctx, surface) : null;
    return { _id, createdAt, expiresAt, revokedAt, clientId, surface, active: Boolean(currentAgentContract({ contractEpoch }) && scope === AGENT_SCOPE && config?.enabled && generation === config.generation && !revokedAt && expiresAt > Date.now()) };
  }));
}
export const listMine = rememberNative(query({ args: {}, handler: async ctx => {
  const auth = await authorizedSession(ctx); return !auth || !await isAppOperatorIdentity(ctx, auth.user) ? [] : listGrants(ctx, auth.user._id);
} }), { args: {}, handler: (ctx: QueryCtx & { user: { _id: string } }) => listGrants(ctx, ctx.user._id) }, "query");

export const revoke = appOperatorMutation({
  args: { grantId: v.id("agentGrants") },
  handler: async (ctx, args) => {
    await requireAppOperator(ctx, { write: true });
    const grant = await ctx.db.get(args.grantId);
    if (!grant || grant.userId !== ctx.user._id) throw new Error("GRANT_NOT_FOUND");
    await ctx.db.patch(grant._id, { revokedAt: Date.now() });
    await scheduleAuditEvent(ctx, { actor: ctx.user.email, authenticatedUserId: ctx.ownerId, sourceDetail: LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS.agentAccess, action: "admin.agent_grant_revoked", resource: `agent-grant:${grant._id}`, status: "succeeded" });
  },
});

// Expiry is enforced synchronously on every request; scheduled cleanup only removes old hashes.
export const expireCode = internalMutation({
  args: { codeId: v.id("agentAuthorizationCodes") },
  handler: async (ctx, { codeId }) => {
    const row = await ctx.db.get(codeId);
    if (row && row.expiresAt <= Date.now()) await ctx.db.delete(codeId);
  },
});
export const expireGrant = internalMutation({
  args: { grantId: v.id("agentGrants") },
  handler: async (ctx, { grantId }) => {
    const row = await ctx.db.get(grantId);
    if (row && row.expiresAt <= Date.now()) await ctx.db.delete(grantId);
  },
});

export const expireDelegation = internalMutation({
  args: { delegationId: v.id("agentDelegations") },
  handler: async (ctx, { delegationId }) => {
    const row = await ctx.db.get(delegationId);
    if (row && row.expiresAt <= Date.now()) await ctx.db.delete(delegationId);
  },
});
